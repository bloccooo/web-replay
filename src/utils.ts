import type { Page } from "puppeteer";
import { injectCursor } from "./cursor";
import { virtualTimer } from "./virtualTimer";

export async function setupDocumentReplayOverrides(page: Page) {
  await page.exposeFunction("_getVirtualTime", () => {
    return virtualTimer.get();
  });

  await page.evaluateOnNewDocument(() => {
    window._webRecorder = {
      virtualTime: 0,
      requestAnimationFrameCallbacks: [],
      intervals: [],
      _intervalIdCounter: 0,
      animations: new Map(),
    };

    // Date override
    Date.now = () => window._webRecorder.virtualTime;
    Date.prototype.getTime = () => window._webRecorder.virtualTime;
    performance.now = () => window._webRecorder.virtualTime;

    // Request animation override
    window.requestAnimationFrame = (callback: (timestamp: number) => void) => {
      window._webRecorder.requestAnimationFrameCallbacks.push(callback);
      return 0;
    };

    // Timeout override
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;

    // Intervals override
    window.setInterval = ((callback: () => void, delay: number) => {
      const id = ++window._webRecorder._intervalIdCounter;
      window._webRecorder.intervals.push({
        id,
        startTime: window._webRecorder.virtualTime,
        interval: delay,
        callback: callback,
        callCount: 0,
      });
      return id;
    }) as unknown as typeof window.setInterval;

    window.clearInterval = ((id: number) => {
      window._webRecorder.intervals = window._webRecorder.intervals.filter(
        (i) => i.id !== id,
      );
    }) as unknown as typeof window.clearInterval;
  });
}

export async function setupCursor(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "* { cursor: none !important; }";
    document.head?.appendChild(style);
  });

  await injectCursor(page, 0, 0);
}

export async function evaluateFrameState(page: Page) {
  await page.evaluate(async () => {
    // Update virtual time
    window._webRecorder.virtualTime = await window._getVirtualTime();
    Date.now = () => window._webRecorder.virtualTime;
    Date.prototype.getTime = () => window._webRecorder.virtualTime;
    performance.now = () => window._webRecorder.virtualTime;

    // Detect and store animations
    for (const animation of document.getAnimations()) {
      const isCSSTransition = animation instanceof CSSTransition;
      const isCSSAnimation = animation instanceof CSSAnimation;
      if (!isCSSTransition && !isCSSAnimation) continue;

      const target = (animation.effect as KeyframeEffect)?.target as Element;
      if (!target) continue;

      const key = isCSSTransition
        ? `t:${(animation as CSSTransition).transitionProperty}`
        : `a:${(animation as CSSAnimation).animationName}`;

      if (!window._webRecorder.animations.has(target)) {
        window._webRecorder.animations.set(target, new Map());
      }

      const byKey = window._webRecorder.animations.get(target)!;
      if (!byKey.has(key)) {
        const timing = animation.effect!.getTiming();
        const duration = timing.duration as number;
        const iterations = timing.iterations ?? 1;
        byKey.set(key, {
          virtualStart: window._webRecorder.virtualTime,
          duration: iterations === Infinity ? Infinity : duration * iterations,
        });
      }
    }
  });
}

export async function evaluateFrame(page: Page) {
  await page.evaluate(() => {
    // Drive CSS animations & CSS Transitions
    for (const [element, byKey] of window._webRecorder.animations) {
      for (const [key, { virtualStart, duration }] of byKey) {
        const elapsed = window._webRecorder.virtualTime - virtualStart;
        const isTransition = key.startsWith("t:");
        const name = key.slice(2);

        const animation = document.getAnimations().find((animation) => {
          if ((animation.effect as KeyframeEffect)?.target !== element)
            return false;
          if (isTransition) {
            return (
              animation instanceof CSSTransition &&
              (animation as CSSTransition).transitionProperty === name
            );
          } else {
            return (
              animation instanceof CSSAnimation &&
              (animation as CSSAnimation).animationName === name
            );
          }
        });

        if (animation) {
          animation.pause();
          animation.currentTime = elapsed;
        }

        if (duration !== Infinity && elapsed >= duration) {
          byKey.delete(key);
        }
      }

      if (byKey.size === 0) window._webRecorder.animations.delete(element);
    }

    // Drive animation frame requests
    const callbacksToRun = window._webRecorder.requestAnimationFrameCallbacks;
    window._webRecorder.requestAnimationFrameCallbacks = [];

    for (const callback of callbacksToRun) {
      callback(window._webRecorder.virtualTime);
    }

    // Drive intervals
    for (const entry of window._webRecorder.intervals) {
      const expectedCalls = Math.floor(
        (window._webRecorder.virtualTime - entry.startTime) / entry.interval,
      );
      while (entry.callCount < expectedCalls) {
        entry.callback();
        entry.callCount++;
      }
    }
  });
}

import type { Page } from "puppeteer";
import { injectCursor, injectCustomCaret, CARET_ID } from "./cursor";
import { virtualTimer } from "./virtualTimer";

export async function setupDocumentReplayOverrides(page: Page) {
  await page.exposeFunction("_getVirtualTime", () => {
    return virtualTimer.get();
  });

  await page.evaluateOnNewDocument(() => {
    window._webRecorder = {
      virtualTime: 0,
      cursorX: 0,
      cursorY: 0,
      requestAnimationFrameCallbacks: [],
      timeouts: [],
      intervals: [],
      _timerIdCounter: 0,
      animations: new Map(),
      scrollTargets: new Map(),
      scrollCurrents: new Map(),
    };

    document.addEventListener("mousemove", (e) => {
      window._webRecorder.cursorX = e.clientX;
      window._webRecorder.cursorY = e.clientY;
    });

    function animateScroll() {
      for (const [el, target] of window._webRecorder.scrollTargets) {
        const current = window._webRecorder.scrollCurrents.get(el) ?? {
          x: el.scrollLeft,
          y: el.scrollTop,
        };
        const newX = current.x + (target.x - current.x) * 0.2;
        const newY = current.y + (target.y - current.y) * 0.2;
        el.scrollLeft = newX;
        el.scrollTop = newY;
        window._webRecorder.scrollCurrents.set(el, { x: newX, y: newY });
      }
      requestAnimationFrame(animateScroll);
    }
    animateScroll();

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
    window.setTimeout = ((callback: () => void, delay = 0) => {
      const id = ++window._webRecorder._timerIdCounter;
      window._webRecorder.timeouts.push({
        id,
        scheduledAt: window._webRecorder.virtualTime + delay,
        callback,
      });
      return id;
    }) as unknown as typeof window.setTimeout;

    window.clearTimeout = ((id: number) => {
      window._webRecorder.timeouts = window._webRecorder.timeouts.filter(
        (t) => t.id !== id,
      );
    }) as unknown as typeof window.clearTimeout;

    // Intervals override
    window.setInterval = ((callback: () => void, delay: number) => {
      const id = ++window._webRecorder._timerIdCounter;
      window._webRecorder.intervals.push({
        id,
        startTime: window._webRecorder.virtualTime,
        interval: delay,
        callback,
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
  await injectCustomCaret(page);
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
  await page.evaluate((caretId) => {
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

    // Drive timeouts
    window._webRecorder.timeouts = window._webRecorder.timeouts.filter(
      (entry) => {
        if (window._webRecorder.virtualTime >= entry.scheduledAt) {
          entry.callback();
          return false;
        }
        return true;
      },
    );

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

    // Coerce input types that don't support selectionStart to text
    const NO_SELECTION_TYPES = new Set([
      "email",
      "number",
      "date",
      "month",
      "week",
      "time",
      "datetime-local",
      "range",
      "color",
    ]);
    document.querySelectorAll("input").forEach((el) => {
      if (NO_SELECTION_TYPES.has((el as HTMLInputElement).type))
        (el as HTMLInputElement).type = "text";
    });

    // Update custom caret
    const caretEl = document.getElementById(caretId);
    if (caretEl) {
      const active = document.activeElement as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;

      if (
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
        active.selectionStart !== null
      ) {
        const mirror = document.createElement("div");
        const styles = window.getComputedStyle(active);
        for (let i = 0; i < styles.length; i++) {
          const prop = styles[i];
          if (prop) {
            mirror.style[prop as any] = styles.getPropertyValue(prop);
          }
        }
        const inputRect = active.getBoundingClientRect();
        mirror.style.position = "fixed";
        mirror.style.top = `${inputRect.top}px`;
        mirror.style.left = `${inputRect.left}px`;
        mirror.style.width = `${inputRect.width}px`;
        mirror.style.height = `${inputRect.height}px`;
        mirror.style.transform = "none";
        mirror.style.visibility = "hidden";
        mirror.style.whiteSpace = "pre-wrap";

        mirror.appendChild(
          document.createTextNode(active.value.slice(0, active.selectionStart)),
        );
        const marker = document.createElement("span");
        marker.textContent = "|";
        mirror.appendChild(marker);
        document.body.appendChild(mirror);
        const rect = marker.getBoundingClientRect();
        document.body.removeChild(mirror);

        const CARET_BLINK_INTERVAL_MS = 500;
        const vt = window._webRecorder.virtualTime;
        const visible = Math.floor(vt / CARET_BLINK_INTERVAL_MS) % 2 === 0;

        caretEl.style.transform = `translate(${rect.left}px,${rect.top}px)`;
        caretEl.style.height = `${rect.height}px`;
        caretEl.style.display = visible ? "block" : "none";
      } else {
        caretEl.style.display = "none";
      }
    }
  }, CARET_ID);
}

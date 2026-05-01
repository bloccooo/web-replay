import { readFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import type { Event } from "./testrecord";
import { injectCursor } from "./cursor";
import { framesToVideo } from "./video";

async function run() {
  console.log("running");
  const file = readFileSync("session.json", "utf-8");
  const events: Event[] = JSON.parse(file);
  const frames: Buffer[] = [];

  const fps = 60;
  const interval = 1000 / fps;

  let currentTime = 0;

  const probe = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 720 },
    args: [
      "--run-all-compositor-stages-before-draw",
      "--disable-threaded-animation",
      "--disable-threaded-scrolling",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });

  const page = (await probe.pages())[0]!;

  const client = await page.createCDPSession();

  await page.exposeFunction("getCurrentTime", () => {
    return currentTime;
  });

  await page.evaluateOnNewDocument(() => {
    const w = window as any;
    const frozenTime = 0;
    Date.now = () => frozenTime;
    Date.prototype.getTime = () => frozenTime;
    performance.now = () => frozenTime;
    w.animationCallbacks = [];
    w.requestAnimationFrame = (cb: (timestamp: number) => void) => {
      w.animationCallbacks.push(cb);
      return 0;
    };
    w.setTimeout = () => 0 as any;
    w.setInterval = () => 0 as any;
    w.currentTransitions = new Map<
      Element,
      Map<string, { virtualStart: number; duration: number }>
    >();
  });

  await page.goto(`file://${path.join(__dirname, "../test.html")}`);

  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "* { cursor: none !important; }";
    document.head?.appendChild(style);
  });

  await injectCursor(page, 0, 0);

  await page.evaluate(() => {
    document.getAnimations().forEach((anim) => {
      anim.pause();
      anim.currentTime = 0;
    });
  });

  function hasMoreEvents() {
    return events.some((event) => event.timestamp > currentTime);
  }

  while (hasMoreEvents()) {
    const currentEvents = events.filter(
      (event) =>
        event.timestamp >= currentTime &&
        event.timestamp < currentTime + interval,
    );

    for (const event of currentEvents) {
      if (event.type === "mousemove") {
        await page.mouse.move(event.x, event.y);
      }
    }

    await page.evaluate(async () => {
      const w = window as any;
      const frozenTime = await w.getCurrentTime();

      Date.now = () => frozenTime;
      Date.prototype.getTime = () => frozenTime;
      performance.now = () => frozenTime;
      window.requestAnimationFrame = (_cb) => 0;
      window.setTimeout = (() => 0) as any;
      window.setInterval = (() => 0) as any;

      // detect newly started transitions and animations
      for (const animation of document.getAnimations()) {
        const isCSSTransition = animation instanceof CSSTransition;
        const isCSSAnimation = animation instanceof CSSAnimation;
        if (!isCSSTransition && !isCSSAnimation) continue;

        const target = (animation.effect as KeyframeEffect)?.target as Element;
        if (!target) continue;

        const key = isCSSTransition
          ? `t:${(animation as CSSTransition).transitionProperty}`
          : `a:${(animation as CSSAnimation).animationName}`;

        if (!w.currentTransitions.has(target)) {
          w.currentTransitions.set(target, new Map());
        }
        const byKey = w.currentTransitions.get(target);
        if (!byKey.has(key)) {
          const timing = animation.effect!.getTiming();
          const duration = timing.duration as number;
          const iterations = timing.iterations ?? 1;
          byKey.set(key, {
            virtualStart: frozenTime,
            duration:
              iterations === Infinity ? Infinity : duration * iterations,
          });
        }
      }
    });

    // advance all tracked transitions and animations to current virtual time
    await page.evaluate(async () => {
      const w = window as any;
      const frozenTime = await w.getCurrentTime();

      for (const [element, byKey] of w.currentTransitions) {
        for (const [key, { virtualStart, duration }] of byKey) {
          const elapsed = frozenTime - virtualStart;
          const isTransition = key.startsWith("t:");
          const name = key.slice(2);

          const animation = document.getAnimations().find((a) => {
            if ((a.effect as KeyframeEffect)?.target !== element) return false;
            if (isTransition) {
              return (
                a instanceof CSSTransition &&
                (a as CSSTransition).transitionProperty === name
              );
            } else {
              return (
                a instanceof CSSAnimation &&
                (a as CSSAnimation).animationName === name
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
        if (byKey.size === 0) w.currentTransitions.delete(element);
      }

      const callbacksToRemove = [];
      for (const callbak of w.animationCallbacks as ((
        timestamp: number,
      ) => void)[]) {
        callbak(frozenTime);
        callbacksToRemove.push(callbak);
      }

      (w.animationCallbacks as ((timestamp: number) => void)[]) = (
        w.animationCallbacks as ((timestamp: number) => void)[]
      ).filter((c) => callbacksToRemove.includes(c));
    });

    const screenshot = await page.screenshot({ type: "png" });
    frames.push(screenshot);
    await new Promise((resolve) => setTimeout(resolve, 1));

    currentTime += interval;
  }

  await framesToVideo(frames, fps, "output.mp4");
  await probe.close();
}

run();

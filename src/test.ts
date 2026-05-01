import { readFileSync } from "node:fs";
import path from "node:path";
import type { Event } from "./testrecord";
import { framesToVideo } from "./video";
import { launchBrowser } from "./browser";
import { virtualTimer } from "./virtualTimer";
import {
  setupDocumentReplayOverrides,
  setupCursor,
  evaluateFrameState,
  evaluateFrame,
} from "./utils";
import { applyEvent } from "./events";

const fps = 60;
const interval = 1000 / fps;

async function run() {
  console.log("running");
  const file = readFileSync("session.json", "utf-8");
  const events: Event[] = JSON.parse(file);
  const frames: Buffer[] = [];

  const { browser, page } = await launchBrowser({
    width: 1280,
    height: 730,
  });

  await setupDocumentReplayOverrides(page);

  console.log("ksjdhj");

  await page.goto(`file://${path.join(__dirname, "../test.html")}`);

  await setupCursor(page);

  function hasMoreEvents() {
    return events.some((event) => event.timestamp > virtualTimer.get());
  }

  while (hasMoreEvents()) {
    const virtualTime = virtualTimer.get();

    const currentEvents = events.filter(
      (event) =>
        event.timestamp >= virtualTime &&
        event.timestamp < virtualTime + interval,
    );

    for (const event of currentEvents) {
      await applyEvent(page, event);
    }

    await evaluateFrameState(page);
    await evaluateFrame(page);

    // await page.evaluate(async () => {
    //   const frozenTime = await window._getVirtualTime();

    //   for (const [element, byKey] of window._webRecorder.animations) {
    //     for (const [key, { virtualStart, duration }] of byKey) {
    //       const elapsed = frozenTime - virtualStart;
    //       const isTransition = key.startsWith("t:");
    //       const name = key.slice(2);

    //       const animation = document.getAnimations().find((a) => {
    //         if ((a.effect as KeyframeEffect)?.target !== element) return false;
    //         if (isTransition) {
    //           return (
    //             a instanceof CSSTransition &&
    //             (a as CSSTransition).transitionProperty === name
    //           );
    //         } else {
    //           return (
    //             a instanceof CSSAnimation &&
    //             (a as CSSAnimation).animationName === name
    //           );
    //         }
    //       });

    //       if (animation) {
    //         animation.pause();
    //         animation.currentTime = elapsed;
    //       }

    //       if (duration !== Infinity && elapsed >= duration) {
    //         byKey.delete(key);
    //       }
    //     }
    //     if (byKey.size === 0) window._webRecorder.animations.delete(element);
    //   }

    //   const callbacksToRemove: ((timestamp: number) => void)[] = [];
    //   for (const cb of window._webRecorder.requestAnimationFrameCallbacks) {
    //     cb(frozenTime);
    //     callbacksToRemove.push(cb);
    //   }
    //   window._webRecorder.requestAnimationFrameCallbacks =
    //     window._webRecorder.requestAnimationFrameCallbacks.filter(
    //       (c) => !callbacksToRemove.includes(c),
    //     );

    //   for (const entry of window._webRecorder.intervals) {
    //     const expectedCalls = Math.floor(
    //       (frozenTime - entry.startTime) / entry.interval,
    //     );
    //     while (entry.callCount < expectedCalls) {
    //       entry.callback();
    //       entry.callCount++;
    //     }
    //   }
    // });

    const screenshot = await page.screenshot({ type: "png" });
    frames.push(screenshot);
    await new Promise((resolve) => setTimeout(resolve, 1));

    virtualTimer.advance();
  }

  console.log("Finished recording, generating video");

  await framesToVideo(frames, fps, "output.mp4");

  console.log("closing browser");

  await browser.close();
}

run().catch(console.error);

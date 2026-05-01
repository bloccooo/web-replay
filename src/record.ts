import { writeFileSync } from "node:fs";
import { launchBrowser } from "./browser";
import { type Event } from "./events";
import type { Session } from "./types";

export interface RecordOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

export async function record(
  startUrl: string,
  outputPath: string,
  opts: RecordOptions = {},
) {
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const fullscreen = !!opts.fullscreen;

  console.log(width, height);

  const { browser, page } = await launchBrowser({
    width,
    height,
    fullscreen,
  });

  await page.goto(startUrl);

  const events: Event[] = [];

  const startTime = performance.now();

  function elapsed() {
    return performance.now() - startTime;
  }

  await page.exposeFunction(
    "recordMouseMove",
    (event: { x: number; y: number }) => {
      events.push({
        ...event,
        type: "mousemove",
        timestamp: elapsed(),
      });
    },
  );

  await page.exposeFunction(
    "recordKeyboard",
    (event: { type: "keydown" | "keyup"; key: string; code: string }) => {
      events.push({ ...event, timestamp: elapsed() });
    },
  );

  await page.exposeFunction(
    "recordMouseButton",
    (event: {
      type: "mousedown" | "mouseup";
      x: number;
      y: number;
      button: number;
    }) => {
      events.push({ ...event, timestamp: elapsed() });
    },
  );

  await page.exposeFunction(
    "recordScroll",
    (event: { scrollX: number; scrollY: number }) => {
      events.push({
        ...event,
        type: "scroll",
        timestamp: elapsed(),
      });
    },
  );

  await page.evaluate(() => {
    const w = window as any;

    document.addEventListener("mousemove", (e) =>
      w.recordMouseMove({ x: e.clientX, y: e.clientY }),
    );

    document.addEventListener("keydown", (e) =>
      w.recordKeyboard({ type: "keydown", key: e.key, code: e.code }),
    );

    document.addEventListener("keyup", (e) =>
      w.recordKeyboard({ type: "keyup", key: e.key, code: e.code }),
    );

    document.addEventListener("mousedown", (e) =>
      w.recordMouseButton({
        type: "mousedown",
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      }),
    );

    document.addEventListener("mouseup", (e) =>
      w.recordMouseButton({
        type: "mouseup",
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      }),
    );

    document.addEventListener(
      "scroll",
      (e) => {
        const target = e.target;
        w.recordScroll({
          scrollX:
            target === document
              ? window.scrollX
              : (target as Element).scrollLeft,
          scrollY:
            target === document
              ? window.scrollY
              : (target as Element).scrollTop,
        });
      },
      { capture: true },
    );
  });

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });

  const session: Session = {
    version: 1,
    startUrl,
    viewport: {
      width: opts.width || 1280,
      height: opts.height || 720,
      fullscreen,
    },
    events,
  };

  writeFileSync(outputPath, JSON.stringify(session, null, 2));
}

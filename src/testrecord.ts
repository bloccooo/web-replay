import { writeFileSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./browser";
import { type Event } from "./events";

async function run() {
  console.log("running");

  const { browser, page } = await launchBrowser({
    width: 1280,
    height: 730,
  });

  // await page.goto(`file://${path.join(__dirname, "../test.html")}`);
  await page.goto("http://localhost:5173");

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
        const target = e.target as Element;
        w.recordScroll({
          scrollX: target === document ? window.scrollX : target.scrollLeft,
          scrollY: target === document ? window.scrollY : target.scrollTop,
        });
      },
      { capture: true },
    );
  });

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });

  writeFileSync("session.json", JSON.stringify(events, null, 2));
}

run();

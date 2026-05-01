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
  await page.goto("https://blocco.studio");

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

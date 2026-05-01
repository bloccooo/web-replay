import { writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

export type MouseEvent = {
  type: "mousemove";
  timestamp: number;
  x: number;
  y: number;
};

export type Event = MouseEvent;

async function run() {
  console.log("running");

  const browser = await puppeteer.launch({
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

  const page = (await browser.pages())[0]!;

  await page.goto(`file://${path.join(__dirname, "../test.html")}`);

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

  await page.evaluate(() => {
    const w = window as any;

    document.addEventListener("mousemove", (e) =>
      w.recordMouseMove({ x: e.clientX, y: e.clientY }),
    );
  });

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });

  writeFileSync("session.json", JSON.stringify(events, null, 2));
}

run();

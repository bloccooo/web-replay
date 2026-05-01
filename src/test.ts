import { readFileSync } from "node:fs";
import path from "node:path";
import type { Event } from "./testrecord";
import { createVideoEncoder } from "./video";
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
  const { browser, page } = await launchBrowser({
    width: 1280,
    height: 730,
  });

  await setupDocumentReplayOverrides(page);

  await page.goto(`file://${path.join(__dirname, "../test.html")}`);

  await setupCursor(page);

  const encoder = createVideoEncoder(fps, "output.mp4");

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

    const screenshot = (await page.screenshot({
      type: "png",
    })) as Buffer<ArrayBufferLike>;

    await encoder.writeFrame(screenshot);
    await new Promise((resolve) => setTimeout(resolve, 1));

    virtualTimer.advance();
  }

  await encoder.finish();

  console.log("closing browser");

  await browser.close();
}

run().catch(console.error);

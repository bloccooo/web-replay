import { readFileSync } from "node:fs";
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
import type { Session } from "./types";

export interface ReplayOptions {
  speed?: number;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  fps?: number;
}

export async function replay(sessionPath: string, opts: ReplayOptions = {}) {
  const fps = opts.fps || 60;
  const interval = 1000 / fps;

  const file = readFileSync(sessionPath, "utf-8");
  const session: Session = JSON.parse(file);
  const events = session.events;

  console.log(session.viewport);

  const { browser, page } = await launchBrowser({
    width: session.viewport.width,
    height: session.viewport.height,
    fullscreen: session.viewport.fullscreen,
  });

  await setupDocumentReplayOverrides(page);

  await page.goto(session.startUrl);

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

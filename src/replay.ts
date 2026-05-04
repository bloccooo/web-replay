import { readFileSync } from "node:fs";
import { createVideoEncoder } from "./video";
import { launchBrowser } from "./browser";
import { virtualTimer } from "./virtualTimer";
import {
  setupDocumentReplayOverrides,
  setupCursor,
  evaluateFrameState,
  evaluateFrame,
  applyEvent,
} from "./utils";
import type { Session } from "./types";

export interface ReplayOptions {
  speed?: number;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  fps?: number;
  headless?: boolean;
  scale?: number;
  quality?: string;
  cursor?: boolean;
  duration?: number;
}

export async function replay(sessionPath: string, opts: ReplayOptions = {}) {
  const fps = opts.fps || 60;
  const interval = 1000 / fps;

  const file = readFileSync(sessionPath, "utf-8");
  const session: Session = JSON.parse(file);
  const events = session.events;

  const { browser, page } = await launchBrowser({
    width: session.viewport.width,
    height: session.viewport.height,
    fullscreen: session.viewport.fullscreen,
    headless: opts.headless ?? true,
  });

  const scale = opts.scale ?? 1;

  await page.setViewport({
    width: session.viewport.width,
    height: session.viewport.height,
    deviceScaleFactor: scale,
  });

  await setupDocumentReplayOverrides(page);

  await page.goto(session.startUrl);

  await setupCursor(page, opts.cursor ?? true);

  const encoder = createVideoEncoder(
    fps,
    "output.mp4",
    session.viewport.width * scale,
    session.viewport.height * scale,
    opts.quality,
  );

  const sessionDuration = Math.max(...events.map((e) => e.timestamp));
  const maxTime = opts.duration != null ? opts.duration * 1000 : sessionDuration;
  const totalDuration = Math.min(maxTime, sessionDuration);

  function renderProgress(virtualTime: number) {
    const pct = Math.min(virtualTime / totalDuration, 1);
    const BAR_WIDTH = 30;
    const filled = Math.round(pct * BAR_WIDTH);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
    const cur = (virtualTime / 1000).toFixed(1).padStart(6);
    const tot = (totalDuration / 1000).toFixed(1).padStart(6);
    process.stdout.write(`\rReplaying  [${bar}] ${pctStr}  ${cur}s / ${tot}s`);
  }

  function hasMoreEvents() {
    const vt = virtualTimer.get();
    return vt < maxTime && events.some((event) => event.timestamp > vt);
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
    renderProgress(virtualTimer.get());
  }

  process.stdout.write("\n");

  await encoder.finish();

  await browser.close();
}

import { readFileSync } from "node:fs";
import { createVideoEncoder } from "./video";
import { launchBrowser } from "./browser";
import { virtualTimer } from "./virtualTimer";
import {
  setupDocumentReplayOverrides,
  setupCursor,
  reinjectCursor,
  evaluateFrameState,
  evaluateFrame,
  applyEvent,
  validCoords,
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
  scrollSmoothing?: number;
  cursorSmoothing?: number;
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

  await setupDocumentReplayOverrides(page, opts.scrollSmoothing);

  await page.goto(session.startUrl);

  const showCursor = opts.cursor ?? true;
  const cursorSmoothing = opts.cursorSmoothing;

  const firstCoordEvent = events.find(
    (e) => "x" in e && Number.isFinite((e as any).x),
  );
  let lastCursorX = firstCoordEvent ? (firstCoordEvent as any).x : 0;
  let lastCursorY = firstCoordEvent ? (firstCoordEvent as any).y : 0;

  await setupCursor(
    page,
    showCursor,
    cursorSmoothing,
    lastCursorX,
    lastCursorY,
  );

  const encoder = createVideoEncoder(
    fps,
    "output.mp4",
    session.viewport.width * scale,
    session.viewport.height * scale,
    opts.quality,
  );

  const sessionDuration = Math.max(...events.map((e) => e.timestamp));
  const maxTime =
    opts.duration != null ? opts.duration * 1000 : sessionDuration;
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

  const cdp = await page.createCDPSession();

  let shouldCapture = false;
  let writingFrame = false;
  let captureSetAt = 0;

  const screencastParams = {
    format: "png" as const,
    quality: 0,
    everyNthFrame: 1,
    maxWidth: session.viewport.width,
    maxHeight: session.viewport.height,
  };

  await cdp.send("Page.startScreencast", screencastParams);

  // After a top-level navigation Chrome drops the screencast stream internally.
  // Restart it so frames keep flowing.
  page.on("framenavigated", async (frame) => {
    if (frame.parentFrame() !== null) return;
    await reinjectCursor(
      page,
      lastCursorX,
      lastCursorY,
      showCursor,
      cursorSmoothing,
    );
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.send("Page.startScreencast", screencastParams).catch(() => {});
  });

  cdp.on("Page.screencastFrame", async (event) => {
    // Ack immediately so Chrome keeps pushing without waiting on us.
    cdp
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(() => {});

    const data = Buffer.from(event.data, "base64");

    if (shouldCapture) {
      writingFrame = true;
      shouldCapture = false;
      encoder.writeFrame(data).then(() => {
        writingFrame = false;
        shouldCapture = false;
      });
    }
  });

  // Events are timestamp-sorted; use a pointer so each frame is O(k) not O(n).
  let eventIdx = 0;

  while (virtualTimer.get() < maxTime && eventIdx < events.length) {
    if (writingFrame || shouldCapture) {
      if (
        shouldCapture &&
        captureSetAt > 0 &&
        Date.now() - captureSetAt > 150
      ) {
        // Chrome stopped pushing screencast frames (e.g. post-navigation).
        // Fall back to a direct screenshot so we don't deadlock.
        shouldCapture = false;
        captureSetAt = 0;
        writingFrame = true;
        try {
          const screenshot = await page.screenshot({ type: "png" });
          encoder.writeFrame(Buffer.from(screenshot));
        } catch {}
        writingFrame = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }

    const virtualTime = virtualTimer.get();
    const windowEnd = virtualTime + interval;

    const currentEvents: typeof events = [];
    while (
      eventIdx < events.length &&
      events[eventIdx]!.timestamp < windowEnd
    ) {
      currentEvents.push(events[eventIdx]!);
      eventIdx++;
    }

    for (const event of currentEvents) {
      await applyEvent(page, event);

      if ("x" in event && validCoords(event.x, event.y)) {
        lastCursorX = event.x;
        lastCursorY = event.y;
      }
    }

    await evaluateFrameState(page);
    await evaluateFrame(page);
    shouldCapture = true;
    captureSetAt = Date.now();

    virtualTimer.advance();
    renderProgress(virtualTimer.get());
  }

  process.stdout.write("\n");

  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
  await encoder.finish();

  await browser.close();
}

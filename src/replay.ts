import { readFileSync, unlinkSync } from "node:fs";
import { createVideoEncoder, concatVideos } from "./video";
import { launchBrowser } from "./browser";
import { VirtualTimer } from "./virtualTimer";
import {
  setupDocumentReplayOverrides,
  setupCursor,
  reinjectCursor,
  evaluateTick,
  applyEvent,
} from "./utils";
import type { Session, Event } from "./types";
import type { Page } from "puppeteer";

type AsyncCapture = {
  setCapture(): void;
  waitForCapture(timeoutMs?: number): Promise<void>;
  queueDepth(): number;
  stop(): Promise<void>;
};

async function startAsyncCapture(
  page: Page,
  encoder: ReturnType<typeof createVideoEncoder>,
  quality = 90,
  maxWidth?: number,
  maxHeight?: number,
): Promise<AsyncCapture> {
  const cdp = await page.createCDPSession();

  await cdp.send("Page.startScreencast", {
    format: "png",
    quality,
    everyNthFrame: 1,
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(maxHeight !== undefined ? { maxHeight } : {}),
  });

  let shouldCapture = false;
  const captureWaiters: Array<() => void> = [];
  const queue: Buffer[] = [];
  let queueNotify: (() => void) | null = null;
  let stopped = false;

  // Background consumer: drains queue into ffmpeg without blocking the frame loop.
  const encoderDone = (async () => {
    while (true) {
      if (queue.length === 0) {
        if (stopped) break;
        await new Promise<void>((resolve) => {
          queueNotify = resolve;
        });
        queueNotify = null;
      }
      while (queue.length > 0) {
        await encoder.writeFrame(queue.shift()!);
      }
    }
  })();

  cdp.on("Page.screencastFrame", (event) => {
    const data = Buffer.from(event.data, "base64");
    // Ack immediately so Chrome keeps pushing without waiting on us.
    cdp
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(() => {});
    if (shouldCapture) {
      shouldCapture = false;
      queue.push(data);
      queueNotify?.();
      for (const resolve of captureWaiters.splice(0)) resolve();
    }
  });

  return {
    setCapture() {
      shouldCapture = true;
    },
    // Wait until Chrome pushes a frame after setCapture(). Falls through on
    // timeout so the frame loop doesn't stall if Chrome stops compositing
    // (e.g. mid-navigation). The shouldCapture flag stays true and the next
    // push will still be captured.
    waitForCapture(timeoutMs = 100): Promise<void> {
      if (!shouldCapture) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          const idx = captureWaiters.indexOf(wrapped);
          if (idx >= 0) captureWaiters.splice(idx, 1);
          resolve();
        }, timeoutMs);
        const wrapped = () => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve();
        };
        captureWaiters.push(wrapped);
      });
    },
    queueDepth() {
      return queue.length;
    },
    async stop() {
      stopped = true;
      queueNotify?.();
      for (const resolve of captureWaiters.splice(0)) resolve();
      await encoderDone;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
    },
  };
}

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
  workers?: number;
  waitForNetwork?: boolean;
  diagnose?: boolean;
}

// Runs the frame loop from timer.get() up to toMs.
// encoder=null means fast-forward mode (no screenshots taken).
// Returns the final event index.
async function runFrameRange(
  page: Page,
  events: Event[],
  toMs: number,
  timer: VirtualTimer,
  interval: number,
  asyncCapture: AsyncCapture | null,
  onProgress?: (virtualTime: number) => void,
  lastCursorPos?: { x: number; y: number },
  startEventIdx = 0,
  waitForNetwork = false,
  diagnose = false,
): Promise<number> {
  let eventIdx = startEventIdx;

  // Rolling window of per-phase timings (ms) for the last DIAG_WINDOW frames
  const DIAG_WINDOW = 60;
  type Phases = {
    events: number;
    tick: number;
    network: number;
    total: number;
  };
  const diagWindow: Phases[] = [];
  let frameCount = 0;
  let lastQueueDepth = 0;

  let lastAnimCount = 0;
  function printDiagLine() {
    const n = diagWindow.length;
    const avg = (k: keyof Phases) =>
      diagWindow.reduce((s, t) => s + t[k], 0) / n;
    const realFps = (1000 / avg("total")).toFixed(1);
    process.stdout.write(
      `\n  [diag #${frameCount}] real-fps=${realFps} anims=${lastAnimCount} queue=${lastQueueDepth} | ` +
        `events=${avg("events").toFixed(1)} tick=${avg("tick").toFixed(1)} ` +
        `network=${avg("network").toFixed(1)}  (ms/frame)\n`,
    );
  }

  while (timer.get() < toMs) {
    const windowEnd = timer.get() + interval;
    const t0 = performance.now();

    const currentEvents: Event[] = [];
    while (
      eventIdx < events.length &&
      events[eventIdx]!.timestamp < windowEnd
    ) {
      currentEvents.push(events[eventIdx]!);
      eventIdx++;
    }

    for (const event of currentEvents) {
      await applyEvent(page, event);
      if (lastCursorPos && "x" in event && Number.isFinite((event as any).x)) {
        lastCursorPos.x = (event as any).x;
        lastCursorPos.y = (event as any).y;
      }
    }
    const t1 = performance.now();

    // Scan for new animations every 4 frames — document.getAnimations() is
    // expensive on complex pages; 4-frame delay is imperceptible in output.
    const { animCount } = await evaluateTick(
      page,
      timer.get(),
      frameCount % 4 === 0,
    );
    if (animCount > 0) lastAnimCount = animCount;
    const t2 = performance.now();

    if (waitForNetwork) {
      await page
        .waitForNetworkIdle({ idleTime: 20, timeout: 500 })
        .catch(() => {});
    }
    const t3 = performance.now();

    if (asyncCapture !== null) {
      // Signal that we want the next compositor frame, then wait for Chrome to
      // push it. This paces the loop to one captured frame per virtual frame
      // while letting ffmpeg writes happen in the background queue consumer.
      asyncCapture.setCapture();
      await asyncCapture.waitForCapture(interval * 2);
      const t4 = performance.now();

      if (diagnose) {
        lastQueueDepth = asyncCapture.queueDepth();
        const timing: Phases = {
          events: t1 - t0,
          tick: t2 - t1,
          network: t3 - t2,
          total: t4 - t0,
        };
        diagWindow.push(timing);
        if (diagWindow.length > DIAG_WINDOW) diagWindow.shift();
        frameCount++;
        if (frameCount % DIAG_WINDOW === 0) printDiagLine();
      }
    }

    timer.advance(interval);
    onProgress?.(timer.get());
  }

  return eventIdx;
}

async function setupPage(
  session: Session,
  opts: ReplayOptions,
  timer: VirtualTimer,
) {
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

  await setupDocumentReplayOverrides(page, timer, opts.scrollSmoothing);
  await page.goto(session.startUrl);

  const showCursor = opts.cursor ?? true;
  const firstCoordEvent = session.events.find(
    (e) => "x" in e && Number.isFinite((e as any).x),
  );
  const lastCursorPos = {
    x: firstCoordEvent ? (firstCoordEvent as any).x : 0,
    y: firstCoordEvent ? (firstCoordEvent as any).y : 0,
  };

  await setupCursor(
    page,
    showCursor,
    opts.cursorSmoothing,
    lastCursorPos.x,
    lastCursorPos.y,
  );

  page.on("framenavigated", async (frame) => {
    if (frame.parentFrame() !== null) return;
    await reinjectCursor(
      page,
      lastCursorPos.x,
      lastCursorPos.y,
      showCursor,
      opts.cursorSmoothing,
    );
  });

  return { browser, page, lastCursorPos };
}

async function replayChunk(
  chunkIdx: number,
  totalChunks: number,
  session: Session,
  chunkStart: number,
  chunkEnd: number,
  outputPath: string,
  opts: ReplayOptions,
): Promise<void> {
  const fps = opts.fps || 60;
  const interval = 1000 / fps;
  const scale = opts.scale ?? 1;
  const timer = new VirtualTimer();

  const { browser, page, lastCursorPos } = await setupPage(
    session,
    opts,
    timer,
  );

  try {
    // Fast-forward to chunk start without taking screenshots
    let eventIdx = 0;
    if (chunkStart > 0) {
      eventIdx = await runFrameRange(
        page,
        session.events,
        chunkStart,
        timer,
        interval,
        null,
        undefined,
        lastCursorPos,
        0,
        opts.waitForNetwork,
      );
    }

    const encoder = createVideoEncoder(
      fps,
      outputPath,
      session.viewport.width * scale,
      session.viewport.height * scale,
      opts.quality,
    );
    const asyncCapture = await startAsyncCapture(
      page,
      encoder,
      undefined,
      session.viewport.width * scale,
      session.viewport.height * scale,
    );

    try {
      if (totalChunks === 1) {
        const totalDuration = chunkEnd - chunkStart;
        function renderProgress(virtualTime: number) {
          const elapsed = virtualTime - chunkStart;
          const pct = Math.min(elapsed / totalDuration, 1);
          const BAR_WIDTH = 30;
          const filled = Math.round(pct * BAR_WIDTH);
          const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
          const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
          const cur = (elapsed / 1000).toFixed(1).padStart(6);
          const tot = (totalDuration / 1000).toFixed(1).padStart(6);
          process.stdout.write(
            `\rReplaying  [${bar}] ${pctStr}  ${cur}s / ${tot}s`,
          );
        }

        await runFrameRange(
          page,
          session.events,
          chunkEnd,
          timer,
          interval,
          asyncCapture,
          renderProgress,
          lastCursorPos,
          eventIdx,
          opts.waitForNetwork,
          opts.diagnose,
        );
        process.stdout.write("\n");
      } else {
        await runFrameRange(
          page,
          session.events,
          chunkEnd,
          timer,
          interval,
          asyncCapture,
          undefined,
          lastCursorPos,
          eventIdx,
          opts.waitForNetwork,
          opts.diagnose,
        );
        const dur = ((chunkEnd - chunkStart) / 1000).toFixed(1);
        console.log(
          `  chunk ${chunkIdx + 1}/${totalChunks} done (${dur}s rendered)`,
        );
      }
    } finally {
      // Flush all queued frames into ffmpeg, then close it.
      await asyncCapture.stop();
    }
    await encoder.finish();
  } finally {
    await browser.close();
  }
}

export async function replay(sessionPath: string, opts: ReplayOptions = {}) {
  const workers = opts.workers ?? 1;
  const file = readFileSync(sessionPath, "utf-8");
  const session: Session = JSON.parse(file);

  const sessionDuration = Math.max(...session.events.map((e) => e.timestamp));
  const maxTime =
    opts.duration != null ? opts.duration * 1000 : sessionDuration;

  if (workers === 1) {
    await replayChunk(0, 1, session, 0, maxTime, "output.mp4", opts);
    return;
  }

  const chunkSize = maxTime / workers;
  const chunks = Array.from({ length: workers }, (_, i) => ({
    start: i * chunkSize,
    end: i === workers - 1 ? maxTime : (i + 1) * chunkSize,
    path: `wsr_chunk_${i}_${Date.now()}.mp4`,
  }));

  console.log(`Rendering ${workers} chunks in parallel...`);

  try {
    await Promise.all(
      chunks.map(({ start, end, path }, i) =>
        replayChunk(i, workers, session, start, end, path, opts),
      ),
    );

    process.stdout.write("Concatenating chunks...");
    await concatVideos(
      chunks.map((c) => c.path),
      "output.mp4",
    );
    console.log(" done. Output: output.mp4");
  } finally {
    for (const { path } of chunks) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}

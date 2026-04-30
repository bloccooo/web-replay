import { type Page } from "puppeteer";
import { writeFileSync } from "fs";
import type { Session, SessionEvent, MouseButtonEvent, WheelEvent as ReplayWheelEvent } from "./types.js";
import { launchBrowser } from "./browser.js";

const MOUSEMOVE_INTERVAL_MS = 32;

export interface RecordOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

export async function record(startUrl: string, outputPath: string, opts: RecordOptions = {}): Promise<void> {
  const { browser, page } = await launchBrowser(opts);

  const startTime = Date.now();
  const events: SessionEvent[] = [];

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  let lastMouseMoveTime = 0;

  function elapsed() {
    return Date.now() - startTime;
  }

  async function attachPageListeners(pg: Page) {
    const vp = await pg.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    await pg.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;

      document.addEventListener("mousemove", (e: MouseEvent) => {
        w.__replayMouseMove?.({ x: e.clientX, y: e.clientY });
      }, { capture: true, passive: true });

      document.addEventListener("mousedown", (e: MouseEvent) => {
        w.__replayMouseDown?.({ x: e.clientX, y: e.clientY, button: e.button });
      }, { capture: true, passive: true });

      document.addEventListener("mouseup", (e: MouseEvent) => {
        w.__replayMouseUp?.({ x: e.clientX, y: e.clientY, button: e.button });
      }, { capture: true, passive: true });

      document.addEventListener("wheel", (e) => {
        w.__replayWheel?.({ deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode });
      }, { capture: true, passive: true });

      document.addEventListener("input", (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        w.__replayInput?.({ value: target.value });
      }, { capture: true, passive: true });

      document.addEventListener("keydown", (e: KeyboardEvent) => {
        w.__replayKeydown?.({ key: e.key });
      }, { capture: true, passive: true });

      document.addEventListener("keyup", (e: KeyboardEvent) => {
        w.__replayKeyup?.({ key: e.key });
      }, { capture: true, passive: true });
    });

    await pg.exposeFunction("__replayMouseMove", (data: { x: number; y: number }) => {
      const t = elapsed();
      if (t - lastMouseMoveTime < MOUSEMOVE_INTERVAL_MS) return;
      lastMouseMoveTime = t;
      events.push({ type: "mousemove", x: data.x, y: data.y, t, vw: vp.width, vh: vp.height });
    });

    await pg.exposeFunction("__replayMouseDown", (data: { x: number; y: number; button: number }) => {
      events.push({ type: "mousedown", x: data.x, y: data.y, button: data.button, t: elapsed(), vw: vp.width, vh: vp.height } as MouseButtonEvent);
    });

    await pg.exposeFunction("__replayMouseUp", (data: { x: number; y: number; button: number }) => {
      events.push({ type: "mouseup", x: data.x, y: data.y, button: data.button, t: elapsed(), vw: vp.width, vh: vp.height } as MouseButtonEvent);
    });

    await pg.exposeFunction("__replayWheel", (data: { deltaX: number; deltaY: number; deltaMode: number }) => {
      events.push({ type: "wheel", deltaX: data.deltaX, deltaY: data.deltaY, deltaMode: data.deltaMode, t: elapsed() } as ReplayWheelEvent);
    });

    await pg.exposeFunction("__replayInput", (data: { value: string }) => {
      events.push({ type: "input", value: data.value, t: elapsed() });
    });

    await pg.exposeFunction("__replayKeydown", (data: { key: string }) => {
      events.push({ type: "keydown", key: data.key, t: elapsed() });
    });

    await pg.exposeFunction("__replayKeyup", (data: { key: string }) => {
      events.push({ type: "keyup", key: data.key, t: elapsed() });
    });
  }

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    events.push({ type: "navigate", url: frame.url(), t: elapsed() });
  });

  page.on("load", () => {
    attachPageListeners(page).catch(() => {});
  });

  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  await attachPageListeners(page);

  console.log("Recording started. Close the browser window to stop.");

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });

  const session: Session = {
    version: 1,
    startUrl,
    viewport,
    events,
  };

  writeFileSync(outputPath, JSON.stringify(session, null, 2));
  console.log(`Session saved to ${outputPath} (${events.length} events)`);
}

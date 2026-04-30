import { type Page } from "puppeteer";
import { readFileSync } from "fs";
import type {
  Session,
  SessionEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  NavigateEvent,
  WheelEvent as ReplayWheelEvent,
  InputEvent,
  KeyEvent,
} from "./types.js";
import { injectCursor, setCursorPosition } from "./cursor.js";
import { launchBrowser } from "./browser.js";

export interface ReplayOptions {
  speed?: number;
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

export async function replay(sessionPath: string, opts: ReplayOptions = {}): Promise<void> {
  const raw = readFileSync(sessionPath, "utf-8");
  const session: Session = JSON.parse(raw);
  const speed = opts.speed ?? 1;

  const { browser, page } = await launchBrowser({
    width: opts.width ?? session.viewport.width,
    height: opts.height ?? session.viewport.height,
    fullscreen: opts.fullscreen,
  });

  // Start cursor at the first recorded mouse position to avoid an initial jump.
  const firstMove = session.events.find((e) => e.type === "mousemove") as MouseMoveEvent | undefined;
  let cursorX = firstMove?.x ?? 0;
  let cursorY = firstMove?.y ?? 0;

  async function hideCursor(pg: Page) {
    await pg.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "* { cursor: none !important; }";
      document.head?.appendChild(style);
    });
  }

  async function navigate(pg: Page, url: string) {
    await pg.goto(url, { waitUntil: "domcontentloaded" });
    await hideCursor(pg);
    // Inject cursor pre-positioned at the last known location.
    await injectCursor(pg, cursorX, cursorY);
    // Also move Puppeteer's internal mouse state there so the first mouse.move
    // delta is correct (avoids a snap back to 0,0 on the next move call).
    await pg.mouse.move(cursorX, cursorY);
  }

  await page.evaluateOnNewDocument(() => {
    const style = document.createElement("style");
    style.textContent = "* { cursor: none !important; }";
    document.head?.appendChild(style);
  });

  console.log(`Replaying ${session.events.length} events at ${speed}x speed...`);

  await navigate(page, session.startUrl);

  const buttonsDown = new Set<string>();

  // Wall-clock reference: session time 0 maps to replayStart.
  const replayStart = Date.now();

  function targetTime(t: number) {
    return replayStart + t / speed;
  }

  async function waitUntil(t: number) {
    const remaining = targetTime(t) - Date.now();
    if (remaining > 1) await sleep(remaining);
  }

  for (const event of session.events) {
    switch (event.type) {
      case "navigate": {
        await waitUntil(event.t);
        const nav = event as NavigateEvent;
        if (nav.url !== page.url()) {
          await navigate(page, nav.url);
        }
        break;
      }

      case "mousemove": {
        const me = event as MouseMoveEvent;
        const fromX = cursorX;
        const fromY = cursorY;
        const toX = me.x;
        const toY = me.y;
        const end = targetTime(me.t);
        const duration = end - Date.now();

        if (duration <= 16 || (fromX === toX && fromY === toY)) {
          await waitUntil(me.t);
          await page.mouse.move(toX, toY);
        } else {
          // Interpolate at ~60fps, using wall-clock for each step so CDP
          // overhead doesn't accumulate into timing drift.
          const steps = Math.ceil(duration / 16);
          const start = Date.now();
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const x = Math.round(fromX + (toX - fromX) * t);
            const y = Math.round(fromY + (toY - fromY) * t);
            await page.mouse.move(x, y);
            const stepTarget = start + (end - start) * t;
            const remaining = stepTarget - Date.now();
            if (remaining > 1) await sleep(remaining);
          }
        }

        cursorX = toX;
        cursorY = toY;
        break;
      }

      case "mousedown": {
        await waitUntil(event.t);
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await page.mouse.down({ button: btn });
        buttonsDown.add(btn);
        break;
      }

      case "mouseup": {
        await waitUntil(event.t);
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (!buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await page.mouse.up({ button: btn });
        buttonsDown.delete(btn);
        break;
      }

      case "wheel": {
        await waitUntil(event.t);
        const we = event as ReplayWheelEvent;
        // Normalize to pixels — page.mouse.wheel() always dispatches in pixel mode.
        // deltaMode 1 = lines (~40px each), deltaMode 2 = pages (viewport height).
        const LINE = 40;
        const PAGE = session.viewport.height;
        const scale = we.deltaMode === 1 ? LINE : we.deltaMode === 2 ? PAGE : 1;
        await page.mouse.wheel({ deltaX: we.deltaX * scale, deltaY: we.deltaY * scale });
        break;
      }

      case "input": {
        await waitUntil(event.t);
        const ie = event as InputEvent;
        await page.evaluate((val: string) => {
          const el = document.activeElement as HTMLInputElement | null;
          if (!el || el === document.body) return;
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, ie.value);
        break;
      }

      case "keydown": {
        await waitUntil(event.t);
        const ke = event as KeyEvent;
        await page.keyboard.down(ke.key as Parameters<typeof page.keyboard.down>[0]);
        break;
      }

      case "keyup": {
        await waitUntil(event.t);
        const ke = event as KeyEvent;
        await page.keyboard.up(ke.key as Parameters<typeof page.keyboard.up>[0]);
        break;
      }
    }
  }

  console.log("Replay complete.");
  await browser.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

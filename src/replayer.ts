import { type Page } from "puppeteer";
import { readFileSync } from "fs";
import type {
  Session,
  SessionEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  NavigateEvent,
  ScrollEvent,
  InputEvent,
  KeyEvent,
} from "./types.js";
import { injectCursor, moveCursor } from "./cursor.js";
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
    await injectCursor(pg);
  }

  await page.evaluateOnNewDocument(() => {
    const style = document.createElement("style");
    style.textContent = "* { cursor: none !important; }";
    document.head?.appendChild(style);
  });

  console.log(`Replaying ${session.events.length} events at ${speed}x speed...`);

  await navigate(page, session.startUrl);

  const buttonsDown = new Set<string>();
  let prevT = 0;
  let cursorX = 0;
  let cursorY = 0;

  for (const event of session.events) {
    const delay = Math.max(0, (event.t - prevT) / speed);
    prevT = event.t;

    switch (event.type) {
      case "navigate": {
        if (delay > 0) await sleep(delay);
        const nav = event as NavigateEvent;
        if (nav.url !== page.url()) {
          await navigate(page, nav.url);
        }
        break;
      }

      case "mousemove": {
        // Interpolate at ~60fps from the last cursor position to this one
        // over the exact recorded duration so the cursor never skips frames.
        const me = event as MouseMoveEvent;
        const fromX = cursorX;
        const fromY = cursorY;
        const toX = me.x;
        const toY = me.y;

        if (delay <= 16 || (fromX === toX && fromY === toY)) {
          // Short gap or no movement — just move directly
          await page.mouse.move(toX, toY);
          await moveCursor(page, toX, toY);
          if (delay > 0) await sleep(delay);
        } else {
          const steps = Math.ceil(delay / 16);
          const stepMs = delay / steps;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const x = Math.round(fromX + (toX - fromX) * t);
            const y = Math.round(fromY + (toY - fromY) * t);
            await page.mouse.move(x, y);
            await moveCursor(page, x, y);
            await sleep(stepMs);
          }
        }

        cursorX = toX;
        cursorY = toY;
        break;
      }

      case "mousedown": {
        if (delay > 0) await sleep(delay);
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await moveCursor(page, me.x, me.y);
        await page.mouse.down({ button: btn });
        buttonsDown.add(btn);
        break;
      }

      case "mouseup": {
        if (delay > 0) await sleep(delay);
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (!buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await moveCursor(page, me.x, me.y);
        await page.mouse.up({ button: btn });
        buttonsDown.delete(btn);
        break;
      }

      case "scroll": {
        if (delay > 0) await sleep(delay);
        const se = event as ScrollEvent;
        await page.evaluate(
          (sx: number, sy: number) => window.scrollTo(sx, sy),
          se.scrollX,
          se.scrollY
        );
        break;
      }

      case "input": {
        if (delay > 0) await sleep(delay);
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
        if (delay > 0) await sleep(delay);
        const ke = event as KeyEvent;
        await page.keyboard.down(ke.key as Parameters<typeof page.keyboard.down>[0]);
        break;
      }

      case "keyup": {
        if (delay > 0) await sleep(delay);
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

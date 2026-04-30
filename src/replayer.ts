import { type Page } from "puppeteer";
import { readFileSync } from "fs";
import type {
  Session,
  SessionEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  ScrollEvent,
  InputEvent,
  KeyEvent,
} from "./types.js";
import { injectCursor } from "./cursor.js";
import { launchBrowser } from "./browser.js";

export interface ReplayOptions {
  speed?: number;
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

export async function replay(
  sessionPath: string,
  opts: ReplayOptions = {},
): Promise<void> {
  const raw = readFileSync(sessionPath, "utf-8");
  const session: Session = JSON.parse(raw);
  const speed = opts.speed ?? 1;

  const { browser, page } = await launchBrowser({
    width: opts.width ?? session.viewport.width,
    height: opts.height ?? session.viewport.height,
    fullscreen: opts.fullscreen,
  });

  // Start cursor at the first recorded mouse position to avoid an initial jump.
  const firstMove = session.events.find((e) => e.type === "mousemove") as
    | MouseMoveEvent
    | undefined;
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

  console.log(
    `Replaying ${session.events.length} events at ${speed}x speed...`,
  );

  await navigate(page, session.startUrl);

  const buttonsDown = new Set<string>();

  const replayStart = performance.now();

  function sessionElapsed() {
    return (performance.now() - replayStart) * speed;
  }

  async function executeEvent(event: SessionEvent) {
    switch (event.type) {
      case "mousemove": {
        const me = event as MouseMoveEvent;
        await page.mouse.move(me.x, me.y);
        cursorX = me.x;
        cursorY = me.y;
        break;
      }
      case "mousedown": {
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await page.mouse.down({ button: btn });
        buttonsDown.add(btn);
        break;
      }
      case "mouseup": {
        const me = event as MouseButtonEvent;
        const btn = me.button === 2 ? "right" : "left";
        if (!buttonsDown.has(btn)) break;
        await page.mouse.move(me.x, me.y);
        await page.mouse.up({ button: btn });
        buttonsDown.delete(btn);
        break;
      }
      case "scroll": {
        const se = event as ScrollEvent;
        if (se.isWindow) {
          await page.evaluate(
            (sx: number, sy: number) => window.scrollTo(sx, sy),
            se.scrollX,
            se.scrollY,
          );
        } else {
          await page.evaluate(
            (sx: number, sy: number, cx: number, cy: number) => {
              let el: Element | null = document.elementFromPoint(cx, cy);
              while (el && el !== document.documentElement) {
                const { overflow, overflowX, overflowY } = getComputedStyle(el);
                const scrollable = overflow + overflowX + overflowY;
                if (
                  (scrollable.includes("auto") ||
                    scrollable.includes("scroll")) &&
                  (el.scrollHeight > el.clientHeight ||
                    el.scrollWidth > el.clientWidth)
                ) {
                  el.scrollTo(sx, sy);
                  return;
                }
                el = el.parentElement;
              }
            },
            se.scrollX,
            se.scrollY,
            cursorX,
            cursorY,
          );
        }
        break;
      }
      case "input": {
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
        const ke = event as KeyEvent;
        await page.keyboard.down(
          ke.key as Parameters<typeof page.keyboard.down>[0],
        );
        break;
      }
      case "keyup": {
        const ke = event as KeyEvent;
        await page.keyboard.up(
          ke.key as Parameters<typeof page.keyboard.up>[0],
        );
        break;
      }
    }
  }

  let ei = 0;
  while (ei < session.events.length) {
    const now = sessionElapsed();

    while (ei < session.events.length && session.events[ei]!.t <= now) {
      await executeEvent(session.events[ei]!);
      ei++;
    }

    if (ei >= session.events.length) break;
  }

  console.log("Replay complete.");
  await browser.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { writeFileSync } from "node:fs";
import { launchBrowser } from "./browser";
import type { Session, Event } from "./types";

export interface RecordOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

const COORD_EVENTS = new Set(["mousemove", "mousedown", "mouseup", "pointerdown", "pointerup", "click"]);

function hasValidCoords(event: Event): boolean {
  if (!COORD_EVENTS.has(event.type)) return true;
  const { x, y } = event as any;
  return Number.isFinite(x) && Number.isFinite(y);
}

function sanitizeEvents(events: Event[]): Event[] {
  const out: Event[] = [];
  let isDown = false;

  for (const event of events) {
    if (!hasValidCoords(event)) continue;
    if (event.type === "pointerdown" || event.type === "mousedown") {
      if (isDown) continue; // duplicate down — drop
      isDown = true;
      out.push(event);
    } else if (event.type === "pointerup" || event.type === "mouseup") {
      if (!isDown) continue; // orphan up — drop
      isDown = false;
      out.push(event);
    } else if (event.type === "click") {
      if (isDown) continue; // click while logically down — drop
      // Find the most recent pointerup within 500ms of this click.
      let upIdx = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        const t = out[i]!.type;
        if (t === "pointerup" || t === "mouseup") { upIdx = i; break; }
      }
      if (upIdx !== -1 && event.timestamp - out[upIdx]!.timestamp <= 500) {
        let downIdx = -1;
        for (let i = upIdx - 1; i >= 0; i--) {
          const t = out[i]!.type;
          if (t === "pointerdown" || t === "mousedown") { downIdx = i; break; }
        }
        const downEvent = downIdx !== -1 ? out[downIdx] : null;
        const dx = downEvent ? event.x - (downEvent as any).x : 0;
        const dy = downEvent ? event.y - (downEvent as any).y : 0;
        const movedFar = Math.sqrt(dx * dx + dy * dy) >= 5;
        if (movedFar) {
          // Drag followed by a spurious click — keep down/up, drop the click.
          continue;
        }
        // Normal tap/click — strip down/up and use the click event.
        out.splice(upIdx, 1);
        if (downIdx !== -1) out.splice(downIdx, 1);
      }
      out.push(event);
    } else {
      out.push(event);
    }
  }

  return out;
}

export async function record(
  startUrl: string,
  outputPath: string,
  opts: RecordOptions = {},
) {
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const fullscreen = !!opts.fullscreen;

  const { browser, page } = await launchBrowser({
    width,
    height,
    fullscreen,
  });

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

  await page.exposeFunction(
    "recordKeyboard",
    (event: { type: "keydown" | "keyup"; key: string; code: string }) => {
      events.push({ ...event, timestamp: elapsed() });
    },
  );

  await page.exposeFunction(
    "recordMouseButton",
    (event: {
      type: "mousedown" | "mouseup" | "pointerdown" | "pointerup" | "click";
      x: number;
      y: number;
      button: number;
    }) => {
      events.push({ ...event, timestamp: elapsed() });
    },
  );

  await page.exposeFunction(
    "recordScroll",
    (event: { scrollX: number; scrollY: number; selector: string }) => {
      events.push({
        ...event,
        type: "scroll",
        timestamp: elapsed(),
      });
    },
  );

  // Use evaluateOnNewDocument so listeners survive cross-page navigations.
  await page.evaluateOnNewDocument(() => {
    const w = window as any;

    function getElementSelector(el: Element): string {
      const path: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (node.id) {
          path.unshift(`${node.tagName.toLowerCase()}#${node.id}`);
          break;
        }
        const siblings = node.parentNode
          ? Array.from(node.parentNode.children).filter(
              (s) => s.tagName === (node as Element).tagName,
            )
          : [node];
        const idx = siblings.indexOf(node) + 1;
        path.unshift(
          siblings.length > 1
            ? `${node.tagName.toLowerCase()}:nth-of-type(${idx})`
            : node.tagName.toLowerCase(),
        );
        node = node.parentNode as Element | null;
      }
      return path.join(" > ");
    }

    document.addEventListener(
      "mousemove",
      (e) => w.recordMouseMove({ x: e.clientX, y: e.clientY }),
      { capture: true, passive: true },
    );

    document.addEventListener(
      "keydown",
      (e) => w.recordKeyboard({ type: "keydown", key: e.key, code: e.code }),
      { capture: true, passive: true },
    );

    document.addEventListener(
      "keyup",
      (e) => w.recordKeyboard({ type: "keyup", key: e.key, code: e.code }),
      { capture: true, passive: true },
    );

    // Use pointerdown/pointerup instead of mousedown/mouseup — some libraries
    // (e.g. Swiper with touch-action set) suppress the mouse compat events entirely.

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!e.isPrimary) return;
        w.recordMouseButton({
          type: "pointerdown",
          x: e.clientX,
          y: e.clientY,
          button: e.button,
        });
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      "pointerup",
      (e) => {
        if (!e.isPrimary) return;
        w.recordMouseButton({
          type: "pointerup",
          x: e.clientX,
          y: e.clientY,
          button: e.button,
        });
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      "click",
      (e) => {
        w.recordMouseButton({
          type: "click",
          x: e.clientX,
          y: e.clientY,
          button: e.button,
        });
      },
      { capture: true, passive: true },
    );

    let lastUserInputTime = 0;
    document.addEventListener(
      "wheel",
      (e) => {
        lastUserInputTime = Date.now();
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      "scroll",
      (e) => {
        const target = e.target;
        const el: Element =
          target === document
            ? (document.scrollingElement ?? document.documentElement)
            : (target as Element);

        w.recordScroll({
          scrollX: target === document ? window.scrollX : el.scrollLeft,
          scrollY: target === document ? window.scrollY : el.scrollTop,
          selector: getElementSelector(el),
        });
      },
      { capture: true, passive: true },
    );
  });

  await page.goto(startUrl);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });

  const session: Session = {
    version: 1,
    startUrl,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      fullscreen,
    },
    events: sanitizeEvents(events),
  };

  writeFileSync(outputPath, JSON.stringify(session, null, 2));
}

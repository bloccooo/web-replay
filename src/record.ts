import { writeFileSync } from "node:fs";
import { launchBrowser } from "./browser";
import type { Session, Event } from "./types";

export interface RecordOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
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

  await page.goto(startUrl);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

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
      type: "mousedown" | "mouseup";
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

  await page.evaluate(() => {
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

    document.addEventListener("mousemove", (e) =>
      w.recordMouseMove({ x: e.clientX, y: e.clientY }),
    );

    document.addEventListener("keydown", (e) =>
      w.recordKeyboard({ type: "keydown", key: e.key, code: e.code }),
    );

    document.addEventListener("keyup", (e) =>
      w.recordKeyboard({ type: "keyup", key: e.key, code: e.code }),
    );

    document.addEventListener("mousedown", (e) =>
      w.recordMouseButton({
        type: "mousedown",
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      }),
    );

    document.addEventListener("mouseup", (e) =>
      w.recordMouseButton({
        type: "mouseup",
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      }),
    );

    let lastUserInputTime = 0;
    document.addEventListener("wheel", (e) => {
      lastUserInputTime = Date.now();
    });

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
      { capture: true },
    );
  });

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
    events,
  };

  writeFileSync(outputPath, JSON.stringify(session, null, 2));
}

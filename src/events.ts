import type { Page } from "puppeteer";

export type MouseEvent = {
  type: "mousemove";
  timestamp: number;
  x: number;
  y: number;
};

export type ScrollEvent = {
  type: "scroll";
  timestamp: number;
  scrollX: number;
  scrollY: number;
};

export type Event = MouseEvent | ScrollEvent;

export async function applyEvent(page: Page, event: Event) {
  if (event.type === "mousemove") {
    await page.mouse.move(event.x, event.y);
  } else if (event.type === "scroll") {
    await page.evaluate(
      ({ scrollX, scrollY }) => {
        const { cursorX, cursorY } = window._webRecorder;
        let el: Element | null = document.elementFromPoint(cursorX, cursorY);
        while (el && el !== document.documentElement) {
          const { overflowY, overflowX } = getComputedStyle(el);
          if (/(auto|scroll)/.test(overflowY + overflowX)) {
            window._webRecorder.scrollTargets.set(el, { x: scrollX, y: scrollY });
            return;
          }
          el = el.parentElement;
        }
        const root = document.scrollingElement ?? document.documentElement;
        window._webRecorder.scrollTargets.set(root, { x: scrollX, y: scrollY });
      },
      { scrollX: event.scrollX, scrollY: event.scrollY },
    );
  }
}

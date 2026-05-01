import type { Page } from "puppeteer";

export type MouseEvent = {
  type: "mousemove";
  timestamp: number;
  x: number;
  y: number;
};

export type Event = MouseEvent;

export async function applyEvent(page: Page, event: Event) {
  if (event.type === "mousemove") {
    await page.mouse.move(event.x, event.y);
  }
}

import type { Page } from "puppeteer";

const CURSOR_ID = "__replay_cursor__";

// macOS-style arrow cursor, tip at top-left (0,0)
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="38" viewBox="0 0 32 38">
  <defs>
    <filter id="cs" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="1" stdDeviation="1.5" flood-color="#fff" flood-opacity="0.4"/>
    </filter>
  </defs>
  <path d="M3 1 L3 29 L8.5 23.5 L12 32 L16 30.5 L12.5 22 L20 22 Z"
        fill="black" stroke="white" stroke-width="1.2"
        stroke-linejoin="round" stroke-linecap="round"
        filter="url(#cs)"/>
</svg>`;

export async function injectCursor(page: Page): Promise<void> {
  await page.evaluate(
    ({ id, svg }: { id: string; svg: string }) => {
      if (document.getElementById(id)) return;
      const wrapper = document.createElement("div");
      wrapper.id = id;
      wrapper.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "width:32px",
        "height:38px",
        "pointer-events:none",
        "z-index:2147483647",
        "will-change:transform",
      ].join(";");
      wrapper.innerHTML = svg;
      document.documentElement.appendChild(wrapper);
    },
    { id: CURSOR_ID, svg: CURSOR_SVG }
  );
}

export async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ id, x, y }: { id: string; x: number; y: number }) => {
      const el = document.getElementById(id);
      if (el) el.style.transform = `translate(${x}px,${y}px)`;
    },
    { id: CURSOR_ID, x, y }
  );
}

export async function ensureCursor(page: Page): Promise<void> {
  await injectCursor(page);
}

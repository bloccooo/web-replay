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

export async function injectCursor(page: Page, x = 0, y = 0): Promise<void> {
  await page.evaluate(
    ({ id, svg, x, y }: { id: string; svg: string; x: number; y: number }) => {
      if (document.getElementById(id)) return;
      const el = document.createElement("div");
      el.id = id;
      el.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "width:32px",
        "height:38px",
        "pointer-events:none",
        "z-index:2147483647",
        "will-change:transform",
        `transform:translate(${x}px,${y}px)`,
      ].join(";");
      el.innerHTML = svg;
      document.documentElement.appendChild(el);

      let mouseX = x;
      let mouseY = y;
      let targetX = x;
      let targetY = y;

      // Auto-follow Puppeteer's synthetic mouse events — no round-trip needed per frame.
      document.addEventListener(
        "mousemove",
        (e) => {
          targetX = e.clientX;
          targetY = e.clientY;
        },
        { capture: true, passive: true },
      );

      function animateCursor() {
        mouseX += (targetX - mouseX) * 0.3;
        mouseY += (targetY - mouseY) * 0.3;

        el.style.transform = `translate(${mouseX}px,${mouseY}px)`;

        requestAnimationFrame(animateCursor);
      }

      animateCursor();
    },
    { id: CURSOR_ID, svg: CURSOR_SVG, x, y },
  );
}

export const CARET_ID = "__replay_caret__";

export async function injectCustomCaret(page: Page): Promise<void> {
  await page.evaluate(
    ({ id }) => {
      const style = document.createElement("style");
      style.textContent =
        "*, *::before, *::after { caret-color: transparent !important; }";
      document.head.appendChild(style);

      const caret = document.createElement("div");
      caret.id = id;
      caret.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "width:1px",
        "background:black",
        "pointer-events:none",
        "z-index:2147483646",
        "display:none",
      ].join(";");
      document.documentElement.appendChild(caret);
    },
    { id: CARET_ID },
  );
}

/** Force cursor to a position without a mouse event (e.g. right after navigation). */
export async function setCursorPosition(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ id, x, y }: { id: string; x: number; y: number }) => {
      const el = document.getElementById(id);
      if (el) el.style.transform = `translate(${x}px,${y}px)`;
    },
    { id: CURSOR_ID, x, y },
  );
}

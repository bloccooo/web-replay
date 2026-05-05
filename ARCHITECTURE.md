# Architecture

`web-session-replay` records browser sessions as structured event logs and replays them as MP4 videos. There are two independent phases: **record** and **replay**.

---

## Record phase

Recording runs a real Chromium instance (headed) and injects JavaScript listeners into every page the user visits.

### Event capture

`page.exposeFunction` bridges from the page's JS context into the Node/Bun process. Four bridge functions are registered before navigation:

| Bridge function | Events captured |
|---|---|
| `recordMouseMove` | `mousemove` (clientX/Y) |
| `recordKeyboard` | `keydown`, `keyup` (key, code) |
| `recordMouseButton` | `pointerdown`, `pointerup`, `click` (x, y, button) |
| `recordScroll` | `scroll` (scrollX, scrollY, CSS selector of target element) |

Listeners are installed with `page.evaluateOnNewDocument` so they survive cross-page navigations. All events are captured in the capture phase (`{ capture: true }`) to see them before any `stopPropagation` call can hide them.

Mouse buttons prefer `pointerdown`/`pointerup` over `mousedown`/`mouseup` because some UI libraries (e.g. Swiper) suppress the mouse compat events entirely when `touch-action` is set.

Each event is timestamped with `performance.now() - startTime` (milliseconds since recording began).

### Scroll target identification

For scroll events, the recorder walks up the DOM from the scroll target to produce a CSS selector path. It anchors on `id` attributes when available (e.g. `div#sidebar`), otherwise uses `tagName:nth-of-type(n)` to disambiguate siblings. This selector is stored in the event and used at replay time to find the same scrollable element.

### Event sanitization

Raw pointer events from the browser contain redundant or contradictory sequences. `sanitizeEvents` normalises the stream before saving:

- **Invalid coordinates** — pointer events with non-finite x/y are dropped.
- **Duplicate down events** — a second `pointerdown` without an intervening `pointerup` is dropped (state machine tracks `isDown`).
- **Orphan up events** — a `pointerup` with no preceding `pointerdown` is dropped.
- **Click deduplication** — browsers emit `pointerdown → pointerup → click`. The sanitizer collapses these into a single `click` event (stripping the down/up pair) because Puppeteer's `page.mouse.click` synthesizes a full down/up/click sequence internally. If the pointer moved more than 5px between down and up it was a drag, not a tap, so the click is dropped and the down/up pair is kept instead.

### Session file format

Recording ends when the browser is closed. The event stream is written as JSON:

```json
{
  "version": 1,
  "startUrl": "https://example.com",
  "viewport": { "width": 1280, "height": 720, "fullscreen": false },
  "events": [
    { "type": "mousemove", "timestamp": 412.3, "x": 640, "y": 360 },
    { "type": "scroll",    "timestamp": 820.1, "scrollX": 0, "scrollY": 340, "selector": "div#feed" },
    { "type": "click",     "timestamp": 1203.5, "x": 300, "y": 200, "button": 0 },
    ...
  ]
}
```

---

## Replay phase

Replay opens a headless Chromium, navigates to `startUrl`, drives the page forward through virtual time, and encodes each frame into an MP4.

### Virtual time

The replay overrides all time-related browser APIs in the page (`Date.now`, `performance.now`, `setTimeout`, `setInterval`, `requestAnimationFrame`) with an implementation controlled by a `VirtualTimer`. Real wall-clock time is irrelevant; the page only sees the virtual clock advancing in fixed steps of `1000/fps` ms per frame.

Each frame, `evaluateTick` runs a single `page.evaluate` that:

1. Advances `window._webRecorder.virtualTime`.
2. Detects new CSS animations/transitions (throttled: only every 4 frames, since `document.getAnimations()` is expensive).
3. Drives tracked animations by setting `animationRef.currentTime = elapsed` and calling `finish()` when done — without calling `document.getAnimations()` on non-scan frames.
4. Fires pending `requestAnimationFrame` callbacks.
5. Fires `setTimeout` and `setInterval` callbacks whose scheduled time has passed.
6. Updates the custom text caret position.

### Event application

For each virtual frame, all recorded events whose timestamp falls within the current time window are applied via Puppeteer's input APIs (`page.mouse.move`, `page.mouse.click`, `page.keyboard.down`, etc.). Scroll events update a `scrollTargets` map in the page rather than calling scroll APIs directly; a `requestAnimationFrame` loop in the page smoothly interpolates toward each target using exponential smoothing.

### Frame capture pipeline

After applying events and ticking the virtual clock, the replay signals Chrome to capture the current compositor frame:

```
main loop                    Chrome compositor         ffmpeg
─────────────────────────────────────────────────────────────
applyEvent(s)
evaluateTick()         →     composites DOM changes
setCapture()           →     (flag: next frame wanted)
waitForCapture()       ←     Page.screencastFrame push
                             (ack sent immediately)
                                   ↓
                             queue.push(frame)     →  writeFrame()
[advance virtual time]                            (background consumer)
```

`Page.startScreencast` (Chrome DevTools Protocol) pushes JPEG/PNG frames asynchronously as Chrome composites. The main loop sets a `shouldCapture` flag and waits only until Chrome delivers the next push — typically a few milliseconds. The `screencastFrameAck` is sent immediately so Chrome keeps compositing without waiting for ffmpeg.

A background async consumer drains the frame queue into ffmpeg's stdin independently of the capture loop. This means ffmpeg I/O never blocks frame capture or virtual time advancement.

### Parallel rendering

For long sessions, the timeline can be split across N workers (`--workers N`). Each worker:

1. Fast-forwards (no frame capture) from time 0 to its chunk start.
2. Renders its assigned time slice at full quality.

Workers run as independent `Promise.all` entries, each with their own browser instance and `VirtualTimer`. The resulting chunk MP4 files are concatenated with `ffmpeg -f concat`.

### Visual fidelity details

- **Cursor** — the native cursor is hidden via CSS. A fixed-position SVG element is injected and smoothly interpolated toward the recorded mouse position each frame using exponential smoothing.
- **Text caret** — the native caret is hidden. A custom `div` is positioned by mirroring the active input's text content into a hidden clone and measuring where the caret character falls.
- **Scrollbars** — hidden globally via CSS (`scrollbar-width: none`).
- **Scroll smoothing** — scroll position is interpolated toward the target using exponential decay (`factor = 1 - e^(-k·dt/1000)`) driven by the virtual RAF loop.
- **Programmatic scroll suppression** — `Element.prototype.scrollIntoView` and related APIs are nooped to prevent the page from fighting the replay's scroll control.

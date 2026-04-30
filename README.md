# web-session-replay

Record a user session in a real browser and replay it — at any screen size — with a visible cursor overlay. Designed for screen recording workflows where you want a clean, reproducible playback of interactions.

## How it works

**Record:** opens a Chromium browser, captures every mouse movement, click, drag, scroll, and keystroke with precise timestamps, and saves them to a JSON file.

**Replay:** opens a fresh browser at the same (or different) screen size, plays back all events at their original timing, and overlays a visible cursor so recordings look clean on video.

## Install

```bash
bun install
```

## Commands

### Record a session

```bash
bun src/index.ts record <url> -o <file>
```

```bash
# Record at full window size
bun src/index.ts record https://example.com -o session.json

# Record at a specific viewport size
bun src/index.ts record https://example.com -o session.json --width 1920 --height 1080
```

### Replay a session

```bash
bun src/index.ts replay <file> [options]
```

```bash
# Replay at the same size as recorded
bun src/index.ts replay session.json

# Replay at a different viewport size
bun src/index.ts replay session.json --width 1280 --height 720

# Replay at half speed
bun src/index.ts replay session.json --speed 0.5

# Replay at 2× speed on a specific screen size
bun src/index.ts replay session.json --speed 2 --width 1920 --height 1080
```

## Options

| Command | Flag | Description |
|---|---|---|
| `record` | `-o`, `--output` | Output file path (default: `session.json`) |
| `record` | `--width`, `--height` | Viewport size (default: maximized window) |
| `replay` | `--speed` | Playback speed multiplier (default: `1.0`) |
| `replay` | `--width`, `--height` | Viewport size override (default: recorded size) |

## Session file

Sessions are saved as plain JSON and can be inspected or edited manually:

```json
{
  "version": 1,
  "startUrl": "https://example.com",
  "viewport": { "width": 1920, "height": 1080 },
  "events": [
    { "type": "navigate", "url": "https://example.com", "t": 0 },
    { "type": "mousemove", "x": 960, "y": 540, "t": 120, "vw": 1920, "vh": 1080 },
    { "type": "mousedown", "x": 960, "y": 540, "button": 0, "t": 800, "vw": 1920, "vh": 1080 },
    { "type": "mouseup",   "x": 960, "y": 540, "button": 0, "t": 850, "vw": 1920, "vh": 1080 }
  ]
}
```

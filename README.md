# web-session-replay

Record a user session in a real browser and replay it — at any screen size — with a visible cursor overlay. Designed for screen recording workflows where you want a clean, reproducible playback of interactions.

## How it works

**Record:** opens a Chromium browser, captures every mouse movement, click, drag, scroll, and keystroke with precise timestamps, and saves them to a JSON file.

**Replay:** opens a fresh browser at the same (or different) screen size, plays back all events at their original timing, and overlays a visible cursor so recordings look clean on video.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/bloccooo/web-replay/main/install.sh | bash
```

The script will:
- Install **ffmpeg** if it's not already present (via `brew`, `apt`, `dnf`, or `pacman`)
- Download the correct binary for your OS and architecture
- Place it in `/usr/local/bin/wsr` (or `~/.local/bin/wsr` if you don't have write access)

**Chromium** is downloaded automatically by Puppeteer on first use.

## Commands

### Record a session

```bash
wsr record <url> -o <file>
```

```bash
# Record at full window size
wsr record https://example.com -o session.json

# Record at a specific viewport size
wsr record https://example.com -o session.json --width 1920 --height 1080
```

### Replay a session

```bash
wsr replay <file> [options]
```

```bash
# Replay at the same size as recorded
wsr replay session.json

# Replay at half speed
wsr replay session.json --speed 0.5

# Replay at 2× resolution (same layout, higher quality output)
wsr replay session.json --scale 2

# Show the browser window during replay
wsr replay session.json --no-headless
```

## Options

| Command | Flag | Description |
|---|---|---|
| `record` | `-o`, `--output` | Output file path (default: `session.json`) |
| `record` | `--width`, `--height` | Viewport size (default: maximized window) |
| `record` | `--fullscreen` | Launch in fullscreen kiosk mode |
| `replay` | `--speed` | Playback speed multiplier (default: `1.0`) |
| `replay` | `--fps` | Output frame rate (default: `60`) |
| `replay` | `--scale` | Resolution multiplier — scales output without affecting layout (default: `1`) |
| `replay` | `--no-headless` | Show the browser window during replay |

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

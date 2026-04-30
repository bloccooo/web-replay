import { record, type RecordOptions } from "./recorder.js";
import { replay } from "./replayer.js";

function printUsage() {
  console.log(`
web-session-replay — record and replay browser sessions

Usage:
  record <url> -o <file>           Record a session to a file
  replay <file> [options]          Replay a recorded session

Record options:
  -o, --output <path>              Output file path (default: session.json)
  --width <px>                     Viewport width (default: maximized window)
  --height <px>                    Viewport height (default: maximized window)
  --fullscreen                     Launch in fullscreen kiosk mode (hides address bar)

Replay options:
  --speed <multiplier>             Playback speed (default: 1.0)
  --width <px>                     Viewport width override
  --height <px>                    Viewport height override
  --fullscreen                     Launch in fullscreen kiosk mode (hides address bar)
`);
}

function parseArgs(argv: string[]): {
  command: string | null;
  args: string[];
  flags: Record<string, string>;
} {
  const args: string[] = [];
  const flags: Record<string, string> = {};

  let i = 0;
  const command = argv[i++] ?? null;

  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (token.startsWith("-")) {
      const key = token.replace(/^-+/, "");
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = "true";
        i++;
      }
    } else {
      args.push(token);
      i++;
    }
  }

  return { command, args, flags };
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const { command, args, flags } = parseArgs(argv);

  if (command === "record") {
    const url = args[0];
    if (!url) {
      console.error("Error: URL is required.\nUsage: record <url> -o <file>");
      process.exit(1);
    }
    const output = flags["o"] ?? flags["output"] ?? "session.json";
    const recordOpts: RecordOptions = {
      width: flags["width"] ? parseInt(flags["width"], 10) : undefined,
      height: flags["height"] ? parseInt(flags["height"], 10) : undefined,
      fullscreen: flags["fullscreen"] === "true",
    };
    await record(url, output, recordOpts);

  } else if (command === "replay") {
    const file = args[0];
    if (!file) {
      console.error("Error: Session file is required.\nUsage: replay <file>");
      process.exit(1);
    }
    const speed = flags["speed"] ? parseFloat(flags["speed"]) : 1.0;
    const width = flags["width"] ? parseInt(flags["width"], 10) : undefined;
    const height = flags["height"] ? parseInt(flags["height"], 10) : undefined;
    const fullscreen = flags["fullscreen"] === "true";
    await replay(file, { speed, width, height, fullscreen });

  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

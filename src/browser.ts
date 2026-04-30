import puppeteer, { type Browser, type Page } from "puppeteer";

export interface SizeOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

async function measureChromeOverhead(): Promise<{
  chromeW: number;
  chromeH: number;
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
}> {
  const probe = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  const page = (await probe.pages())[0]!;
  await page.goto("about:blank");
  const result = await page.evaluate(() => ({
    chromeW: window.outerWidth - window.innerWidth,
    chromeH: window.outerHeight - window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
  }));
  await probe.close();
  return result;
}

const CHROMIUM_FLAGS = [
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--enable-webgl",
  "--enable-webgl2",
];

export async function launchBrowser(
  opts: SizeOptions,
): Promise<{ browser: Browser; page: Page }> {
  const fixedSize = opts.width !== undefined && opts.height !== undefined;

  let sizeArgs: string[];
  if (opts.fullscreen) {
    sizeArgs = ["--kiosk"];
  } else if (fixedSize) {
    const { chromeW, chromeH, screenWidth, screenHeight } =
      await measureChromeOverhead();
    sizeArgs = [
      `--window-size=${opts.width! + chromeW},${opts.height! + chromeH}`,
      `--window-position=${Math.round((screenWidth - (opts.width! + chromeW)) * 0.5)},${Math.round((screenHeight - (opts.height! + chromeH)) * 0.5)}`,
    ];
    console.log(screenWidth, screenHeight);
  } else {
    sizeArgs = ["--start-maximized"];
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [...sizeArgs, ...CHROMIUM_FLAGS],
  });
  const page = (await browser.pages())[0]!;

  return { browser, page };
}

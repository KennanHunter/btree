import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type RecordOptions = {
  url: string;
  framesDir: string;
  viewportW: number;
  viewportH: number;
  deviceScaleFactor?: number;
  seed: number;
  size: number;
  speed: number;
};

export type RecordResult = {
  frameCount: number;
  fps: number;
  framesDir: string;
};

type RecorderWindow = {
  __recorder_ready: boolean;
  __recorder: {
    fps: number;
    stepMs: number;
    getTotalFrames: () => number;
    renderFrame: (i: number) => void;
  };
};

export async function record(opts: RecordOptions): Promise<RecordResult> {
  await rm(opts.framesDir, { recursive: true, force: true });
  await mkdir(opts.framesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: opts.viewportW, height: opts.viewportH },
    deviceScaleFactor: opts.deviceScaleFactor ?? 1,
  });
  const page = await ctx.newPage();

  const target = `${opts.url}?seed=${opts.seed}&size=${opts.size}&speed=${opts.speed}`;
  await page.goto(target, { waitUntil: "load" });
  await page.waitForFunction(
    () => (window as unknown as RecorderWindow).__recorder_ready === true,
    undefined,
    { timeout: 15_000 },
  );
  // Freeze virtual time AFTER the host finishes bootstrapping — otherwise
  // vite's dev-server HMR traffic / module eval can't advance.
  await page.clock.install({ time: new Date(0) });

  const total: number = await page.evaluate(() =>
    (window as unknown as RecorderWindow).__recorder.getTotalFrames(),
  );
  const fps: number = await page.evaluate(
    () => (window as unknown as RecorderWindow).__recorder.fps,
  );

  for (let i = 0; i < total; i++) {
    const frame_ms = (i / fps) * 1000;
    await page.clock.setFixedTime(new Date(frame_ms));
    await page.evaluate(
      (idx) =>
        (window as unknown as RecorderWindow).__recorder.renderFrame(idx),
      i,
    );
    // page.clock doesn't drive CSS animations — seek them manually so the
    // alarm-shake lands on a specific frame of its own keyframes.
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) {
        a.pause();
        try {
          (a as Animation).currentTime = t;
        } catch {
          /* some animations throw on currentTime write — ignore */
        }
      }
    }, frame_ms);
    const path = join(opts.framesDir, `frame_${String(i).padStart(5, "0")}.png`);
    await page.screenshot({
      path,
      clip: { x: 0, y: 0, width: opts.viewportW, height: opts.viewportH },
      omitBackground: false,
    });
    if (i % 30 === 0) {
      process.stderr.write(`\r  frame ${i + 1}/${total}`);
    }
  }
  process.stderr.write(`\r  frame ${total}/${total}\n`);

  await browser.close();
  return { frameCount: total, fps, framesDir: opts.framesDir };
}

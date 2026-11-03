import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);

export type EncodeOptions = {
  framesDir: string;
  out: string;
  fps: number;
  quality?: number; // 0-100
};

export async function encode(opts: EncodeOptions): Promise<{ bytes: number }> {
  const quality = opts.quality ?? 70;
  const input = join(opts.framesDir, "frame_%05d.png");
  const args = [
    "-y",
    "-framerate",
    String(opts.fps),
    "-i",
    input,
    "-c:v",
    "libwebp_anim",
    "-loop",
    "0",
    "-lossless",
    "0",
    "-quality",
    String(quality),
    "-compression_level",
    "6",
    "-preset",
    "default",
    "-an",
    "-fps_mode",
    "passthrough",
    opts.out,
  ];
  await run("ffmpeg", args);
  const s = await stat(opts.out);
  return { bytes: s.size };
}

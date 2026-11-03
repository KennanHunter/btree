import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { start_server } from "./server";
import { record } from "./record";
import { encode } from "./encode";

type Args = {
  out: string;
  seed: number;
  size: number;
  fps: number;
  quality: number;
  scale: number;
  speed: number;
  keep_frames: boolean;
};

function parse(argv: string[]): Args {
  const args: Args = {
    out: "../media/btree-demo.webp",
    seed: 0xbeef,
    size: 10,
    fps: 30,
    quality: 50,
    scale: 1,
    speed: 2,
    keep_frames: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--size") args.size = Number(argv[++i]);
    else if (a === "--fps") args.fps = Number(argv[++i]);
    else if (a === "--quality") args.quality = Number(argv[++i]);
    else if (a === "--scale") args.scale = Number(argv[++i]);
    else if (a === "--speed") args.speed = Number(argv[++i]);
    else if (a === "--keep-frames") args.keep_frames = true;
    else if (a === "--help" || a === "-h") {
      print_usage();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      print_usage();
      process.exit(1);
    }
  }
  return args;
}

function print_usage() {
  console.error(
    "Usage: record [--out <path>] [--seed <n>] [--size <n>] [--fps <n>] [--quality <0-100>] [--scale <n>] [--speed <n>] [--keep-frames]",
  );
}

async function main() {
  const args = parse(process.argv.slice(2));
  const out_abs = resolve(args.out);
  await mkdir(dirname(out_abs), { recursive: true });
  const frames_dir = resolve("frames");

  console.error(`starting vite host…`);
  const { url, server } = await start_server();
  try {
    console.error(`recording seed=${args.seed} size=${args.size} fps=${args.fps}`);
    const { frameCount } = await record({
      url,
      framesDir: frames_dir,
      viewportW: 1280,
      viewportH: 720,
      deviceScaleFactor: args.scale,
      seed: args.seed,
      size: args.size,
      speed: args.speed,
    });
    console.error(`captured ${frameCount} frames → encoding…`);
    const { bytes } = await encode({
      framesDir: frames_dir,
      out: out_abs,
      fps: args.fps,
      quality: args.quality,
    });
    const kb = (bytes / 1024).toFixed(1);
    console.error(`wrote ${out_abs} (${kb} KB)`);
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

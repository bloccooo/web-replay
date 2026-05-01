import { spawn } from "node:child_process";

export async function framesToVideo(
  frames: Buffer[],
  fps: number,
  output: string,
) {
  const ffmpeg = spawn("ffmpeg", [
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    output,
  ]);

  for (const frame of frames) {
    ffmpeg.stdin.write(frame);
  }
  ffmpeg.stdin.end();

  return new Promise((resolve, reject) => {
    ffmpeg.on("close", resolve);
    ffmpeg.on("error", reject);
  });
}

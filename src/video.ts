export async function framesToVideo(
  frames: Buffer[],
  fps: number,
  output: string,
) {
  console.log(`encoding ${frames.length} frames at ${fps}fps`);

  const ffmpeg = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "pipe:0",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      output,
    ],
    stdin: "pipe",
    stderr: "inherit",
  });

  for (const frame of frames) {
    await ffmpeg.stdin.write(frame);
  }
  await ffmpeg.stdin.end();

  const code = await ffmpeg.exited;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
}

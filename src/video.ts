export function createVideoEncoder(fps: number, output: string) {
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

  return {
    async writeFrame(frame: Buffer) {
      await ffmpeg.stdin.write(frame);
    },
    async finish() {
      await ffmpeg.stdin.end();
      const code = await ffmpeg.exited;
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    },
  };
}

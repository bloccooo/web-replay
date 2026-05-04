export function createVideoEncoder(fps: number, output: string, width: number, height: number) {
  const ffmpeg = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "pipe:0",
      "-vf", `scale=trunc(${width}/2)*2:trunc(${height}/2)*2`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-y",
      output,
    ],
    stdin: "pipe",
    stderr: "ignore",
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

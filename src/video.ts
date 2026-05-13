const QUALITY_CRF: Record<string, number> = { high: 5, medium: 23, low: 28 };

export function createVideoEncoder(
  fps: number,
  output: string,
  width: number,
  height: number,
  quality: string = "medium",
) {
  const crf = QUALITY_CRF[quality] ?? 23;
  const ffmpeg = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-i",
      "pipe:0",
      "-vf",
      `scale=trunc(${width}/2)*2:trunc(${height}/2)*2`,
      "-c:v",
      "libx264",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
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

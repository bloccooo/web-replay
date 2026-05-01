const fps = 60;
const interval = 1000 / fps;

export const virtualTimer = {
  time: 0,
  get() {
    return this.time;
  },
  advance() {
    this.time += interval;
  },
};

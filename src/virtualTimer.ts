export class VirtualTimer {
  private time: number;

  constructor(startTime = 0) {
    this.time = startTime;
  }

  get() {
    return this.time;
  }

  advance(interval: number) {
    this.time += interval;
  }
}

export interface Point {
  x: number;
  y: number;
  t: number;
}

/**
 * Ramer-Douglas-Peucker simplification to reduce raw mouse points to key points.
 * epsilon is the max deviation in pixels allowed.
 */
export function simplifyPoints(points: Point[], epsilon = 4): Point[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Catmull-Rom spline through key points, returning interpolated positions
 * for the given number of steps between each pair of key points.
 */
export function catmullRomSpline(
  points: Point[],
  stepsPerSegment = 20
): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]!];
  if (points.length === 2) return lerp(points[0]!, points[1]!, stepsPerSegment);

  const result: Point[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;

    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      result.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
        t: p1.t + (p2.t - p1.t) * t,
      });
    }
  }

  result.push(points[points.length - 1]!);
  return result;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

function lerp(a: Point, b: Point, steps: number): Point[] {
  const result: Point[] = [];
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      t: a.t + (b.t - a.t) * t,
    });
  }
  result.push(b);
  return result;
}

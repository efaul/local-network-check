interface SignalPoint {
  readonly x: number;
  readonly y: number;
}

/** Smooth interpolation through real readings, with no overshoot or invented gap data. */
export function signalPath(points: readonly (SignalPoint | null)[]): string {
  let path = '';
  let previous: SignalPoint | null = null;
  const xy = (p: SignalPoint): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  for (const point of points) {
    if (point === null) {
      previous = null;
      continue;
    }
    if (previous === null) {
      path += `M${xy(point)} `;
    } else {
      // Horizontal tangents meet smoothly. Control points stay within the
      // two readings' bounds, so the curve cannot imply a stronger/weaker signal.
      const middle = (previous.x + point.x) / 2;
      path += `C${middle.toFixed(2)},${previous.y.toFixed(2)} ${middle.toFixed(2)},${point.y.toFixed(2)} ${xy(point)} `;
    }
    previous = point;
  }
  return path.trim();
}

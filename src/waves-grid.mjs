// Evenly-spaced sampling grid inside a bbox, capped per axis.
// Returns { step, points: [[lat, lon], ...] } clamped to the valid world range.
// A bbox smaller than one step still yields its centre point.
export function buildWaveGrid(latMin, latMax, lonMin, lonMax, maxAxis = 12) {
  const y1 = Math.max(-85, Math.min(latMin, latMax));
  const y2 = Math.min(85, Math.max(latMin, latMax));
  const x1 = Math.max(-180, Math.min(lonMin, lonMax));
  const x2 = Math.min(180, Math.max(lonMin, lonMax));
  if (!(y2 >= y1) || !(x2 >= x1)) return { step: 0, points: [] };
  const spanY = y2 - y1, spanX = x2 - x1;
  const step = Math.max(spanY / maxAxis, spanX / maxAxis, 0.25);
  const stepY = Math.min(step, spanY || step);
  const stepX = Math.min(step, spanX || step);
  const points = [];
  for (let la = y1 + stepY / 2; la <= y2 + 1e-9; la += stepY)
    for (let lo = x1 + stepX / 2; lo <= x2 + 1e-9; lo += stepX)
      points.push([Math.round(la * 1000) / 1000, Math.round(lo * 1000) / 1000]);
  return { step: Math.round(step * 1000) / 1000, points };
}

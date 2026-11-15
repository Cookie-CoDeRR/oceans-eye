// Trend math for Ocean's Eye (Space Apps 2026, fresh event build).
// AI-assisted code - disclosed per Space Apps SI rules.
// No external dependencies. All functions are pure.
//
// Honesty notes baked into the method:
// - We deseasonalize with a monthly climatology before testing, because a
//   seasonal cycle otherwise dominates the series.
// - Mann-Kendall assumes independent observations. Monthly anomalies are
//   still autocorrelated, which inflates significance, so the UI must
//   report z as indicative, not proof, and show n and the method.
// - No tie correction in the variance; documented, not hidden.

export function fractionalYear(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return y + (m - 1) / 12 + (d - 1) / 365.25;
}

// Monthly climatology removal: value minus that calendar month's mean.
// points: [{ t: isoString, v: number }]
export function deseasonalize(points) {
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const p of points) byMonth[Number(p.t.slice(5, 7)) - 1].push(p.v);
  const monthMean = byMonth.map((a) =>
    a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
  );
  return points
    .map((p) => {
      const mm = monthMean[Number(p.t.slice(5, 7)) - 1];
      return mm === null ? null : { t: p.t, v: p.v - mm };
    })
    .filter(Boolean);
}

export function leastSquares(points) {
  const xs = points.map((p) => fractionalYear(p.t));
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slopePerYear = sxy / sxx;
  // Residual-based standard error of the slope (classical, understates
  // uncertainty under autocorrelation - surfaced as a caveat, not hidden).
  const resid = ys.map((y, i) => y - (my + slopePerYear * (xs[i] - mx)));
  const s2 = resid.reduce((s, r) => s + r * r, 0) / Math.max(n - 2, 1);
  const seSlope = Math.sqrt(s2 / sxx);
  return {
    n,
    slopePerYear,
    slopePerDecade: slopePerYear * 10,
    seSlopePerDecade: seSlope * 10,
  };
}

// Lag-1 autocorrelation of the series, reported so the UI can caveat
// significance when it is high.
export function lag1Autocorrelation(points) {
  const ys = points.map((p) => p.v);
  const n = ys.length;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (ys[i] - my) ** 2;
    if (i > 0) num += (ys[i] - my) * (ys[i - 1] - my);
  }
  return den === 0 ? 0 : num / den;
}

export function mannKendall(points) {
  const ys = points.map((p) => p.v);
  const n = ys.length;
  let S = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      S += Math.sign(ys[j] - ys[i]);
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  return { n, S, z, indicative95: Math.abs(z) > 1.96 };
}

// Full pipeline: raw monthly series -> anomalies -> trend + significance.
export function analyzeTrend(rawPoints) {
  const anomalies = deseasonalize(rawPoints);
  if (anomalies.length < 24)
    return {
      ok: false,
      reason: "not enough data for a monthly-anomaly trend (need >= 24)",
      n: anomalies.length,
    };
  const ls = leastSquares(anomalies);
  const mk = mannKendall(anomalies);
  const r1 = lag1Autocorrelation(anomalies);
  return {
    ok: true,
    method:
      "monthly climatology removed, least-squares slope with classical SE, Mann-Kendall z (no tie correction)",
    caveat:
      r1 > 0.3
        ? `residual autocorrelation r1=${r1.toFixed(2)} is high; treat significance as indicative only`
        : `residual autocorrelation r1=${r1.toFixed(2)}`,
    ...ls,
    ...mk,
    lag1: r1,
    anomalies,
  };
}

// Ocean's Eye trend-math checks (node test/trend.test.mjs). No dependencies.
import { deseasonalize, leastSquares, mannKendall, lag1Autocorrelation, analyzeTrend } from "../src/trend.mjs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("ok -", name); }
  else { fail++; console.log("FAIL -", name); }
}

// 1. Known slope recovery: 0.5 C/decade over 20 years of monthly points.
const up = [];
for (let i = 0; i < 240; i++) {
  const year = 2003 + i / 12;
  up.push({ t: `${String(2003 + Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}-15T12:00:00Z`, v: 20 + 0.05 * (year - 2003) });
}
const ls = leastSquares(up);
check("least-squares recovers +0.5 C/decade", Math.abs(ls.slopePerDecade - 0.5) < 0.01);

// 2. Deseasonalization removes a seasonal cycle.
const seasonal = [];
for (let i = 0; i < 240; i++) {
  const m = i % 12;
  seasonal.push({ t: `2003-${String(m + 1).padStart(2, "0")}-15T12:00:00Z`, v: 25 + 3 * Math.sin((2 * Math.PI * m) / 12) });
}
const a = deseasonalize(seasonal);
check("deseasonalized amplitude ~ 0", Math.max(...a.map((p) => Math.abs(p.v))) < 1e-9);

// 3. Mann-Kendall on a monotonic rise is strongly positive and indicative.
const mk = mannKendall(up);
check("Mann-Kendall z > 1.96 on monotonic rise", mk.z > 1.96 && mk.indicative95);

// 4. Flat white-noise-free series: no trend claimed.
const flat = up.map((p) => ({ t: p.t, v: 25 }));
const mkFlat = mannKendall(flat);
check("flat series z = 0, not indicative", mkFlat.z === 0 && !mkFlat.indicative95);

// 5. Autocorrelation detector: alternating vs smooth series.
const smooth = [];
for (let i = 0; i < 100; i++) smooth.push({ t: `2003-01-15T12:00:00Z`, v: i / 100 });
check("lag1 ~ 1 on smooth series", lag1Autocorrelation(smooth) > 0.9);

// 6. Pipeline refuses too-short series honestly.
const short = analyzeTrend(seasonal.slice(0, 10));
check("short series refused", short.ok === false && short.n === 10);

// 7. Full pipeline on seasonal+trend mix recovers the injected trend.
const mix = up.map((p, i) => ({ t: p.t, v: 25 + 3 * Math.sin((2 * Math.PI * (i % 12)) / 12) + 0.03 * (i / 12) }));
const r = analyzeTrend(mix);
check("pipeline recovers +0.3 C/decade", r.ok && Math.abs(r.slopePerDecade - 0.3) < 0.02);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

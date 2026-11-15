// Pure UI helpers for Ocean's Eye (no DOM) - imported by app.js and unit tests.
// AI-assisted code - disclosed per Space Apps SI rules.

export const REGIONS = {
  "arabian sea": { lat: 15, lon: 65, zoom: 5 },
  "bay of bengal": { lat: 15, lon: 88, zoom: 5 },
  "indian ocean": { lat: -8, lon: 75, zoom: 4 },
  "goa": { lat: 15.2, lon: 72.5, zoom: 7 },
  "goa coast": { lat: 15.2, lon: 72.5, zoom: 7 },
  "kerala coast": { lat: 9.5, lon: 75.8, zoom: 7 },
  "lakshadweep": { lat: 11, lon: 72.5, zoom: 6 },
  "somali coast": { lat: 5, lon: 50, zoom: 5 },
  "gulf of mannar": { lat: 9, lon: 79, zoom: 7 },
};

export const SPECIES_WORDS = [
  "yellowfin tuna", "yellowfin", "whale shark", "indian oil sardine",
  "oil sardine", "sardine", "indian mackerel", "mackerel", "green turtle",
  "olive ridley", "humpback dolphin", "blue whale", "dugong",
];

export function parseQuery(q) {
  const text = q.toLowerCase();
  const region = Object.keys(REGIONS).find((r) => text.includes(r));
  const wantsTrend = /(temp|warm|hot|cold|sst|trend|chang|heat)/.test(text);
  const wantsSpecies = /(where|seen|observ|sight|find|show|fish|shark|tuna|sardine|mackerel|turtle|whale|dolphin|dugong)/.test(text);
  let species = SPECIES_WORDS.find((s) => text.includes(s));
  if (!species && wantsSpecies) {
    const m = q.match(/(?:where|find|show)\s+(?:have|has|are|were|was)?\s*(?:the\s+)?([a-z][a-z\s'-]{2,30}?)(?:been|been observed|observed|seen|found|$)/i);
    if (m) species = m[1].replace(/\b(been|observed|seen|found|reported)\b/gi, "").trim();
  }
  return { region, wantsTrend, wantsSpecies, species };
}

export function dirCompass(deg) {
  if (deg === null || deg === undefined) return "-";
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8] + " " + deg + "\u00b0";
}

// Trend summary per role. Facts identical across roles; only wording differs.
// Never claim "clear signal": Mann-Kendall significance is indicative only
// (residual autocorrelation not corrected). Samples are ~30-day stride.
export function trendSummary(r, lat, lon, role) {
  const dir = r.slopePerDecade > 0.02 ? "warming" : r.slopePerDecade < -0.02 ? "cooling" : "roughly flat";
  const slope = `${r.slopePerDecade >= 0 ? "+" : ""}${r.slopePerDecade.toFixed(2)}`;
  const sig = r.indicative95;
  const span = `${r.anomalies[0].t.slice(0, 4)} to ${r.anomalies[r.anomalies.length - 1].t.slice(0, 4)}`;
  if (role === "student")
    return `The sea at ${lat.toFixed(2)}, ${lon.toFixed(2)} is <b>${dir}</b>: about ${slope} &deg;C per decade over ${span}. ` +
      (sig ? "The data points to a real trend, but it is indicative, not proof." : "The signal is not clear enough to call it a trend yet.");
  if (role === "fisherman")
    return `Sea temperature at ${lat.toFixed(2)}, ${lon.toFixed(2)}: <b>${dir}</b>, about ${slope} &deg;C per decade over ${span} ` +
      `(satellite analysis - ${sig ? "indicative" : "weak"}, not proof). Latest available conditions below.`;
  return `<b>${dir}</b> at ${lat.toFixed(2)}, ${lon.toFixed(2)}: ${slope} &plusmn;${r.seSlopePerDecade.toFixed(2)} &deg;C/decade, ` +
    `Mann-Kendall z = ${r.z.toFixed(2)} (${sig ? "statistically indicative" : "not clearly significant at 95%"}), n = ${r.n} samples (~every 30 days).`;
}

// Compact current-conditions lines, each with its own valid time shown inline.
const fmtUtc = (t) => (t ? t.replace("T", " ") + " UTC" : "time n/a");

export function briefingLines(b) {
  const lines = [];
  const sst = b.sections.sst;
  if (sst && !sst.error && sst.value !== null)
    lines.push(`SST <b>${sst.value.toFixed(1)} ${sst.units}</b> (${(sst.validTime ?? "").slice(0, 10)})`);
  const m = b.sections.marine;
  if (m && !m.error)
    lines.push(`wave <b>${m.values.waveHeightM ?? "-"} m</b> / ${m.values.wavePeriodS ?? "-"} s from ${dirCompass(m.values.waveDirectionDeg)} &middot; current <b>${m.values.currentKmh ?? "-"} km/h</b> toward ${dirCompass(m.values.currentDirectionDeg)} (${fmtUtc(m.validTime)})`);
  const w = b.sections.weather;
  if (w && !w.error)
    lines.push(`wind <b>${w.values.windKmh ?? "-"} km/h</b> from ${dirCompass(w.values.windDirectionDeg)} &middot; ${w.values.pressureHpa ?? "-"} hPa &middot; precip ${w.values.precipitationMm ?? "-"} mm (${fmtUtc(w.validTime)})`);
  return lines;
}

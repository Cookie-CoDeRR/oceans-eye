// Regression tests for Ocean's Eye UI core helpers + server validation.
// Run: node test/ui.test.mjs
import { strict as assert } from "node:assert";
import { parseQuery, dirCompass, trendSummary, briefingLines, REGIONS } from "../src/ui-core.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("ok -", name); }
  catch (e) { fail++; console.error("FAIL -", name, "-", e.message); }
}

// --- query routing ---
t("species + trend query routes to species with trend flag", () => {
  const r = parseQuery("whale shark records trend");
  assert.equal(r.species, "whale shark");
  assert.equal(r.wantsTrend, true);
});
t("region + trend query", () => {
  const r = parseQuery("how has temperature changed in the Arabian Sea");
  assert.equal(r.region, "arabian sea");
  assert.equal(r.wantsTrend, true);
  assert.equal(r.species, undefined);
});
t("species extraction from where-question", () => {
  const r = parseQuery("where have yellowfin tuna been observed");
  assert.equal(r.species, "yellowfin tuna");
});

// --- direction conventions (waves FROM, currents TO) ---
t("dirCompass 192 deg is S", () => assert.equal(dirCompass(192), "S 192\u00b0"));
t("dirCompass 284 deg is W", () => assert.equal(dirCompass(284), "W 284\u00b0"));
t("briefingLines labels waves FROM and current TO with valid times", () => {
  const lines = briefingLines({
    sections: {
      sst: { label: "Sea surface temperature", value: 29.9, units: "deg C", validTime: "2026-11-13T09:00:00Z", sampledAt: { lat: 15, lon: 72 } },
      marine: { label: "Waves and ocean current", validTime: "2026-11-15T10:00", values: { waveHeightM: 0.84, wavePeriodS: 11.35, waveDirectionDeg: 192, currentKmh: 0.7, currentDirectionDeg: 284 }, sampledAt: { lat: 15.04, lon: 71.96 } },
      weather: { label: "Weather at this cell", validTime: "2026-11-15T10:00", values: { windKmh: 15.8, windDirectionDeg: 21, pressureHpa: 1011.3, precipitationMm: 0 }, sampledAt: { lat: 15.01, lon: 72.02 } },
    },
  });
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes("from S 192\u00b0"), "waves must be FROM");
  assert.ok(lines[1].includes("toward W 284\u00b0"), "current must be TO");
  assert.ok(lines[1].includes("2026-11-15 10:00 UTC"), "marine valid time shown with explicit UTC");
  assert.ok(lines[2].includes("from N 21\u00b0"), "wind must be FROM");
  assert.ok(lines[2].includes("2026-11-15 10:00 UTC"), "weather valid time shown with explicit UTC");
});

// --- role summaries: identical facts, no "clear signal", honest sampling ---
const r0 = {
  slopePerDecade: 0.21, seSlopePerDecade: 0.05, z: 4.03, n: 291, indicative95: true,
  anomalies: [{ t: "2003-01-01" }, { t: "2026-10-29" }],
};
for (const role of ["researcher", "student", "fisherman"]) {
  t(`${role} summary: no "clear signal", keeps slope`, () => {
    const s = trendSummary(r0, 15, 72, role);
    assert.ok(!s.includes("clear signal"), "must not claim clear signal");
    assert.ok(s.includes("0.21"), "keeps slope");
    assert.ok(s.includes("indicative"), "keeps indicative caveat");
  });
}
t("researcher summary says samples not monthly anomalies", () => {
  const s = trendSummary(r0, 15, 72, "researcher");
  assert.ok(s.includes("n = 291 samples"), "uses sample count wording");
  assert.ok(!s.includes("monthly anomalies"), "no monthly-anomalies mislabel");
});

// --- server route validation ---
const { spawn } = await import("node:child_process");
const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: "8931" }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
t("species/series requires name", async () => {
  const res = await fetch("http://127.0.0.1:8931/api/species/series");
  assert.equal(res.status, 400);
});
t("cell rejects out-of-range lat", async () => {
  const res = await fetch("http://127.0.0.1:8931/api/cell?lat=99&lon=0");
  assert.equal(res.status, 400);
});
srv.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

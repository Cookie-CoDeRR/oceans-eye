// Deterministic fixtures for upstream fetch retry + error formatting.
// fetchImpl and delayMs are injected; no network, no real timers.
// Run: node test/fetch-upstream.test.mjs
import assert from "node:assert";
import { fetchWithTimeout, fetchFromHosts, formatUpstreamError } from "../src/fetch-upstream.mjs";

let passed = 0, failed = 0;
const t = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("ok - " + name); })
    .catch((e) => { failed++; console.log("FAIL - " + name + ": " + e.message); });

const transportErr = (code) => {
  const e = new Error("fetch failed");
  e.cause = { code };
  return e;
};

await t("success on first attempt: no retry", async () => {
  let calls = 0;
  const r = await fetchWithTimeout("https://x", {
    delayMs: 0,
    fetchImpl: async () => { calls++; return { ok: true }; },
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
});

await t("one transport failure then success: retried once, result returned", async () => {
  let calls = 0;
  const r = await fetchWithTimeout("https://x", {
    delayMs: 0,
    fetchImpl: async () => { calls++; if (calls === 1) throw transportErr("ECONNRESET"); return { ok: true }; },
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
});

await t("persistent transport failure: throws after bounded tries, last error kept", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithTimeout("https://x", {
      delayMs: 0,
      fetchImpl: async () => { calls++; throw transportErr("ETIMEDOUT"); },
    }),
    (e) => e.message === "fetch failed" && e.cause.code === "ETIMEDOUT"
  );
  assert.equal(calls, 2, "default is one retry, not a loop");
});

await t("abort (timeout) is also retried once then surfaced", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithTimeout("https://x", {
      delayMs: 0,
      timeoutMs: 5,
      fetchImpl: (url, { signal }) =>
        new Promise((_, rej) => { calls++; signal.addEventListener("abort", () => rej(new Error("The operation was aborted"))); }),
    }),
    /aborted/
  );
  assert.equal(calls, 2);
});

await t("formatUpstreamError keeps the cause code", () => {
  assert.equal(formatUpstreamError(transportErr("ENOTFOUND")), "fetch failed (upstream: ENOTFOUND)");
});

await t("formatUpstreamError falls back to cause message, then bare message", () => {
  assert.equal(formatUpstreamError({ message: "fetch failed", cause: { message: "socket hang up" } }), "fetch failed (upstream: socket hang up)");
  assert.equal(formatUpstreamError(new Error("upstream 503")), "upstream 503");
});


await t("fetchFromHosts: fails over to the second mirror on transport error, returns serving URL", async () => {
  const tried = [];
  const out = await fetchFromHosts(["https://h1", "https://h2"], "/ds.csv?x", {
    delayMs: 0,
    fetchImpl: async (url) => { tried.push(url); if (url.startsWith("https://h1")) throw transportErr("UND_ERR_CONNECT_TIMEOUT"); return { ok: true }; },
  });
  assert.equal(out.host, "https://h2");
  assert.equal(out.url, "https://h2/ds.csv?x");
  // failover replaces per-host retry (bounded total wait): h1 once, then h2
  assert.deepEqual(tried, ["https://h1/ds.csv?x", "https://h2/ds.csv?x"]);
});

await t("fetchFromHosts: a 404 from the first host also fails over", async () => {
  const out = await fetchFromHosts(["https://h1", "https://h2"], "/p", {
    delayMs: 0,
    fetchImpl: async (url) => (url.startsWith("https://h1") ? { ok: false, status: 404 } : { ok: true }),
  });
  assert.equal(out.host, "https://h2");
});

await t("fetchFromHosts: all mirrors down -> throws, transport cause preserved", async () => {
  await assert.rejects(
    fetchFromHosts(["https://h1", "https://h2"], "/p", {
      delayMs: 0,
      fetchImpl: async () => { throw transportErr("UND_ERR_CONNECT_TIMEOUT"); },
    }),
    (e) => formatUpstreamError(e) === "fetch failed (upstream: UND_ERR_CONNECT_TIMEOUT)"
  );
});

// wave filter grid: deterministic, no network
import { buildWaveGrid } from "../src/waves-grid.mjs";

await t("buildWaveGrid: caps per axis, points stay inside bbox", () => {
  const g = buildWaveGrid(5, 25, 50, 80, 12);
  assert(g.points.length > 0 && g.points.length <= 13 * 13);
  for (const [la, lo] of g.points) {
    assert(la >= 5 && la <= 25 && lo >= 50 && lo <= 80);
  }
  assert(g.step >= 0.25);
});

await t("buildWaveGrid: tiny bbox yields minimum step and at least one point", () => {
  const g = buildWaveGrid(10, 10.1, 60, 60.1, 12);
  assert(g.points.length >= 1);
});

await t("buildWaveGrid: out-of-world bbox is clamped to valid range", () => {
  const g = buildWaveGrid(-95, 95, -190, 190, 12);
  for (const [la, lo] of g.points) {
    assert(la >= -85 && la <= 85 && lo >= -180 && lo <= 180);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);


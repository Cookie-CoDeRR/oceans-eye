// Ocean's Eye access layer - Space Apps 2026 fresh event build.
// AI-assisted code - disclosed per Space Apps SI rules.
//
// One small set of clean, configurable endpoints over public marine data:
//   /api/species/grid?name=<scientific or known common name>[&precision=3]
//   /api/species/points?name=<name>&bbox=lonMin,latMin,lonMax,latMax[&size=500]
//   /api/sst/field?bbox=latMin,latMax,lonMin,lonMax[&date=YYYY-MM-DD][&stride=24]
//   /api/sst/series?lat=<>&lon=<>
//   /api/trend?lat=<>&lon=<>   (series + deseasonalized trend + significance)
// Sources: OBIS (observation records) and NASA JPL MUR SST via NOAA ERDDAP.
// No keys, no accounts. Upstream URLs are returned in each payload's .source.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { analyzeTrend } from "./src/trend.mjs";
import { resolveTaxonExact, speciesPhoto } from "./src/species-photo.mjs";
import { fetchWithTimeout, fetchFromHosts, formatUpstreamError } from "./src/fetch-upstream.mjs";
import { buildWaveGrid } from "./src/waves-grid.mjs";
import { createAskHandler } from "./src/ask.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
const PORT = process.env.PORT || 8741;
const OBIS = "https://api.obis.org/v3";
// jplMURSST41 is served by NOAA SWFSC/ERD ERDDAP. coastwatch is primary;
// upwell is the same operator's mirror (data requests redirect to coastwatch).
// If a network blocks one host we try the other; the response keeps the URL
// that actually served the data.
const ERDDAP_HOSTS = [
  "https://coastwatch.pfeg.noaa.gov/erddap",
  "https://upwell.pfeg.noaa.gov/erddap",
];
const ERDDAP_DS = "/griddap/jplMURSST41.csv";
const OM_MARINE = "https://marine-api.open-meteo.com/v1/marine";
const OM_WEATHER = "https://api.open-meteo.com/v1/forecast";

const SPECIES_ALIASES = {
  "yellowfin": "Thunnus albacares",
  "yellowfin tuna": "Thunnus albacares",
  "whale shark": "Rhincodon typus",
  "oil sardine": "Sardinella longiceps",
  "indian oil sardine": "Sardinella longiceps",
  "sardine": "Sardinella longiceps",
  "indian mackerel": "Rastrelliger kanagurta",
  "mackerel": "Rastrelliger kanagurta",
  "green turtle": "Chelonia mydas",
  "olive ridley": "Lepidochelys olivacea",
  "humpback dolphin": "Sousa chinensis",
  "blue whale": "Balaenoptera musculus",
  "dugong": "Dugong dugon",
};

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
}



async function fetchJson(url) {
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

// ERDDAP CSV fetch with host failover; returns rows plus the URL that served.
async function fetchErddapCsv(path, mapper) {
  const { res, url } = await fetchFromHosts(ERDDAP_HOSTS, path);
  const text = await res.text();
  return { rows: text.trim().split("\n").slice(2).map(mapper).filter(Boolean), source: url };
}

async function resolveSpecies(name) {
  const r = await resolveTaxonExact(name, SPECIES_ALIASES, fetchJson);
  if (r.taxon) return { taxon: r.taxon };
  const hint = r.candidates.length ? ` - did you mean ${r.candidates.join(", ")}?` : "";
  return { taxon: null, error: `no exact OBIS taxon match for "${name}"${hint}`, candidates: r.candidates };
}

function parseBbox(raw) {
  const parts = (raw || "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return null;
  return parts;
}

function sstSeriesPath(lat, lon, startISO, endISO, strideDays = 30) {
  return `${ERDDAP_DS}?analysed_sst[(${startISO}):${strideDays}:(${endISO})][(${lat})][(${lon})]`;
}

async function getSstSeries(lat, lon) {
  const start = "2003-01-01T12:00:00Z";
  const { rows, source } = await fetchErddapCsv(sstSeriesPath(lat, lon, start, "last"), (l) => {
    const c = l.split(",");
    const v = Number(c[3]);
    return Number.isFinite(v) ? { t: c[0], v } : null;
  });
  return { series: rows, source };
}

const routes = {
  "/api/species/grid": async (q) => {
    const name = q.get("name");
    if (!name) return [400, { error: "name is required" }];
    const r = await resolveSpecies(name);
    if (!r.taxon) return [404, { error: r.error, candidates: r.candidates }];
    const taxon = r.taxon;
    const precision = Math.min(Math.max(Number(q.get("precision")) || 3, 1), 5);
    const src = `${OBIS}/occurrence/grid/${precision}?scientificname=${encodeURIComponent(taxon.scientificName)}`;
    const grid = await fetchJson(src);
    return [200, {
      taxon: { scientificName: taxon.scientificName, taxonID: taxon.taxonID },
      qualification: "presence-only observation records with sampling bias; not abundance, absence, or true distribution",
      source: src,
      grid,
    }];
  },

  "/api/species/points": async (q) => {
    const name = q.get("name");
    const bb = parseBbox(q.get("bbox"));
    if (!name || !bb) return [400, { error: "name and bbox=lonMin,latMin,lonMax,latMax are required" }];
    const r = await resolveSpecies(name);
    if (!r.taxon) return [404, { error: r.error, candidates: r.candidates }];
    const taxon = r.taxon;
    const [x1, y1, x2, y2] = bb;
    const wkt = `POLYGON((${x1} ${y1},${x2} ${y1},${x2} ${y2},${x1} ${y2},${x1} ${y1}))`;
    const size = Math.min(Number(q.get("size")) || 500, 1000);
    const src = `${OBIS}/occurrence?scientificname=${encodeURIComponent(taxon.scientificName)}&geometry=${encodeURIComponent(wkt)}&size=${size}`;
    const data = await fetchJson(src);
    return [200, { taxon: taxon.scientificName, total: data.total, source: src, results: data.results ?? [] }];
  },

  "/api/species/series": async (q) => {
    const name = q.get("name");
    if (!name) return [400, { error: "name is required" }];
    const r = await resolveSpecies(name);
    if (!r.taxon) return [404, { error: r.error, candidates: r.candidates }];
    const taxon = r.taxon;
    const src = `${OBIS}/statistics/years?scientificname=${encodeURIComponent(taxon.scientificName)}`;
    const years = await fetchJson(src);
    return [200, {
      taxon: taxon.scientificName,
      qualification: "dated observation records per year (global); reflects reporting effort as much as the animals; not abundance, not a stock assessment, not a fishing forecast",
      source: src,
      years,
    }];
  },

  "/api/species/photo": async (q) => {
    const name = q.get("name");
    if (!name) return [400, { error: "name is required" }];
    const r = await resolveSpecies(name);
    if (!r.taxon) return [404, { error: r.error, candidates: r.candidates }];
    const out = await speciesPhoto(r.taxon.scientificName, fetchJson);
    return [200, out];
  },

  "/api/sst/series": async (q) => {
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [400, { error: "lat and lon are required" }];
    const { series, source } = await getSstSeries(lat, lon);
    return [200, {
      lat, lon, dataset: "NASA JPL MUR SST (GHRSST L4 MUR v4.1), 1km daily satellite analysis, ~30-day stride",
      qualification: "Level-4 satellite SST analysis grid (GHRSST MUR v4.1), not a direct measurement at this exact point",
      source, series,
    }];
  },

  "/api/sst/field": async (q) => {
    const bb = parseBbox(q.get("bbox"));
    if (!bb) return [400, { error: "bbox=latMin,latMax,lonMin,lonMax is required" }];
    const [latMin, latMax, lonMin, lonMax] = bb;
    const date = q.get("date") ?? new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [400, { error: "date must be YYYY-MM-DD" }];
    const stride = Math.min(Math.max(Number(q.get("stride")) || 24, 4), 100);
    const { rows: cells, source: src } = await fetchErddapCsv(`${ERDDAP_DS}?analysed_sst[(${date}T12:00:00Z)][(${latMin}):${stride}:(${latMax})][(${lonMin}):${stride}:(${lonMax})]`, (l) => {
      const c = l.split(",");
      const v = Number(c[3]);
      return Number.isFinite(v) ? { lat: Number(c[1]), lon: Number(c[2]), v } : null;
    });
    return [200, {
      date, stride, dataset: "NASA JPL MUR SST (jplMURSST41)",
      qualification: "blended analysis grid; cells are ~0.01deg x stride",
      source: src, cells,
    }];
  },

  // Aggregated per-cell briefing: current SST + waves/currents + weather.
  // Weather/wave/current values are numerical-model output via Open-Meteo
  // (CC BY 4.0), valid for the model time returned - NOT observations, and
  // not a safety forecast. SST is the GHRSST L4 MUR analysis (satellite).
  "/api/cell": async (q) => {
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return [400, { error: "lat and lon are required" }];

    const out = { lat, lon, sections: {} };

    // current SST (nearest grid point at latest time)
    try {
      const { rows, source: sstUrl } = await fetchErddapCsv(`${ERDDAP_DS}?analysed_sst[(last)][(${lat})][(${lon})]`, (l) => {
        const c = l.split(",");
        const v = Number(c[3]);
        return Number.isFinite(v) ? { t: c[0], la: Number(c[1]), lo: Number(c[2]), v } : null;
      });
      out.sections.sst = {
        label: "Sea surface temperature",
        dataset: "NASA JPL GHRSST L4 MUR v4.1 (satellite analysis, 0.01deg ~1km grid)",
        value: rows.length ? rows[0].v : null,
        units: "deg C",
        validTime: rows.length ? rows[0].t : null,
        sampledAt: rows.length ? { lat: rows[0].la, lon: rows[0].lo } : null,
        note: rows.length ? null : "no analysis value at this exact point (often near coast or ice)",
        source: sstUrl,
      };
    } catch (e) {
      out.sections.sst = { label: "Sea surface temperature", error: String(e.message ?? e) };
    }

    // waves + ocean current (model)
    try {
      const mUrl = `${OM_MARINE}?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction&timezone=UTC`;
      const m = await fetchJson(mUrl);
      out.sections.marine = {
        label: "Waves and ocean current",
        dataset: "Open-Meteo marine (numerical model output, CC BY 4.0; waves and currents ~0.08deg / ~8km grid)",
        validTime: m.current?.time ?? null,
        sampledAt: Number.isFinite(m.latitude) ? { lat: m.latitude, lon: m.longitude } : null,
        values: {
          waveHeightM: m.current?.wave_height ?? null,
          wavePeriodS: m.current?.wave_period ?? null,
          waveDirectionDeg: m.current?.wave_direction ?? null,
          currentKmh: m.current?.ocean_current_velocity ?? null,
          currentDirectionDeg: m.current?.ocean_current_direction ?? null,
        },
        note: "model output, not a buoy observation; not suitable for coastal navigation; wave direction is where waves come FROM, current direction is where the current heads TO (per source docs)",
        source: mUrl,
      };
    } catch (e) {
      out.sections.marine = { label: "Waves and ocean current", error: String(e.message ?? e) };
    }

    // weather (model)
    try {
      const wUrl = `${OM_WEATHER}?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,surface_pressure,precipitation&timezone=UTC&cell_selection=nearest`;
      const w = await fetchJson(wUrl);
      out.sections.weather = {
        label: "Weather at this cell",
        dataset: "Open-Meteo forecast (numerical model output, CC BY 4.0; resolution varies by model, value from nearest grid cell)",
        validTime: w.current?.time ?? null,
        sampledAt: Number.isFinite(w.latitude) ? { lat: w.latitude, lon: w.longitude } : null,
        values: {
          windKmh: w.current?.wind_speed_10m ?? null,
          windDirectionDeg: w.current?.wind_direction_10m ?? null,
          pressureHpa: w.current?.surface_pressure ?? null,
          precipitationMm: w.current?.precipitation ?? null,
        },
        note: "model output snapshot, not a station observation and not a time-evolving pattern; not a safety forecast",
        source: wUrl,
      };
    } catch (e) {
      out.sections.weather = { label: "Weather at this cell", error: String(e.message ?? e) };
    }

    return [200, out];
  },

  "/api/waves/field": async (q) => {
    const bb = parseBbox(q.get("bbox"));
    if (!bb) return [400, { error: "bbox=lonMin,latMin,lonMax,latMax is required" }];
    const [x1, y1, x2, y2] = bb;
    const { step, points } = buildWaveGrid(y1, y2, x1, x2, 12);
    if (!points.length) return [400, { error: "bbox has no valid points" }];
    const url = `${OM_MARINE}?latitude=${points.map((p) => p[0]).join(",")}&longitude=${points.map((p) => p[1]).join(",")}&current=wave_height&timezone=UTC`;
    const data = await fetchJson(url);
    const arr = Array.isArray(data) ? data : [data];
    const cells = arr
      .map((r) => ({ lat: Number(r.latitude), lon: Number(r.longitude), h: r.current?.wave_height ?? null }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isFinite(c.h));
    const times = arr.map((r) => r.current?.time).filter(Boolean);
    const uniqueTimes = [...new Set(times)];
    return [200, {
      cells, step, unit: "m",
      dataset: "Open-Meteo marine model (wave height, ~0.08deg / ~8km source grid, nearest sea cell)",
      validTime: uniqueTimes.length === 1 ? uniqueTimes[0] : null,
      mixedValidTimes: uniqueTimes.length > 1,
      note: "model output, not buoy observations; each value is the nearest ~8km sea grid cell (coastal sample points snap seaward); points with no value are omitted",
      source: url,
    }];
  },

  "/api/trend": async (q) => {
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [400, { error: "lat and lon are required" }];
    const { series, source } = await getSstSeries(lat, lon);
    const analysis = analyzeTrend(series);
    return [200, {
      lat, lon, dataset: "NASA JPL MUR SST (jplMURSST41)", source,
      note: "significance is indicative: monthly anomalies remain autocorrelated; see caveat",
      ...analysis,
    }];
  },
};

// AI assistant: provider-agnostic (OpenAI-compatible). Configured only via
// env vars - OE_AI_BASE_URL / OE_AI_KEY / OE_AI_MODEL - never in the repo or
// the browser. GET probes configuration; POST answers.
const aiAsk = createAskHandler({
  routes,
  baseUrl: process.env.OE_AI_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.OE_AI_KEY || "",
  model: process.env.OE_AI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
});

// Bounded GET cache (max 100 entries, 5-minute TTL) and a naive per-IP
// rate limit (60 req/min) for the API routes. Static files are not limited.
const cache = new Map();
const hits = new Map();
const RATE_LIMIT = 60, RATE_WINDOW_MS = 60000;

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === "/api/ask") {
      if (req.method === "GET")
        return send(res, 200, { configured: !!process.env.OE_AI_KEY, model: process.env.OE_AI_KEY ? (process.env.OE_AI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free") : null });
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      const raw = await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => { if ((d += c).length > 8192) req.destroy(); });
        req.on("end", () => resolve(d));
      });
      let payload = {};
      try { payload = JSON.parse(raw || "{}"); } catch {}
      const [code, body] = await aiAsk({ question: payload.question, sessionId: payload.sessionId, role: payload.role });
      return send(res, code, body);
    }
    if (routes[u.pathname]) {
      const ip = req.socket.remoteAddress ?? "?";
      const now = Date.now();
      const h = hits.get(ip) ?? { t: now, n: 0 };
      if (now - h.t > RATE_WINDOW_MS) { h.t = now; h.n = 0; }
      if (++h.n > RATE_LIMIT) return send(res, 429, { error: "rate limit: 60 requests/minute" });
      hits.set(ip, h);
      const key = u.pathname + u.search;
      const c = cache.get(key);
      if (c && now - c.t < 300000) return send(res, c.code, c.body);
      const [code, body] = await routes[u.pathname](u.searchParams);
      if (code === 200) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { t: now, code, body });
      }
      return send(res, code, body);
    }
    // static files
    let path = normalize(decodeURIComponent(u.pathname));
    if (path === "/" || path === "\\") path = "/index.html";
    const file = join(ROOT, path);
    const rel = file.slice(ROOT.length);
    if (!file.startsWith(ROOT) || rel.split("/").some((p) => p === ".." || p.startsWith(".")))
      return send(res, 403, "forbidden", "text/plain");
    const data = await readFile(file);
    send(res, 200, data, MIME[extname(file)] ?? "application/octet-stream");
  } catch (e) {
    if (e.code === "ENOENT") return send(res, 404, "not found", "text/plain");
    // surface the transport cause (DNS, timeout, reset, TLS) - "fetch failed" alone hides it
    send(res, 502, { error: formatUpstreamError(e) });
  }
}).listen(PORT, () => console.log(`Ocean's Eye on http://127.0.0.1:${PORT}`));

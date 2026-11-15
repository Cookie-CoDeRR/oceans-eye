// Ocean's Eye - Space Apps 2026 fresh event build (no prior project code).
// One map over public marine data through the Ocean's Eye access layer
// (/api/*, see server.mjs): OBIS observation records + NASA JPL MUR SST
// + Open-Meteo marine/weather model snapshots.
// Plain-language queries are parsed by explicit rules here, not an LLM.
// AI-assisted code - disclosed per Space Apps SI rules.

import { REGIONS, SPECIES_WORDS, parseQuery, dirCompass, trendSummary, briefingLines } from "./src/ui-core.mjs";

const $ = (id) => document.getElementById(id);
let speciesSeq = 0, trendSeq = 0, msgSeq = 0;
const status = (msg) => { $("status").textContent = msg; };
const endpointLog = [];
// ---------- data catalog (live sources only; nothing ingested or stored) ----------
const CATALOG = {
  sources: [
    ["OBIS", "species occurrence records - reported presence with sampling bias", "api.obis.org/v3"],
    ["NOAA ERDDAP (SWFSC/ERD)", "NASA JPL MUR SST values for the series, field and point requests", "coastwatch.pfeg.noaa.gov/erddap (+ upwell.pfeg.noaa.gov mirror)"],
    ["NASA GIBS", "map tiles: MUR SST and anomaly, MODIS chlorophyll-a, OSCAR currents", "gibs.earthdata.nasa.gov"],
    ["Open-Meteo", "marine (waves, ocean current) and weather (wind) model output, CC BY 4.0", "marine-api.open-meteo.com / api.open-meteo.com"],
    ["GEBCO", "gridded ocean depth via web map service", "wms.gebco.net"],
    ["Esri", "World Imagery satellite base map", "server.arcgisonline.com"],
    ["Wikidata + Wikimedia Commons", "species identity and depicts-verified photos with license filtering", "wikidata.org / commons.wikimedia.org"],
    ["INCOIS (Govt of India)", "official Potential Fishing Zone advisory - linked, never republished", "incois.gov.in/MarineFisheries/PfzWebGis"],
  ],
  datasets: [
    ["NASA JPL MUR SST (GHRSST L4, jplMURSST41)", "deg C", "daily, ~1 km analysis grid, 2002-06 to present (2-day processing lag)", "SST series card, local briefing, map overlay and anomaly overlay"],
    ["OBIS occurrence records", "records per 3-degree cell", "reported presence; effort-biased - not abundance, not absence", "species cells on the map, records-per-year chart"],
    ["Open-Meteo marine model", "wave height (m), period (s), direction (deg FROM), current (km/h, deg TO)", "numerical model output, ~8 km grid, not buoy observations", "local briefing, wave height filter overlay"],
    ["Open-Meteo weather model", "wind speed/direction", "numerical model output, not observations", "local briefing"],
    ["MODIS Aqua L2 chlorophyll-a (via GIBS)", "mg/m3 (log scale)", "daily swaths; gaps between passes are normal", "chlorophyll map overlay"],
    ["OSCAR sea surface currents (via GIBS)", "m/s, zonal (east-west) component only", "source data stops 2024-07-17 - stale, not current conditions", "currents overlay (marked stale)"],
    ["GEBCO gridded bathymetry", "depth relief shading", "compiled grid, not a live feed", "bathymetry overlay"],
    ["Esri World Imagery", "visible-spectrum satellite imagery", "base map tiles", "satellite base map"],
  ],
  api: [
    ["/api/species/grid?name=whale%20shark", "OBIS cells for the map (exact taxon match or curated alias)"],
    ["/api/species/points?name=...&bbox=lonMin,latMin,lonMax,latMax", "reported records near a point"],
    ["/api/species/series?name=...", "reported records per year (global)"],
    ["/api/species/photo?name=...", "depicts-verified, license-allowed photo with credit"],
    ["/api/sst/series?lat=15&lon=70", "MUR SST series, 2003 to latest, ~30-day stride"],
    ["/api/sst/field?bbox=latMin,latMax,lonMin,lonMax&stride=24", "MUR SST grid for one day"],
    ["/api/cell?lat=..&lon=..", "local briefing: SST + waves + current + wind"],
    ["/api/waves/field?bbox=lonMin,latMin,lonMax,latMax", "wave height model cells for the filter overlay"],
    ["/api/trend?lat=..&lon=..", "deseasonalized trend statistics"],
    ["/api/ask (POST)", "AI assistant over the datasets above - enabled only when a provider key is configured on the server; keyword helper otherwise"],
  ],
};
let catalogTab = "overview";
function renderEndpoints() {
  const body = $("catalog-body");
  const f = ($("catalog-filter").value || "").trim().toLowerCase();
  const keep = (row) => !f || row.join(" ").toLowerCase().includes(f);
  const noHit = `<div class="cat-note">Nothing matches "${f}" in this tab.</div>`;
  if (catalogTab === "overview") {
    body.innerHTML =
      `<div class="cat-note"><b>Ocean's Eye fetches live.</b> No ingestion pipeline and no database: every card and layer names the exact public service and URL it used. The server keeps only a short-lived in-memory cache (5 minutes, max 100 responses) so repeat questions answer quickly; nothing survives a restart.</div>` +
      `<div class="cat-stats"><span><b>8</b> sources</span><span><b>8</b> datasets</span><span><b>10</b> API endpoints</span><span><b>0</b> ingested datasets</span></div>`;
  } else if (catalogTab === "sources") {
    const rows = CATALOG.sources.filter(keep);
    body.innerHTML = rows.map(([n, d, u]) =>
      `<div class="cat-row"><b>${n}</b><span class="cat-sub">${d}</span><code>${u}</code></div>`).join("") || noHit;
  } else if (catalogTab === "datasets") {
    const rows = CATALOG.datasets.filter(keep);
    body.innerHTML = rows.map(([n, unit, cov, used]) =>
      `<div class="cat-row"><b>${n}</b><span class="cat-sub">${unit} - ${cov}</span><span class="cat-used">Used for: ${used}</span></div>`).join("") || noHit;
  } else {
    const rows = CATALOG.api.filter(keep);
    const recent = endpointLog.slice(-4).map((e) => `<div class="cat-row"><span class="cat-sub">${e.label}</span><code>${e.url}</code></div>`);
    body.innerHTML =
      `<div class="cat-note">Endpoints served by this app (same machine, port 8741). Successful responses name the exact upstream source URL; error responses name the failure cause instead.</div>` +
      (rows.map(([u, d]) => `<div class="cat-row"><code>${u}</code><span class="cat-sub">${d}</span></div>`).join("") || noHit) +
      (recent.length ? `<div class="layers-group">Recent queries this session</div>` + recent.join("") : "");
  }
}
document.querySelectorAll(".cat-tab").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    catalogTab = b.dataset.cat;
    document.querySelectorAll(".cat-tab").forEach((x) => x.classList.toggle("on", x === b));
    renderEndpoints();
  })
);
$("catalog-filter").addEventListener("input", renderEndpoints);
$("cat-n-sources").textContent = CATALOG.sources.length;
$("cat-n-datasets").textContent = CATALOG.datasets.length;
$("cat-n-api").textContent = CATALOG.api.length;
function setView(v) {
  document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  $("catalog-view").classList.toggle("hidden", v !== "catalog");
  $("map-wrap").classList.toggle("hidden", v === "catalog");
  $("footbar").classList.toggle("hidden", v === "catalog");
  if (v === "map") setTimeout(() => map.invalidateSize(), 60);
  else renderEndpoints();
}
document.querySelectorAll(".view-btn").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view))
);
function logEndpoint(label, url) {
  endpointLog.push({ label, url });
  renderEndpoints();
}
async function api(path) {
  const r = await fetch(path);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `API ${r.status}`);
  if (data.source) logEndpoint(`Ocean's Eye ${path.split("?")[0]} (source in payload)`, path);
  return data;
}


// ---------- monochrome inline icons (no emoji) ----------
const IC = (p, vb = "0 0 24 24") =>
  `<svg class="ic" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  fish: IC('<path d="M3 12c3.5-4.5 8-6.5 12-6.5 3 0 5 1.5 6 2.5-1 1-1.5 2.5-1.5 4s.5 3 1.5 4c-1 1-3 2.5-6 2.5-4 0-8.5-2-12-6.5z"/><circle cx="9" cy="11" r="0.4" fill="currentColor"/><path d="M3 12l-1.5-3M3 12l-1.5 3"/>'),
  wave: IC('<path d="M2 8c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 4-2 5-1"/><path d="M2 14c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 4-2 5-1"/>'),
  chat: IC('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>'),
  data: IC('<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>'),
  layers: IC('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  compass: IC('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  pin: IC('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/>'),
};
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// ---------- roles (preference selector, not sign-in or verified profession) ----------
const ROLES = {
  researcher: {
    label: "Researcher",
    hello: "Researcher view: full numbers up front, methods and sources under each card. Reported records are effort-biased samples, never abundance.",
    suggestions: ["how has temperature changed in the Arabian Sea", "where have whale sharks been observed", "yellowfin tuna records trend"],
  },
  student: {
    label: "Student",
    hello: "Student view: plain-language summaries first; open 'sources and method' on any card to see exactly where the data comes from.",
    suggestions: ["show whale sharks", "how has temperature changed in the Arabian Sea", "sardine records trend"],
  },
  fisherman: {
    label: "Fisherman",
    hello: `Fisherman view: latest sea conditions first. For official Potential Fishing Zone advisories, use the Government of India INCOIS service - Ocean's Eye does not compute fishing zones.<br><a class="pfz-link" href="https://www.incois.gov.in/MarineFisheries/PfzWebGis" target="_blank" rel="noopener noreferrer">Open official INCOIS PFZ advisory</a>`,
    suggestions: ["sea temperature", "indian oil sardine", "mackerel records trend"],
  },
};
let role = "researcher";
function setRole(r) {
  role = r;
  try { localStorage.setItem("oe-role", r); } catch (e) {}
  document.querySelectorAll(".role-chip").forEach((b) => b.classList.toggle("on", b.dataset.role === r));
  chatSay(`${ROLES[r].hello}`, true);
}
document.querySelectorAll(".role-chip").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
try { role = localStorage.getItem("oe-role") || "researcher"; } catch (e) {}
const urlRole = new URLSearchParams(location.search).get("role");
if (urlRole) role = urlRole;
if (!ROLES[role]) role = "researcher";

// ---------- map ----------
const map = L.map("map", { worldCopyJump: true, zoomControl: true }).setView([12, 74], 4);

const speciesLayer = L.layerGroup().addTo(map);

// ---------- base maps ----------
const streetBase = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
  className: "ocean-tiles",
});
const satelliteBase = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxNativeZoom: 18, maxZoom: 19 }
);
const BASES = { street: streetBase, satellite: satelliteBase };
map.addLayer(streetBase);
document.querySelectorAll(".base-card").forEach((card) => {
  card.addEventListener("click", (e) => {
    e.stopPropagation();
    const chosen = card.dataset.base;
    for (const [k, layer] of Object.entries(BASES)) {
      if (k === chosen) { if (!map.hasLayer(layer)) map.addLayer(layer); }
      else if (map.hasLayer(layer)) map.removeLayer(layer);
    }
    document.querySelectorAll(".base-card").forEach((c) => c.classList.toggle("on", c === card));
  });
});

// ---------- overlays (all real sources; stale feeds are dated, gaps named) ----------
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const gibsDate = () => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const graticuleLayer = L.layerGroup();
for (let lon = -180; lon <= 180; lon += 10)
  graticuleLayer.addLayer(L.polyline([[-85, lon], [85, lon]], { color: "#7d9db4", weight: 0.6, opacity: 0.55, interactive: false }));
for (let lat = -80; lat <= 80; lat += 10)
  graticuleLayer.addLayer(L.polyline([[lat, -180], [lat, 180]], { color: "#7d9db4", weight: 0.6, opacity: 0.55, interactive: false }));
const meshLayer = L.layerGroup();
function drawMesh() {
  meshLayer.clearLayers();
  const c = map.getCenter();
  const dLat = 5 / 110.574;
  const dLon = 5 / (111.32 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = -5; i <= 5; i++)
    for (let j = -5; j <= 5; j++) {
      const la = c.lat + i * dLat, lo = c.lng + j * dLon;
      meshLayer.addLayer(L.rectangle([[la - dLat / 2, lo - dLon / 2], [la + dLat / 2, lo + dLon / 2]],
        { color: "#7d9db4", weight: 0.7, opacity: 0.6, fill: false, interactive: false }));
    }
}
map.on("moveend", () => { if (map.hasLayer(meshLayer)) drawMesh(); });

// ---------- wave height filter (real model cells + working threshold slider) ----------
const wavesLayer = L.layerGroup();
let wavesCells = [], wavesStep = 1, wavesThreshold = 4, wavesSeq = 0, wavesTimer = 0;
function waveColor(h) {
  const t = Math.min(Math.max(h / 6, 0), 1);
  return `rgb(${Math.round(30 + 225 * t)},${Math.round(120 - 80 * t)},${Math.round(180 - 150 * t)})`;
}
function drawWaves() {
  wavesLayer.clearLayers();
  const half = wavesStep / 2;
  for (const c of wavesCells) {
    const rect = L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]], {
      color: waveColor(c.h), weight: 0.4, opacity: 0.4, fillColor: waveColor(c.h),
      fillOpacity: c.h <= wavesThreshold ? 0.55 : 0.07, interactive: false,
    });
    if (wavesStep >= 0.8) rect.bindTooltip(`${c.h.toFixed(1)}`, { permanent: true, direction: "center", className: "wave-lab", interactive: false });
    c.rect = rect;
    wavesLayer.addLayer(rect);
  }
}
function applyWavesThreshold() {
  for (const c of wavesCells) if (c.rect) c.rect.setStyle({ fillOpacity: c.h <= wavesThreshold ? 0.55 : 0.07, opacity: c.h <= wavesThreshold ? 0.4 : 0.15 });
}
async function loadWaves() {
  const seq = ++wavesSeq;
  const b = map.getBounds();
  const url = `api/waves/field?bbox=${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `server ${r.status}`);
    if (seq !== wavesSeq || !map.hasLayer(wavesLayer)) return;
    wavesCells = d.cells; wavesStep = d.step || 1;
    drawWaves();
    status(`Wave height: ${wavesCells.length} sampled cells${d.validTime ? `, valid ${d.validTime} UTC` : d.mixedValidTimes ? ", cells have mixed valid times" : ""} - cells above the slider limit are dimmed.`);
  } catch (e) {
    if (seq !== wavesSeq) return;
    status(`Wave height layer failed: ${e.message}`);
  }
}
map.on("moveend", () => {
  if (!map.hasLayer(wavesLayer)) return;
  clearTimeout(wavesTimer);
  wavesTimer = setTimeout(loadWaves, 600);
});

const OVERLAYS = [
  { header: "Environmental layers" },
  { id: "sst", name: "Sea surface temperature", dot: "#e2703a",
    desc: () => `NASA JPL MUR L4 satellite SST via NASA GIBS - daily, ~1km grid; image date ${gibsDate()} (about a 2-day processing lag, so not necessarily the latest available)`,
    legend: () => ({ img: "https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg", caption: `MUR SST colour scale (deg C) - image date ${gibsDate()}. Official NASA GIBS legend.` }),
    make: () => L.tileLayer(`${GIBS}/GHRSST_L4_MUR_Sea_Surface_Temperature/default/${gibsDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, { maxNativeZoom: 7, opacity: 0.8, attribution: "NASA GIBS - JPL MUR SST" }) },
  { id: "sst-anom", name: "SST anomaly", dot: "#d43d51",
    desc: () => `MUR SST vs seasonal climatology via NASA GIBS; image date ${gibsDate()} (about a 2-day lag)`,
    legend: () => ({ img: "https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_Anomalies_H.svg", caption: `SST anomaly colour scale (deg C vs climatology) - image date ${gibsDate()}. Official NASA GIBS legend.` }),
    make: () => L.tileLayer(`${GIBS}/GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies/default/${gibsDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, { maxNativeZoom: 7, opacity: 0.7, attribution: "NASA GIBS - JPL MUR SST anomaly" }) },
  { id: "chl", name: "Chlorophyll-a", dot: "#2fa05a",
    desc: () => `MODIS Aqua via NASA GIBS - daily satellite swaths, gaps between passes are normal; image date ${gibsDate()}`,
    legend: () => ({ img: "https://gibs.earthdata.nasa.gov/legends/MODIS_Chlorophyll_H.svg", caption: `Chlorophyll-a colour scale (mg/m3, log) - image date ${gibsDate()}. Official NASA GIBS legend.` }),
    make: () => L.tileLayer(`${GIBS}/MODIS_Aqua_L2_Chlorophyll_A/default/${gibsDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, { maxNativeZoom: 7, opacity: 0.8, attribution: "NASA GIBS - MODIS Aqua chlorophyll-a" }) },
  { id: "currents", name: "Surface current, east-west part (stale)", dot: "#1a6fb5",
    desc: () => `OSCAR zonal (east-west) current speed via NASA GIBS - this is one component only: no direction arrows, no full flow field. Source last updated 17 Jul 2024, not current conditions`,
    legend: () => ({ img: "https://gibs.earthdata.nasa.gov/legends/OSCAR_Sea_Surface_Currents_Zonal_H.svg", caption: "OSCAR zonal current speed (m/s), east-west component only - image date 2024-07-17 (stale). Official NASA GIBS legend." }),
    make: () => L.tileLayer(`${GIBS}/OSCAR_Sea_Surface_Currents_Zonal/default/2024-07-17/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, { maxNativeZoom: 6, opacity: 0.7, attribution: "NASA GIBS - OSCAR currents (2024)" }) },
  { id: "bathy", name: "Bathymetric depth relief", dot: "#7a5ea8",
    desc: () => `GEBCO gridded ocean depth via the GEBCO web map service`,
    make: () => L.tileLayer.wms("https://wms.gebco.net/mapserv?", { layers: "GEBCO_LATEST_2", format: "image/png", transparent: true, version: "1.3.0", opacity: 0.65, attribution: "GEBCO Compilation Group (2025) GEBCO grid" }) },
  { header: "Map overlays" },
  { id: "waves", name: "Wave height filter", dot: "#0f9488",
    desc: () => `Open-Meteo marine model wave height, current conditions - sampled as cells across the view, each value from the nearest ~8km sea grid cell; cells above the slider limit are dimmed`,
    legend: () => ({ bar: "linear-gradient(90deg,rgb(30,120,180),rgb(255,40,30))", caption: "Wave height (m): 0 blue to 6+ red - cells above the slider value are dimmed" }),
    group: () => wavesLayer, onshow: loadWaves },
  { id: "species", name: "Species observation records", dot: "#8fa9bd",
    desc: () => `OBIS reported-presence cells from your queries - reported presence, not abundance`,
    group: () => speciesLayer, on: true },
  { id: "graticule", name: "Graticule 10°", dot: "#b08968",
    desc: () => `Parallels and meridians every 10 degrees, drawn locally`,
    group: () => graticuleLayer },
  { id: "mesh", name: "5 km reference mesh", dot: "#6b7f8f",
    desc: () => `5 km cells centred on the map view, drawn locally - a scale reference, best seen zoomed in`,
    group: () => meshLayer, onshow: drawMesh },
];
const overlayState = {};
const list = $("overlay-list");
for (const ov of OVERLAYS) {
  if (ov.header) {
    const g = document.createElement("div");
    g.className = "layers-group";
    g.innerHTML = `${ov.header}<span class="layers-count" id="ogc-${ov.header === "Environmental layers" ? "env" : "ov"}"></span>`;
    list.appendChild(g);
    ov._groupEl = g;
    continue;
  }
  overlayState[ov.id] = !!ov.on;
  const row = document.createElement("div");
  row.className = "overlay-row";
  row.innerHTML =
    `<span class="ov-dot" style="background:${ov.dot || "#8fa9bd"}"></span>` +
    `<span class="ov-text"><b>${ov.name}</b><span class="ov-sub">${ov.desc()}</span></span>` +
    `<label class="switch"><input type="checkbox" data-ov="${ov.id}"${ov.on ? " checked" : ""}><span class="knob"></span></label>`;
  ov._row = row;
  list.appendChild(row);
}
const ENV_IDS = ["sst", "sst-anom", "chl", "currents", "bathy"];
function refreshOverlayCount() {
  const env = ENV_IDS.filter((i) => overlayState[i]).length;
  const oth = Object.keys(overlayState).filter((i) => overlayState[i] && !ENV_IDS.includes(i)).length;
  const e1 = $("ogc-env"), e2 = $("ogc-ov");
  if (e1) e1.textContent = `${env} active`;
  if (e2) e2.textContent = `${oth} active`;
}
refreshOverlayCount();
// sensor thresholds: max wave height slider drives the wave filter layer
$("thresh-range").addEventListener("input", (e) => {
  wavesThreshold = Number(e.target.value);
  $("thresh-val").textContent = `${wavesThreshold.toFixed(1)} m`;
  const box = document.querySelector('.overlay-row input[data-ov="waves"]');
  if (box && !box.checked) box.click();
  applyWavesThreshold();
});

// legend chip: official source legends for quantitative overlays, with image date
function renderLegends() {
  const box = $("layer-legends");
  const parts = OVERLAYS.filter((o) => o.legend && overlayState[o.id]).map((o) => {
    const l = o.legend();
    const vis = l.img ? `<img src="${l.img}" alt="${esc(o.name)} legend" onerror="this.parentElement.remove()">` : `<span class="legend-bar" style="background:${l.bar}"></span>`;
    return `<div class="legend-item">${vis}<span>${l.caption}</span></div>`;
  });
  box.innerHTML = parts.join("");
  box.classList.toggle("hidden", parts.length === 0);
}
list.addEventListener("change", (e) => {
  const id = e.target.dataset.ov;
  if (!id) return;
  const ov = OVERLAYS.find((o) => o.id === id);
  overlayState[id] = e.target.checked;
  let layer = ov._layer;
  if (!layer) {
    layer = ov._layer = ov.make ? ov.make() : ov.group();
    // surface real tile failures instead of silently showing a partial layer;
    // the count persists while the layer is on - one successful tile never clears it
    layer.on("tileerror", () => {
      if (!overlayState[id]) return;
      ov._errCount = (ov._errCount || 0) + 1;
      const now = Date.now();
      if (!ov._errAt || now - ov._errAt > 20000) {
        ov._errAt = now;
        status(`${ov.name}: ${ov._errCount} tile(s) failed to load from the source - the layer may be incomplete.`);
      }
    });
  }
  if (e.target.checked) { layer.addTo(map); if (ov.onshow) ov.onshow(); }
  else { map.removeLayer(layer); ov._errCount = 0; ov._errAt = 0; }
  refreshOverlayCount();
  refreshOverlayCount();
  renderLegends();
});
$("layers-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("layers-pop").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#layers-box")) $("layers-pop").classList.add("hidden");
});
let welcomed = false;
function openChat() {
  setPanel(true);
  setTab("ask");
  if (!welcomed) { welcomed = true; welcome(); }
}
$("chat-tab").addEventListener("click", openChat);
function setTab(tab) {
  $("tab-btn-briefing").classList.toggle("on", tab === "briefing");
  $("tab-btn-ask").classList.toggle("on", tab === "ask");
  $("briefing-view").classList.toggle("hidden", tab !== "briefing");
  $("chat-view").classList.toggle("hidden", tab !== "ask");
}
$("tab-btn-briefing").addEventListener("click", () => setTab("briefing"));
$("tab-btn-ask").addEventListener("click", () => setTab("ask"));
document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

// ---------- chat log ----------
function setPanel(open) {
  $("panel").classList.toggle("hidden", !open);
  document.body.classList.toggle("panel-open", open);
}
function chatSay(html, quiet) {
  const id = `msg-${++msgSeq}`;
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = id;
  div.innerHTML = html;
  $("chat-log").appendChild(div);
  div.scrollIntoView({ block: "start" });
  if (!quiet) { setPanel(true); setTab("ask"); }
  return id;
}
function briefingSet(html) {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "briefing-card";
  div.innerHTML = html;
  const view = $("briefing-view");
  view.innerHTML = "";
  view.appendChild(div);
  setPanel(true);
  setTab("briefing");
  return "briefing-card";
}
function briefingWrite(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}
function chatUser(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}
function chatSet(id, html) {
  const el = $(id);
  if (el) { el.innerHTML = html; el.scrollIntoView({ block: "start" }); }
}

// ---------- species layer ----------
let currentSpecies = null;

async function showSpecies(name) {
  const seq = ++speciesSeq;
  status(`Resolving "${name}" in OBIS...`);
  const data = await api(`api/species/grid?name=${encodeURIComponent(name)}&precision=3`);
  if (seq !== speciesSeq) return null; // a newer query superseded this one
  const sci = data.taxon.scientificName;
  status(`Loading recorded observations of ${sci}...`);
  speciesLayer.clearLayers();
  const feats = (data.grid.features ?? [])
    .filter((f) => f.properties?.n > 0)
    .sort((a, b) => b.properties.n - a.properties.n)
    .slice(0, 2500);
  if (!feats.length) {
    chatSay(`${ICON.fish} No OBIS records for <b>${sci}</b>. That means none reported, not that it is absent.`);
    status(`No OBIS records for ${sci}.`);
    return null;
  }
  const maxN = Math.max(...feats.map((f) => f.properties.n), 1);
  let total = 0;
  for (const f of feats) {
    total += f.properties.n;
    const [lon, lat] = f.geometry.coordinates[0][0];
    const [lon2, lat2] = f.geometry.coordinates[0][2];
    const t = Math.sqrt(f.properties.n / maxN);
    speciesLayer.addLayer(
      L.rectangle([[lat2, lon], [lat, lon2]], {
        color: "#2fd4c4", weight: 0.5, fillColor: "#2fd4c4", fillOpacity: 0.15 + 0.55 * t,
      }).bindPopup(
        `<b>${sci}</b><br>${f.properties.n} observation records in this cell.<br><i>Records show reported presence, not abundance.</i>`
      )
    );
  }
  $("species-chip").classList.remove("hidden");
  $("species-chip").innerHTML =
    `<b>${sci}</b> - ${total.toLocaleString()} records in shown cells. ` +
    `Reported presence, not abundance. Source: OBIS.<br><span style="color:#51708a">Legend: deeper teal = more records in that cell (square-root scale, 3&deg; cells).</span>`;
  chatSay(
    `${ICON.fish} <b>${sci}</b>: ${total.toLocaleString()} observation records in the ${feats.length.toLocaleString()} map cells now shown. ` +
    `These are reported sightings - they show where records exist, not abundance, and gaps often mean no survey effort.<br>` +
    `<span class="src">Source: OBIS occurrence records, gridded at 3&deg;. Tap the ocean for local conditions.</span>`
  );
  status(`Showing ${feats.length} grid cells with records of ${sci}. Tap the ocean for its conditions.`);
  currentSpecies = sci;
  setChatContext(`Species records - ${sci}`);
  return sci;
}

// ---------- species records over time (reported records, not abundance) ----------
function recordsChart(rows) {
  const w = 360, h = 110, pad = 8;
  const max = Math.max(...rows.map((r) => r.records), 1);
  const bw = (w - 2 * pad) / rows.length;
  const bars = rows
    .map((r, i) => {
      const bh = (r.records / max) * (h - 2 * pad - 12);
      return `<rect x="${(pad + i * bw).toFixed(1)}" y="${(h - pad - bh).toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="#1a6fb5"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="records per year chart">
    ${bars}
    <text x="${pad}" y="12" fill="#51708a" font-size="9">records/year (max ${max.toLocaleString()})</text>
    <text x="${pad}" y="${h - 1}" fill="#51708a" font-size="9">${rows[0].year}</text>
    <text x="${w - pad - 26}" y="${h - 1}" fill="#51708a" font-size="9">${rows[rows.length - 1].year}</text>
  </svg>`;
}

async function showSpeciesCard(sci, queried) {
  briefingSet(`${ICON.fish} <b>${sci}</b> - loading species card (open photo and reported records per year)...`);
  const [seriesR, photoR] = await Promise.allSettled([
    api(`api/species/series?name=${encodeURIComponent(sci)}`),
    api(`api/species/photo?name=${encodeURIComponent(sci)}`),
  ]);
  const photo = photoR.status === "fulfilled" ? photoR.value : null;
  const series = seriesR.status === "fulfilled" ? seriesR.value : null;
  const rows = (series?.years ?? []).filter((r) => r.records > 0);
  const searched =
    queried && queried.trim().toLowerCase() !== sci.toLowerCase()
      ? ` <span class="muted">(searched as "${esc(queried)}")</span>`
      : "";
  const p = photo?.photo;
  const licenseHtml = p
    ? p.licenseUrl
      ? `<a href="${p.licenseUrl}" target="_blank" rel="noopener">${esc(p.license)}</a>`
      : esc(p.license)
    : "";
  const photoHtml = p
    ? `<img class="species-photo" src="${p.thumb}" alt="${esc(sci)} - openly licensed photo via Wikimedia Commons" loading="lazy">
       <div class="credit">Photo: ${esc(p.artist)} - ${licenseHtml}, via <a href="${p.page}" target="_blank" rel="noopener">Wikimedia Commons</a>. Depicts-statement verified for this species; illustrative image, not a photo from a reported record.</div>`
    : `<div class="credit">No identity-verified openly licensed photo available for this species - the records below still stand on their own.</div>`;
  const chartHtml = rows.length
    ? `<div class="card-sub">${ICON.data} <b>Reported records per year (global)</b> - ${rows.reduce((a, r) => a + r.records, 0).toLocaleString()} dated records, ${rows[0].year}-${rows[rows.length - 1].year}</div>
       ${recordsChart(rows)}
       <div class="src">Counts reporting activity as much as animals - more records can mean more surveys, not more fish. Not abundance, not a population trend, not a stock assessment. Source: OBIS occurrence statistics.</div>`
    : `<div class="src">No dated OBIS records to chart for ${sci}.</div>`;
  briefingSet(
    `<div class="card-head">${ICON.fish} <b>${sci}</b>${searched}</div>` +
    photoHtml +
    `<div class="card-sub">${ICON.pin} <b>Where it has been recorded</b> - teal cells on the map hold OBIS observation records. Reported presence only: records show where it was reported, not abundance, and gaps often mean no survey effort.</div>` +
    chartHtml
  );
  status(`Species card for ${sci} opened in the Briefing tab.`);
}

// ---------- SST field layer ----------
// ---------- trend + briefing card ----------
function anomalyChart(anomalies) {
  const w = 360, h = 130, pad = 8;
  const xs = anomalies.map((_, i) => pad + (i / (anomalies.length - 1)) * (w - 2 * pad));
  const ys = anomalies.map((p) => p.v);
  const min = Math.min(...ys), max = Math.max(...ys);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const pts = xs.map((x, i) => `${x.toFixed(1)},${y(ys[i]).toFixed(1)}`).join(" ");
  const firstYear = anomalies[0].t.slice(0, 4);
  const lastYear = anomalies[anomalies.length - 1].t.slice(0, 4);
  const y0 = y(0);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="temperature anomaly chart">
    <line x1="${pad}" y1="${y0}" x2="${w - pad}" y2="${y0}" stroke="#b9ccd9" stroke-dasharray="3 3" stroke-width="0.7"/>
    <polyline points="${pts}" fill="none" stroke="#1a6fb5" stroke-width="1.2"/>
    <text x="${pad}" y="14" fill="#51708a" font-size="9">${max.toFixed(1)} anomaly (deg C)</text>
    <text x="${pad}" y="${h - 2}" fill="#51708a" font-size="9">${firstYear}</text>
    <text x="${w - pad - 26}" y="${h - 2}" fill="#51708a" font-size="9">${lastYear}</text>
  </svg>`;
}

async function showCellBriefing(lat, lon, seq) {
  const el = $(`brief-${seq}`);
  if (!el) return;
  try {
    const b = await api(`api/cell?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
    if (seq !== trendSeq) return; // superseded by a newer tap
    const lines = briefingLines(b);
    const sst = b.sections.sst;
    const m = b.sections.marine;
    const w = b.sections.weather;
    const at = (s) => (s && !s.error && s.sampledAt ? `${s.label}: grid point ${s.sampledAt.lat.toFixed(3)}, ${s.sampledAt.lon.toFixed(3)}${s.validTime ? ", valid " + s.validTime + (s.validTime.endsWith("Z") ? "" : " UTC") : ""}` : null);
    const srcLines = [at(sst), at(m), at(w)].filter(Boolean).join("<br>");
    el.innerHTML = lines.length
      ? `<p class="brief-lines">${lines.join("<br>")}</p>
         <details class="src-details"><summary>sources and method</summary>
         <span class="src">Latest model snapshot per source, not a time-evolving pattern. Each value comes from that source's own nearest grid point.<br>${srcLines}<br>
         ${sst && !sst.error ? sst.dataset + "<br>" : ""}${m && !m.error ? m.dataset + " - " + m.note + "<br>" : ""}${w && !w.error ? w.dataset + " - " + w.note : ""}</span></details>`
      : `<p>No current-condition data available for this point.</p>`;
    if (location.hash === "#cell") el.scrollIntoView();
  } catch (e) {
    el.innerHTML = `<p>Could not load current conditions: ${e.message}</p>`;
  }
}

async function showTrend(lat, lon) {
  const seq = ++trendSeq;
  const msgId = briefingSet(`Loading NASA MUR sea-temperature series for ${lat.toFixed(2)}, ${lon.toFixed(2)} (2003 to today)...`);
  try {
    const r = await api(`api/trend?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
    if (seq !== trendSeq) return; // superseded by a newer tap
    if (!r.ok) {
      briefingWrite(msgId, `<b>Sea temperature trend</b><p>${r.reason}.</p>`);
      return;
    }
    briefingWrite(msgId, `
      <b>Sea temperature trend</b> - ${trendSummary(r, lat, lon, role)}
      ${anomalyChart(r.anomalies)}
      <div id="brief-${seq}"><p>loading current conditions...</p></div>
      ${currentSpecies ? `<p id="spp-${seq}" class="src">checking nearby ${currentSpecies} records...</p>` : ""}
      <details class="src-details"><summary>sources and method</summary>
      <span class="src">Nearest analysis point ${lat.toFixed(2)}, ${lon.toFixed(2)}; NASA JPL MUR SST, ${r.n} samples (~every 30 days), ${r.anomalies[0].t.slice(0, 10)} to ${r.anomalies[r.anomalies.length - 1].t.slice(0, 10)}.<br>
      Method: ${r.method}. ${r.caveat}. Level-4 satellite SST analysis grid (GHRSST MUR v4.1), not a direct thermometer record at this exact point. Anomalies = monthly seasonal cycle removed.</span></details>
    `);
    showCellBriefing(lat, lon, seq);
    if (currentSpecies) {
      const occ = await api(
        `api/species/points?name=${encodeURIComponent(currentSpecies)}&bbox=${lon - 2.5},${lat - 2.5},${lon + 2.5},${lat + 2.5}&size=1`
      );
      if (seq !== trendSeq) return;
      const el = $(`spp-${seq}`);
      if (el)
        el.innerHTML = occ.total > 0
          ? `${occ.total.toLocaleString()} reported ${currentSpecies} records within ~2.5&deg;. This overlap is a starting question, not evidence of cause.`
          : `No reported ${currentSpecies} records within ~2.5&deg; - that means none reported here, not that the species is absent.`;
    }
    status(`Trend at ${lat.toFixed(1)}, ${lon.toFixed(1)}: ${r.slopePerDecade >= 0 ? "+" : ""}${r.slopePerDecade.toFixed(2)} degC/decade (z=${r.z.toFixed(2)}).`);
  } catch (e) {
    briefingWrite(msgId, `<b>Sea temperature trend</b><p>Could not load the SST series: ${e.message}</p>`);
  }
}

map.on("click", (e) => showTrend(e.latlng.lat, e.latlng.lng));
$("panel-close").addEventListener("click", () => setPanel(false));

async function runQuery(q) {
  const { region, wantsTrend, wantsSpecies, species } = parseQuery(q);
  try {
    if (species) {
      const sci = await showSpecies(species);
      if (region) map.flyTo([REGIONS[region].lat, REGIONS[region].lon], REGIONS[region].zoom);
      if (sci) showSpeciesCard(sci, species);
    } else if (wantsTrend && region) {
      map.flyTo([REGIONS[region].lat, REGIONS[region].lon], REGIONS[region].zoom);
      showTrend(REGIONS[region].lat, REGIONS[region].lon);
    } else if (wantsTrend) {
      chatSay("Tap any point on the ocean and I will load its temperature trend and current conditions.");
    } else if (region) {
      map.flyTo([REGIONS[region].lat, REGIONS[region].lon], REGIONS[region].zoom);
      chatSay(`Showing ${region}. Ask about a species, or tap the ocean for its conditions.`);
    } else if (wantsSpecies) {
      chatSay('Name a species, e.g. "where have whale sharks been observed".');
    } else {
      chatSay('Try a species ("show yellowfin tuna") or a trend ("how has temperature changed in the Arabian Sea").');
    }
  } catch (e) {
    chatSay("That query failed: " + e.message);
  }
}
// ---------- AI assistant (optional; keyword helper is the fallback) ----------
let aiOn = null; // null = not probed yet
const aiSession = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
async function probeAI() {
  try {
    const r = await fetch("api/ask");
    aiOn = !!(await r.json()).configured;
  } catch { aiOn = false; }
  if (aiOn)
    $("chat-note").textContent =
      "AI assistant over live public data - answers cite the named datasets; unavailable data is reported, not estimated.";
  if (aiOn) $("chat-note").innerHTML += ' <details class="src-details"><summary>glossary</summary><span class="src">Presence-only / reported records: sightings reported to OBIS - they show where life was reported, never how many, and no records does not mean absent. Abundance: how many animals there are - these records cannot show that. Wave direction: where waves come FROM. Current direction: where water flows TO. Model output: computer simulation, not a buoy measurement.</span></details>';
}
probeAI();
async function aiAsk(q) {
  const r = await fetch("api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: q, sessionId: aiSession, role }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.answer) {
    if (r.status === 503) aiOn = false;
    await runQuery(q);
    if (r.status === 429 && body.message) chatSay(`<p class="src">${esc(body.message)}</p>`);
    else if (r.status !== 503) chatSay(`<p class="src">AI assistant unavailable right now (free quota or provider error) - answered with the basic helper instead.</p>`);
    return;
  }
  function renderAnswer(t) {
    const lines = t.split("\n");
    let html = "", inList = false;
    for (const ln of lines) {
      const m = ln.match(/^\s*-\s+(.*)$/);
      if (m) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + m[1] + "</li>"; }
      else { if (inList) { html += "</ul>"; inList = false; } html += (html ? "<br>" : "") + ln; }
    }
    if (inList) html += "</ul>";
    return html;
  }
  const ansHtml = renderAnswer(esc(body.answer).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*\n]+)\*/g, "<i>$1</i>"));
  chatSay(
    `<p>${ansHtml}</p>` +
    (body.sources?.length
      ? `<details class="src-details"><summary>sources</summary><span class="src">${body.sources.map((u) => esc(u)).join("<br>")}</span></details>`
      : "")
  );
  {
    const spList = (body.actions || []).filter((a) => a.type === "species" && a.name);
      const sp = spList.find((a) => /^[A-Z][a-z]+ [a-z]+/.test(a.name)) || spList[0];
    if (sp) api("api/species/photo?name=" + encodeURIComponent(sp.name)).then((photoR) => {
      const p = photoR && photoR.photo;
      chatSay(p
        ? "<img class=\"species-photo chat-photo\" src=\"" + p.thumb + "\" alt=\"" + esc(sp.name) + " - openly licensed photo via Wikimedia Commons\" loading=\"lazy\"><div class=\"credit\">Photo: " + esc(p.artist || "") + (p.license ? " - " + esc(p.license) : "") + ", via <a href=\"" + p.page + "\" target=\"_blank\" rel=\"noopener\">Wikimedia Commons</a>. Depicts-statement verified for this species; illustrative image, not a photo from a reported record.</div>"
        : "<div class=\"credit\">No identity-verified openly licensed photo available for " + esc(sp.name) + " - the species card in the Briefing tab still stands on the records.</div>");
    }).catch(() => {});
  }
  for (const a of body.actions || []) {
    if (a.type === "flyTo" && Number.isFinite(a.lat) && Number.isFinite(a.lon)) map.flyTo([a.lat, a.lon], a.zoom || 7);
    else if (a.type === "species" && a.name) showSpecies(a.name);
  }
}
async function runQueryFrom(inputEl) {
  const q = inputEl.value.trim();
  if (!q) return;
  inputEl.value = "";
  openChat();
  chatUser(q);
  if (aiOn) await aiAsk(q);
  else await runQuery(q);
}
$("query-go").addEventListener("click", () => runQueryFrom($("query")));
$("query").addEventListener("keydown", (e) => { if (e.key === "Enter") runQueryFrom($("query")); });
$("chat-go").addEventListener("click", () => runQueryFrom($("chat-input")));
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") runQueryFrom($("chat-input")); });

// ---------- welcome + shareable views (also used by tests) ----------
document.querySelectorAll(".role-chip").forEach((b) => b.classList.toggle("on", b.dataset.role === role));
function starterKind(q) {
  return /temperature|sea surface|sst/i.test(q) ? { icon: ICON.wave, tag: "Temperature" } : { icon: ICON.fish, tag: "Records" };
}
function welcome() {
  chatSay(
    `<div class="welcome">` +
    `<div class="welcome-icon">${ICON.compass}</div>` +
    `<div class="welcome-title">Ocean's Eye is ready</div>` +
    `<div class="welcome-sub">Tap the ocean for a local briefing, or ask about species records and sea temperature.<br>${ROLES[role].hello}</div>` +
    `<div class="starter-rows">${ROLES[role].suggestions.map((s) => {
      const k = starterKind(s);
      return `<button class="starter-row" data-q="${s}"><span class="starter-ic">${k.icon}</span><span class="starter-q">${s}</span><span class="starter-tag">${k.tag}</span></button>`;
    }).join("")}</div>` +
    `</div>`,
    true
  );
}
function setChatContext(text) {
  const el = $("chat-context");
  if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.classList.remove("hidden");
  el.innerHTML = `<span class="ctx-label">Active layer</span> ${esc(text)}`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".sugg-chip, .starter-row");
  if (b) { openChat(); chatUser(b.dataset.q); runQuery(b.dataset.q); }
});


const params = new URLSearchParams(location.search);
if (params.get("q")) {
  openChat();
  chatUser(params.get("q"));
  runQuery(params.get("q"));
} else if (params.get("trend")) {
  openChat();
  const [la, lo] = params.get("trend").split(",").map(Number);
  if (Number.isFinite(la) && Number.isFinite(lo)) showTrend(la, lo);
} else if (params.get("endpoints") === "1") {
  setView("catalog");
  catalogTab = "api";
  document.querySelectorAll(".cat-tab").forEach((x) => x.classList.toggle("on", x.dataset.cat === "api"));
  renderEndpoints();
} else if (params.get("sst") === "1") {
  const cb = document.querySelector('input[data-ov="sst"]');
  if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
} else {
  renderEndpoints();
  status("Ready. Ask about a species, or tap the ocean for its conditions.");
}

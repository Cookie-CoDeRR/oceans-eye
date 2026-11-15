// Targeted fixtures for species identity resolution and photo verification.
// fetchJson is stubbed; no network. Run: node test/photo.test.mjs
import assert from "node:assert";
import { resolveTaxonExact, speciesPhoto, ACCEPTED_LICENSE } from "../src/species-photo.mjs";

const ALIASES = { "whale shark": "Rhincodon typus" };

// --- stub upstream responses ---------------------------------------------
const OBIS = {
  "rhincodon typus": { results: [{ scientificName: "Rhincodon typus", taxonID: 1 }] },
  "dolphin": { results: [{ scientificName: "Delphinus delphis" }, { scientificName: "Tursiops truncatus" }] },
  "ghostfish x": { results: [] },
};
const WD_SEARCH = { search: [{ id: "Q100" }, { id: "Q200" }] };
const WD_ENTITIES = {
  Q100: { entities: { Q100: { claims: { P225: [{ mainsnak: { datavalue: { value: "Some other species" } } }] } } } },
  Q200: { entities: { Q200: { claims: { P225: [{ mainsnak: { datavalue: { value: "Rhincodon typus" } } }] } } } },
};
const img = (em, extra = {}) => ({
  imageinfo: [{
    thumburl: "https://thumb.wikimedia.org/x.jpg",
    url: "https://upload.wikimedia.org/x.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    mime: "image/jpeg",
    extmetadata: em,
  }],
  index: 1,
  ...extra,
});
const EM_GOOD = {
  LicenseShortName: { value: "CC BY-SA 4.0" },
  LicenseUrl: { value: "//creativecommons.org/licenses/by-sa/4.0/" },
  Artist: { value: "<a href='#'>Jane Diver</a>" },
};

function makeFetch({ commonsPages }) {
  return async (url) => {
    if (url.startsWith("https://api.obis.org/v3/taxon/")) {
      const name = decodeURIComponent(url.split("/taxon/")[1]).toLowerCase();
      if (!(name in OBIS)) throw new Error("unexpected OBIS query: " + name);
      return OBIS[name];
    }
    if (url.includes("wbsearchentities")) return WD_SEARCH;
    if (url.includes("Special:EntityData/")) {
      const id = url.split("EntityData/")[1].split(".json")[0];
      return WD_ENTITIES[id];
    }
    if (url.startsWith("https://commons.wikimedia.org/")) {
      return commonsPages ? { query: { pages: commonsPages } } : {};
    }
    throw new Error("unexpected url: " + url);
  };
}

let passed = 0, failed = 0;
const t = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("ok - " + name); })
    .catch((e) => { failed++; console.log("FAIL - " + name + ": " + e.message); });

await t("no taxon: empty OBIS results -> no match, no candidates", async () => {
  const r = await resolveTaxonExact("ghostfish x", ALIASES, makeFetch({}));
  assert.equal(r.taxon, null);
  assert.deepEqual(r.candidates, []);
});

await t("ambiguous common query: first result is NOT treated as a match", async () => {
  const r = await resolveTaxonExact("dolphin", ALIASES, makeFetch({}));
  assert.equal(r.taxon, null);
  assert.ok(r.candidates.includes("Delphinus delphis"), "candidates offered for disambiguation");
});

await t("curated alias resolves to exact scientific name", async () => {
  const r = await resolveTaxonExact("whale shark", ALIASES, makeFetch({}));
  assert.equal(r.taxon.scientificName, "Rhincodon typus");
  assert.equal(r.via, "alias");
});

await t("missing image: Commons returns nothing -> photo withheld", async () => {
  const r = await speciesPhoto("Rhincodon typus", makeFetch({ commonsPages: null }));
  assert.equal(r.photo, null);
  assert.equal(r.reason, "no-licensed-depiction");
});

await t("unsupported license / missing credit -> photo withheld", async () => {
  const nc = img({ LicenseShortName: { value: "CC BY-NC 4.0" }, Artist: { value: "J" } });
  const noMeta = img({});
  const noArtist = img({ LicenseShortName: { value: "CC BY 4.0" } });
  const r = await speciesPhoto("Rhincodon typus", makeFetch({ commonsPages: { a: nc, b: noMeta, c: noArtist } }));
  assert.equal(r.photo, null);
  assert.equal(r.reason, "no-licensed-depiction");
});

await t("placeholder artist strings (null/unknown) -> photo withheld", async () => {
  const nullArtist = img({ LicenseShortName: { value: "CC BY 4.0" }, Artist: { value: "null" } });
  const unknownArtist = img({ LicenseShortName: { value: "Public domain" }, Artist: { value: "Unknown" } });
  const r = await speciesPhoto("Rhincodon typus", makeFetch({ commonsPages: { a: nullArtist, b: unknownArtist } }));
  assert.equal(r.photo, null);
});

await t("supported photo: identity via Wikidata P225 + license + credit + page kept", async () => {
  const bad = img({ LicenseShortName: { value: "CC BY-NC-SA 4.0" }, Artist: { value: "X" } }, { index: 1 });
  const good = img(EM_GOOD, { index: 2 });
  const r = await speciesPhoto("Rhincodon typus", makeFetch({ commonsPages: { bad, good } }));
  assert.ok(r.photo, "photo accepted");
  assert.equal(r.photo.qid, "Q200", "identity matched the entity whose P225 equals the OBIS name, not the first search hit");
  assert.equal(r.photo.license, "CC BY-SA 4.0");
  assert.equal(r.photo.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(r.photo.artist, "Jane Diver");
  assert.equal(r.photo.page, "https://commons.wikimedia.org/wiki/File:X.jpg");
  assert.ok(r.qualification.includes("Q200"));
});

await t("license allowlist shape", () => {
  for (const ok of ["CC BY-SA 4.0", "CC BY 3.0", "CC0", "Public domain", "CC BY-SA 2.0 Generic"]) {
    assert.ok(ACCEPTED_LICENSE.test(ok), ok + " accepted");
  }
  for (const no of ["CC BY-NC 4.0", "CC BY-ND 2.0", "", "GNU FDL", "see file page"]) {
    assert.ok(!ACCEPTED_LICENSE.test(no), (no || "(empty)") + " rejected");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

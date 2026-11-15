// Species identity resolution and identity-verified, license-checked photos.
// Identity authority is OBIS; a photo is shown only when Wikimedia Commons
// structured data states the file depicts the exact same scientific name
// (via the Wikidata taxon whose P225 taxon name equals the OBIS name) AND
// the file carries a supported open license, an artist credit and a file page.

const OBIS = "https://api.obis.org/v3";
const WIKIDATA = "https://www.wikidata.org";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

// Licenses we are willing to display as "openly licensed". Anything else
// (non-commercial, no-derivatives, missing, unparseable) means no photo.
export const ACCEPTED_LICENSE = /^(public domain|cc0|cc by-sa|cc by)(\s|$)/i;

const strip = (x) =>
  (x ?? "").replace(/<[^>]*>/g, "").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();

// Resolve a user-typed name to an exact OBIS taxon.
// - A curated alias maps common names we have verified to one scientific name.
// - Otherwise the query must match a returned scientificName exactly
//   (case-insensitive). A first-result guess is never treated as a match.
// Returns { taxon, via } or { taxon: null, candidates } for disambiguation.
export async function resolveTaxonExact(name, aliases, fetchJson) {
  const raw = name.trim();
  const alias = aliases[raw.toLowerCase()] ?? null;
  const target = alias ?? raw;
  const data = await fetchJson(`${OBIS}/taxon/${encodeURIComponent(target)}`);
  const results = data.results ?? [];
  const exact = results.find(
    (r) => r.scientificName?.toLowerCase() === target.toLowerCase()
  );
  if (exact) return { taxon: exact, via: alias ? "alias" : "exact" };
  return {
    taxon: null,
    candidates: results.map((r) => r.scientificName).filter(Boolean).slice(0, 3),
  };
}

// Find the Wikidata item whose taxon name (P225) equals the OBIS scientific
// name exactly. Returns the QID or null.
async function wikidataTaxonQid(sci, fetchJson) {
  const search = await fetchJson(
    `${WIKIDATA}/w/api.php?action=wbsearchentities&search=${encodeURIComponent(sci)}&language=en&type=item&limit=4&format=json`
  );
  for (const e of (search.search ?? []).slice(0, 3)) {
    const ent = await fetchJson(`${WIKIDATA}/wiki/Special:EntityData/${e.id}.json`);
    const claims = ent.entities?.[e.id]?.claims?.P225 ?? [];
    const hit = claims.some(
      (cl) => cl.mainsnak?.datavalue?.value?.toLowerCase() === sci.toLowerCase()
    );
    if (hit) return e.id;
  }
  return null;
}

// Identity-verified, license-checked photo for a resolved scientific name.
// photo is null unless every check passes; reason says which check failed.
export async function speciesPhoto(sci, fetchJson) {
  const qid = await wikidataTaxonQid(sci, fetchJson);
  if (!qid) {
    return {
      taxon: sci,
      photo: null,
      reason: "no-wikidata-taxon",
      qualification:
        "No Wikidata entry with this exact taxon name, so no identity-verified photo is shown; the records stand on their own.",
    };
  }
  const cUrl = `${COMMONS}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent("haswbstatement:P180=" + qid)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=420`;
  const data = await fetchJson(cUrl);
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 9) - (b.index ?? 9)
  );
  let illusOk = null;
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime ?? "")) continue;
    const em = ii.extmetadata ?? {};
    const license = strip(em.LicenseShortName?.value);
    const artist = strip(em.Artist?.value);
    const page = ii.descriptionurl ?? null;
      const titleText = (p.title || "") + " " + strip(em.ImageDescription?.value || "") + " " + strip(em.Categories?.value || "");
      if (/market|dead|caught|catch of|fishery|fisheries|fish stall|landing|auction|meat|dried|\bsale\b|slaughter|harvest/i.test(titleText)) continue;
    let licenseUrl = em.LicenseUrl?.value ?? null;
    if (licenseUrl?.startsWith("//")) licenseUrl = "https:" + licenseUrl;
    if (!ACCEPTED_LICENSE.test(license)) continue;
    if (!artist || /^(null|unknown|n\/?a)$/i.test(artist) || !page) continue;
      if (/illustration|drawing|diagram|sketch|painting|vision/i.test(titleText)) { if (!illusOk) illusOk = { thumb: ii.thumburl ?? ii.url, page, license, licenseUrl, artist, qid }; continue; }
    return {
      taxon: sci,
      photo: {
        thumb: ii.thumburl ?? ii.url,
        page,
        license,
        licenseUrl,
        artist,
        qid,
      },
      source: cUrl,
      qualification: `Openly licensed photo from Wikimedia Commons whose structured data states it depicts this exact species (Wikidata ${qid}, taxon name matches the OBIS scientific name). Illustrative image, not a photo from a reported record.`,
    };
  }
  if (illusOk) { return { taxon: sci, photo: illusOk, source: cUrl, qualification: `Openly licensed illustration from Wikimedia Commons whose structured data states it depicts this exact species (Wikidata ${qid}, taxon name matches the OBIS scientific name). Illustrative image, not a photo from a reported record.` } };
  return {
    taxon: sci,
    photo: null,
    reason: "no-licensed-depiction",
    source: cUrl,
    qualification:
      "No Wikimedia Commons image with a verified depicts-statement, a supported open license, and suitable subject matter (a living animal), so no photo is shown; the records stand on their own.",
  };
}

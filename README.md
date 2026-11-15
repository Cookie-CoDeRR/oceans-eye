# Ocean's Eye

One map for public ocean data: recorded marine-life observations, environmental
gridded layers, plain-language questions, and clean data endpoints.

Built for the 2026 NASA Space Apps Challenge (Pune local event), challenge:
"Be An Earth System Trend Detective!"

## The idea

Ocean data is scattered across datasets that expect you to know their keywords.
Ocean's Eye puts public marine data on one map and lets people ask in plain
language instead:

- A curious person asks "where have whale sharks been observed?"
- A researcher taps any point of ocean and sees how its temperature has
  changed since 2003, with the seasonal cycle removed and the trend's
  statistical significance stated honestly.
- A developer pulls the same layers through clean, documented endpoints
  (`/api/*`) instead of learning OBIS and ERDDAP query syntax.

## Run it

Requires Node 18+ (developed on Node 22). No npm dependencies and no build step. The public data sources need no API keys. The optional AI assistant needs its own model credential (see below).

```
node server.mjs
# open http://127.0.0.1:8741
```

Optional: `PORT=9000 node server.mjs`

Tests: `node --test test/*.test.mjs`

The app calls live public services (OBIS, NOAA ERDDAP, Open-Meteo, Wikimedia). If one is unreachable, the matching panel shows an error or empty result. At the time of writing, NOAA ERDDAP was intermittently unreachable, which affects the SST layer and trend.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/species/grid?name=<name>[&precision=3]` | Gridded OBIS observation-record counts as GeoJSON |
| `/api/species/points?name=<name>&bbox=lonMin,latMin,lonMax,latMax[&size=500]` | Raw OBIS records in a bbox |
| `/api/sst/field?bbox=latMin,latMax,lonMin,lonMax[&date=YYYY-MM-DD][&stride=24]` | NASA MUR SST field cells |
| `/api/sst/series?lat=<>&lon=<>` | Monthly-sampled SST series 2003-present |
| `/api/trend?lat=<>&lon=<>` | Series + deseasonalized trend, uncertainty, Mann-Kendall z |
| `/api/cell?lat=<>&lon=<>` | Per-cell briefing: current SST, waves/current, weather (model output) |
| `/api/species/series?name=<>` | OBIS reported records per year (reporting effort, not abundance) |
| `/api/species/photo?name=<>` | Species photo only when an exact taxon match and a licensed, credited Wikimedia Commons image are found |
| `/api/waves/field?...` | Open-Meteo marine wave field (model output) |
| `POST /api/ask` | Optional AI assistant (see below); `GET` reports whether it is configured |

Every payload includes `source` with the exact upstream URL, so consumers can
verify against the original dataset.

## Data sources and what they can and cannot say

- **OBIS** (obis.org): presence-only observation records with strong sampling
  bias. A cell with records means "observed and reported here", never
  "abundant here"; an empty cell means "no records", never "no life here".
- **NASA JPL MUR SST** (GHRSST L4 MUR v4.1, via NOAA CoastWatch ERDDAP):
  Level-4 satellite SST analysis grid. It is an analysis product, not a
  direct thermometer record at each cell.
- **OBIS statistics API**: reported occurrence records per year. Counts reflect
  reporting effort as much as animals; never presented as abundance, stock
  assessments, or fishing forecasts.
- **INCOIS PFZ Advisory** (linked, not mirrored): India's official Potential
  Fishing Zone advisories are produced by INCOIS (Ministry of Earth Sciences).
  The fisherman view links to the official service; Ocean's Eye does not
  compute or republish fishing zones.
- **Open-Meteo marine + forecast APIs** (CC BY 4.0): wave height/period/
  direction, ocean current, wind, pressure, precipitation. Numerical-model
  output, not buoy or station observations, and not a safety forecast or
  navigation aid. The valid model time and the actual sampled grid point are
  shown with each value. Direction conventions follow the source docs: wave
  and wind directions are where the flow comes FROM; ocean-current direction
  is where it heads TO. Open-Meteo's free API is licensed for non-commercial
  use (with daily/hourly rate caps); commercial use needs their paid plan -
  see https://open-meteo.com/en/terms.
- **Trend method**: monthly climatology removed, least-squares slope with
  classical standard error, Mann-Kendall z (no tie correction). Monthly
  anomalies remain autocorrelated (lag-1 reported in each response), so
  significance is indicative, not proof. Species-temperature overlap shown by
  the app is a starting question, not evidence of cause.

## Use of Super Intelligence (SI) disclosure

This project was built with AI assistance (code generation and drafting).
Per the Space Apps SI rules: the project idea - one map over public marine
gridded data with plain-language access and clean endpoints - originated with
the team; AI tools were used to accelerate implementation. AI-generated code
is acknowledged here and in source-file headers. Any AI-generated artwork
used with this project is watermarked/marked as AI-generated.

## AI assistant (optional)

`/api/ask` is an LLM assistant that can call the same public-data routes as tools.
It runs only on the server and is off unless configured with environment
variables: `OE_AI_KEY` (required to enable it), `OE_AI_BASE_URL` (any
OpenAI-compatible chat-completions API; default OpenRouter) and `OE_AI_MODEL`.
No key is stored in this repository or sent to the browser. The assistant is
told to ground answers in tool results and to cite the dataset and valid time,
but it is a language model and can make mistakes. Without a key the app falls
back to the keyword helper. Rounds, tokens and daily questions are capped.

## Limits

- Prototype as of 15 Nov 2026, not a scientific, safety, navigation or fishing tool.
- OBIS shows reported records, which reflect survey effort, not abundance.
- Wave, current and wind values are model output, not station observations.
- Trend significance is indicative only.
- This repository contains the source only. The hosted demo is not part of it.

## Basemap

OpenStreetMap contributors (raster tiles, darkened via CSS for readability).

## Interface

A chat-style panel answers keyword-parsed questions and shows map
taps as compact trend + current-conditions cards; sources and method sit
behind a collapsed details line on each card. A role selector (researcher /
student / fisherman) adjusts wording and suggested questions only - facts,
numbers and caveats are identical in every role. The role is a preference,
not sign-in or a verified profession.

## Layout

ORCA (the user's earlier project, github.com/Cookie-CoDeRR/ORCA) was used as
a visual reference for the information architecture: map-first canvas, top
bar with search and role selector, layers popover at top-left, and the chat
panel as a collapsible right-edge drawer. No ORCA code or assets were reused.

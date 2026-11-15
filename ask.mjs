// Ocean's Eye AI assistant endpoint (/api/ask) - provider-agnostic.
// Talks to any OpenAI-compatible chat-completions API (base URL, key and
// model from server env vars; nothing in the repo or the browser). The
// model can call the same public-data routes the map uses as tools, and
// must answer only from tool results. Hard bounds: max tool-call rounds
// per question, max tokens per call, per-session and per-day question
// caps. When no key is configured the endpoint says so and the browser
// stays on the keyword helper.

import { formatUpstreamError } from "./fetch-upstream.mjs";

const MAX_TOOL_ROUNDS = 4;       // hard cap on provider calls per question (1 + up to 3 tool rounds)
const MAX_TOKENS_PER_CALL = 700; // hard cap on completion tokens per provider call
const SESSION_QUESTION_CAP = 30; // per browser session
const DAILY_QUESTION_CAP = 100;  // per server, all sessions
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 200;
const TOOL_RESULT_CHARS = 1500;  // bound tool output fed back to the model

export const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_cell_conditions",
      description:
        "Latest wave height/period/direction and surface current for one ocean point (Open-Meteo marine model output, not a buoy observation).",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "latitude, -90..90" },
          lon: { type: "number", description: "longitude, -180..180" },
        },
        required: ["lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sst_trend",
      description:
        "Sea surface temperature series and deseasonalized trend for one ocean point (NASA JPL MUR via NOAA ERDDAP; can be unavailable - check the error field).",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
        },
        required: ["lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_species_records",
      description:
        "Reported occurrence records of a marine species in a bounding box (OBIS). Reported records show where life was reported, never abundance; no records does not mean absence.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "common or scientific name" },
          bbox: { type: "string", description: "lonMin,latMin,lonMax,latMax" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_species_records_global",
      description: "Gridded global count of reported occurrence records for a species (OBIS), used for maps.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
];

const TOOL_ROUTES = {
  get_cell_conditions: (a) => ["/api/cell", { lat: a.lat, lon: a.lon }],
  get_sst_trend: (a) => ["/api/trend", { lat: a.lat, lon: a.lon }],
  get_species_records: (a) => ["/api/species/points", { name: a.name, bbox: a.bbox, size: 1 }],
  get_species_records_global: (a) => ["/api/species/grid", { name: a.name }],
};

function toolAction(name, a) {
  if (name === "get_cell_conditions" || name === "get_sst_trend")
    return { type: "flyTo", lat: Number(a.lat), lon: Number(a.lon), zoom: 7 };
  return { type: "species", name: a.name };
}

function systemPrompt(role) {
  const roles = {
    researcher: "The user is a researcher: give full numbers, method and caveats up front.",
    student: "The user is a student: use plain words and briefly explain technical terms.",
    fisherman: "The user is a fisherman: be practical and brief; add a safety note that model output is not for navigation.",
  };
  return (
    "You are the Ocean's Eye assistant inside a public ocean-data map. Answer ONLY from the tool results in this conversation.\n" +
    "Rules:\n" +
    "- Never invent numbers, dates, records or sources. If a tool returns an error field, say the data is unavailable and why; never estimate around it.\n" +
    "- Never state biological facts (lifespan, size, behavior, diet): the tools only return observation records and ocean data. If the user asks for biology, say the record data does not include it.\n" +
    "- If a name is a nickname or could match several species, say which scientific name the tool matched and that nicknames are ambiguous; never present a nickname match as certain.\n" +
    "- When citing wind, pressure or precipitation, name the weather dataset; when citing waves, currents or SST, name the marine dataset. Do not attribute one to the other.\n" +
    "- Write plain text only: no markdown, no asterisks, no # headings. Use short labeled sentences.\n" +
    "- Every quantitative answer names the dataset and its valid time or sample range, exactly as the tool reports it.\n" +
    "- Species records are reported occurrences from OBIS: they show where life was reported, never abundance; no records is not absence.\n" +
    "- Wave direction is where waves come FROM; current direction is where it flows TO. Model output is not a buoy observation.\n" +
    "- Structure the answer as short labeled sections, one per line; use a '- ' bullet line for each item when listing several records, species or numbers. Keep it under 8 lines plus a short source line. Plain text, no markdown headings.\n" +
    "- When the question names a place or region, state that region and its bounds in the first sentence. When the map shows records for a wider area than the answer, say so explicitly.\n" +
    (roles[role] || roles.researcher)
  );
}

function collectSources(results) {
  const urls = [];
  for (const r of results) {
    try {
      const body = JSON.parse(r.content);
      const walk = (o) => {
        if (!o || typeof o !== "object") return;
        if (typeof o.source === "string" && o.source.startsWith("http") && !urls.includes(o.source)) urls.push(o.source);
        for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
      };
      walk(body);
    } catch {}
  }
  return urls.slice(0, 6);
}

export function createAskHandler({ routes, baseUrl, apiKey, model, fetchImpl = fetch, maxToolRounds = MAX_TOOL_ROUNDS, maxTokens = MAX_TOKENS_PER_CALL, sessionCap = SESSION_QUESTION_CAP, dailyCap = DAILY_QUESTION_CAP }) {
  const sessions = new Map(); // sessionId -> { t, questions, messages: [{role, content}] }
  let daily = { day: "", n: 0 };

  async function callProvider(messages) {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        tools: AI_TOOLS,
        tool_choice: "auto",
        max_tokens: maxTokens,
        temperature: 0.2,
        // data policy approved by user for this app (free tier may train on prompts) data,
        // and require full tool-parameter support (no silent tool dropping)
        provider: { require_parameters: true },
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw Object.assign(new Error(`AI provider error (${res.status})`), { status: 502, expose: true });
    return body;
  }

  return async function ask({ question, sessionId, role }) {
    if (!apiKey)
      return [503, { error: "ai_not_configured", message: "AI is not configured on this server; the keyword helper is active." }];

    const today = new Date().toISOString().slice(0, 10);
    if (daily.day !== today) daily = { day: today, n: 0 };
    if (daily.n >= dailyCap)
      return [429, { error: "daily_cap", message: `Daily AI question limit (${dailyCap}) reached; the keyword helper still works.` }];

    const sid = String(sessionId || "").slice(0, 64) || "anon";
    let s = sessions.get(sid);
    if (!s || Date.now() - s.t > SESSION_TTL_MS) {
      s = { t: Date.now(), questions: 0, messages: [] };
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      sessions.set(sid, s);
    }
    s.t = Date.now();
    if (s.questions >= sessionCap)
      return [429, { error: "session_cap", message: `Session AI question limit (${sessionCap}) reached; the keyword helper still works.` }];

    s.questions += 1;
    daily.n += 1;

    const messages = [{ role: "system", content: systemPrompt(role) }, ...s.messages, { role: "user", content: String(question).slice(0, 1000) }];
    const actions = [];
    const toolResults = [];
    try {
      for (let round = 0; round < maxToolRounds; round++) {
        const out = await callProvider(messages);
        const msg = out?.choices?.[0]?.message;
        if (!msg) throw Object.assign(new Error("AI provider returned no message"), { status: 502, expose: true });
        messages.push(msg);
        const calls = msg.tool_calls || [];
        if (!calls.length) {
          const answer = String(msg.content || "").trim();
          if (!answer) throw Object.assign(new Error("AI provider returned an empty answer"), { status: 502, expose: true });
          s.messages.push({ role: "user", content: String(question).slice(0, 1000) }, { role: "assistant", content: answer });
          s.messages = s.messages.slice(-20);
          return [200, { answer, actions, sources: collectSources(toolResults), rounds: round + 1 }];
        }
        for (const c of calls.slice(0, 3)) {
          const name = c?.function?.name;
          const routeFn = TOOL_ROUTES[name];
          let content;
          if (!routeFn || !routes) {
            content = JSON.stringify({ error: "unknown tool" });
          } else {
            let args = {};
            try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
            const [path, params] = routeFn(args);
            const q = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
            const [code, body] = await routes[path](q);
            content = JSON.stringify(code === 200 ? body : { error: body?.error || `route returned ${code}` }).slice(0, TOOL_RESULT_CHARS);
            actions.push(toolAction(name, args));
          }
          const tr = { role: "tool", tool_call_id: c.id, content };
          toolResults.push(tr);
          messages.push(tr);
        }
      }
      return [200, { answer: "I gathered data but could not finish summarizing it within the step limit - try a narrower question.", actions, sources: collectSources(toolResults), rounds: maxToolRounds }];
    } catch (e) {
      const status = e.status && e.expose ? e.status : 502;
      return [status, { error: formatUpstreamError(e), message: formatUpstreamError(e) + " - the keyword helper still works." }];
    }
  };
}

// Ocean's Eye /api/ask handler checks (node test/ask.test.mjs). No dependencies.
import { createAskHandler } from "../src/ask.mjs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("ok -", name); }
  else { fail++; console.log("FAIL -", name); }
}

const routes = {
  "/api/cell": async (q) => [200, { lat: 15.5, lon: 68.5, sections: { marine: { values: { waveHeightM: 0.98 }, source: "https://marine-api.open-meteo.com/v1/marine?x", validTime: "2026-11-15T12:45" } } }],
};

function fakeFetch(script) {
  let i = 0;
  return async () => {
    const step = script[Math.min(i++, script.length - 1)];
    return { ok: step.ok !== false, status: step.status || 200, json: async () => step.body };
  };
}
const toolCall = (id, name, args) => ({ choices: [{ message: { role: "assistant", tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }] });
const finalAnswer = (t) => ({ choices: [{ message: { role: "assistant", content: t } }] });

// 1. No key configured -> honest 503, frontend stays on the keyword helper.
{
  const ask = createAskHandler({ routes, baseUrl: "https://x", apiKey: "", model: "m" });
  const [code, body] = await ask({ question: "hi", sessionId: "s1" });
  check("no key -> 503 ai_not_configured", code === 503 && body.error === "ai_not_configured");
}

// 2. Tool round trip: model calls get_cell_conditions, result is fed back, final answer returned with action + source.
{
  const ask = createAskHandler({
    routes, baseUrl: "https://x", apiKey: "k", model: "m",
    fetchImpl: fakeFetch([{ body: toolCall("c1", "get_cell_conditions", { lat: 15.5, lon: 68.5 }) }, { body: finalAnswer("Waves are 0.98 m per Open-Meteo marine model, valid 2026-11-15T12:45 UTC.") }]),
  });
  const [code, body] = await ask({ question: "sea state near 15.5,68.5?", sessionId: "s2", role: "fisherman" });
  check("tool round trip -> 200 with answer", code === 200 && body.answer.includes("0.98"));
  check("flyTo action from cell tool", body.actions.some((a) => a.type === "flyTo" && a.lat === 15.5));
  check("tool source URL surfaced", body.sources.includes("https://marine-api.open-meteo.com/v1/marine?x"));
  check("rounds counted (2 provider calls)", body.rounds === 2);
  // follow-up keeps session memory
  const [c2, b2] = await ask({ question: "and tomorrow?", sessionId: "s2" });
  check("second question same session ok", c2 === 200 && b2.answer.length > 0);
}

// 3. Provider HTTP failure -> 502 with the provider status, not a crash.
{
  const ask = createAskHandler({ routes, baseUrl: "https://x", apiKey: "k", model: "m", fetchImpl: fakeFetch([{ ok: false, status: 429, body: {} }]) });
  const [code, body] = await ask({ question: "q", sessionId: "s3" });
  check("provider 429 -> 502 honest error", code === 502 && /429/.test(body.error));
}

// 4. Hard tool-round cap: model that never stops calling tools gets the step-limit answer.
{
  const ask = createAskHandler({
    routes, baseUrl: "https://x", apiKey: "k", model: "m", maxToolRounds: 2,
    fetchImpl: fakeFetch([{ body: toolCall("c1", "get_cell_conditions", { lat: 1, lon: 2 }) }]),
  });
  const [code, body] = await ask({ question: "q", sessionId: "s4" });
  check("round cap -> step-limit message", code === 200 && /step limit/.test(body.answer));
}

// 5. Daily cap enforced.
{
  const ask = createAskHandler({ routes, baseUrl: "https://x", apiKey: "k", model: "m", dailyCap: 1, fetchImpl: fakeFetch([{ body: finalAnswer("a") }]) });
  await ask({ question: "q1", sessionId: "s5" });
  const [code, body] = await ask({ question: "q2", sessionId: "s6" });
  check("daily cap -> 429", code === 429 && body.error === "daily_cap");
}

// 6. Session cap enforced.
{
  const ask = createAskHandler({ routes, baseUrl: "https://x", apiKey: "k", model: "m", sessionCap: 1, fetchImpl: fakeFetch([{ body: finalAnswer("a") }]) });
  await ask({ question: "q1", sessionId: "s7" });
  const [code, body] = await ask({ question: "q2", sessionId: "s7" });
  check("session cap -> 429", code === 429 && body.error === "session_cap");
}

console.log(fail ? `${fail} FAIL` : `all ${pass} checks passed`);
process.exit(fail ? 1 : 0);

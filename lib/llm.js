// One place for the app's text AI. Uses Claude (Anthropic) when ANTHROPIC_API_KEY is set, otherwise OpenAI.
// Audio (the natural "Listen" voice and speech-to-text) stays on OpenAI: Claude doesn't produce or transcribe audio.
// Env: ANTHROPIC_API_KEY, CLAUDE_FAST_MODEL (default claude-haiku-4-5-20251001), CLAUDE_SMART_MODEL (default claude-sonnet-4-6),
//      OPENAI_API_KEY, OPENAI_TEXT_MODEL (default gpt-4o-mini).
"use strict";
const FAST = () => process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5-20251001";
const SMART = () => process.env.CLAUDE_SMART_MODEL || "claude-sonnet-4-6";
const available = () => !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
const provider = () => process.env.ANTHROPIC_API_KEY ? "claude" : process.env.OPENAI_API_KEY ? "openai" : null;

function extractJSON(t) {
  t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("AI reply was not JSON");
}

// opts: {system, user, json:boolean, maxTokens, temperature, tier:"fast"|"smart", timeoutMs}
async function complete(opts) {
  const { system, user, json = false, maxTokens = 600, temperature = 0.5, tier = "fast", timeoutMs = 30000 } = opts;
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: tier === "smart" ? SMART() : FAST(), max_tokens: maxTokens, temperature,
        system: system + (json ? "\n\nRespond with a single valid JSON object only: no prose, no code fences." : ""),
        messages: [{ role: "user", content: user }] })
    });
    if (!r.ok) { const e = new Error("claude " + r.status + " " + (await r.text()).slice(0, 300)); e.status = r.status; throw e; }
    const j = await r.json();
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    return json ? extractJSON(text) : text;
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini", temperature, max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: system + (json ? "\nRespond with JSON only." : "") }, { role: "user", content: user }] })
    });
    if (!r.ok) { const e = new Error("openai " + r.status + " " + (await r.text()).slice(0, 300)); e.status = r.status; throw e; }
    const text = String(((await r.json()).choices[0].message.content) || "").trim();
    return json ? extractJSON(text) : text;
  }
  throw new Error("no AI key configured");
}

// Turn a failure into a short reason people (and the owner) can act on. Never includes the key.
function reason(err) {
  const m = String((err && err.message) || err || "");
  if (/abort|timeout/i.test((err && err.name) || "") || /aborted|timed? ?out/i.test(m)) return { code: "ai-slow", text: "The AI took too long to answer." };
  if (/credit balance|billing|quota|insufficient/i.test(m)) return { code: "ai-credit", text: "The AI account is out of credit." };
  if (/ 401 | 403 |invalid x-api-key|authentication/i.test(m)) return { code: "ai-key", text: "The AI key isn't accepted." };
  if (/ 404 |not_found|model/i.test(m) && /claude|openai/.test(m)) return { code: "ai-model", text: "The AI model name isn't available." };
  if (/ 429 |rate/i.test(m)) return { code: "ai-busy", text: "The AI is rate-limited right now." };
  if (/ 5\d\d |overloaded/i.test(m)) return { code: "ai-down", text: "The AI service is busy." };
  if (/not JSON/i.test(m)) return { code: "ai-format", text: "The AI answer came back garbled." };
  if (/no AI key/i.test(m)) return { code: "ai-none", text: "No AI key is set up." };
  return { code: "error", text: "" };
}

// Try the preferred tier; if it fails for a reason another model could fix (slow, missing model, busy), try the fast tier once.
async function completeWithFallback(opts, budgetMs) {
  const t0 = Date.now();
  try { return await complete(opts); }
  catch (e) {
    const r = reason(e).code, left = budgetMs - (Date.now() - t0);
    if (opts.tier !== "smart" || !["ai-slow", "ai-model", "ai-down", "ai-busy", "ai-format"].includes(r) || left < 8000) throw e;
    return complete(Object.assign({}, opts, { tier: "fast", timeoutMs: Math.min(left - 1000, 20000) }));
  }
}

module.exports = { complete, completeWithFallback, available, provider, extractJSON, reason, models: () => ({ fast: FAST(), smart: SMART() }) };

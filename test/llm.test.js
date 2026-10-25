// Claude is used for text when ANTHROPIC_API_KEY is set; OpenAI stays for audio.
const test = require("node:test");
const assert = require("node:assert");
const sent = [];
global.fetch = async (url, opts = {}) => {
  url = String(url); sent.push({ url, opts });
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (url === "https://api.anthropic.com/v1/messages") {
    const b = JSON.parse(opts.body);
    if (b.model === "claude-missing") return J({ type: "error", error: { type: "not_found_error", message: "model: claude-missing" } }, 404);
    if (b.model === "claude-broke") return J({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, 400);
    const wantsJson = /single valid JSON object/.test(b.system);
    return J({ content: [{ type: "text", text: wantsJson ? "```json\n{\"audience\":\"Kids\",\"region\":\"near\",\"summary\":\"Kids near Zurich\"}\n```" : "Lunik at Kammgarn in Schaffhausen on Saturday evening: dreamy Swiss indie-pop in a small hall, tickets from thirty-eight francs." }] });
  }
  if (url.includes("/rest/v1/events")) return J([{ data: { title: "Lunik", start: "2030-11-14T20:00", timeKnown: true, venue: "Kammgarn", city: "Schaffhausen", priceFromCHF: 38 } }]);
  if (url.includes("/auth/v1/user")) return J({}, 200);
  if (url.includes("openai.com")) throw new Error("OpenAI must not be called for text when Claude is configured");
  throw new Error("unexpected " + url);
};
const LLM = require("../lib/llm");
function call(fn, { method = "GET", query = {}, body, headers = {} } = {}) {
  return new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); }, json(o) { this.send(JSON.stringify(o)); } }; fn({ method, query, body, headers }, res); });
}

test("provider: Claude preferred over OpenAI; none without keys", () => {
  delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
  assert.strictEqual(LLM.provider(), null);
  process.env.OPENAI_API_KEY = "sk"; assert.strictEqual(LLM.provider(), "openai");
  process.env.ANTHROPIC_API_KEY = "sk-ant"; assert.strictEqual(LLM.provider(), "claude");
  delete process.env.OPENAI_API_KEY;
});
test("Claude request: correct headers and model tiers; JSON in code fences is parsed", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const j = await LLM.complete({ system: "s", user: "u", json: true, tier: "smart" });
  assert.strictEqual(j.audience, "Kids");
  const req = sent.filter(x => x.url.includes("anthropic")).pop();
  assert.strictEqual(req.opts.headers["x-api-key"], "sk-ant-test"); assert.strictEqual(req.opts.headers["anthropic-version"], "2023-06-01");
  assert.match(JSON.parse(req.opts.body).model, /sonnet/);
  await LLM.complete({ system: "s", user: "u" }); assert.match(JSON.parse(sent.filter(x => x.url.includes("anthropic")).pop().opts.body).model, /haiku/);
  process.env.CLAUDE_FAST_MODEL = "claude-custom"; await LLM.complete({ system: "s", user: "u" }); assert.strictEqual(JSON.parse(sent.pop().opts.body).model, "claude-custom"); delete process.env.CLAUDE_FAST_MODEL;
});
test("extractJSON copes with prose around the JSON", () => {
  assert.deepStrictEqual(LLM.extractJSON('Here you go: {"a":1} hope it helps'), { a: 1 });
});
test("Listen with Claude only: AI-written script for the phone voice, cached briefly so adding a voice key takes effect", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test"; delete process.env.OPENAI_API_KEY;
  const r = await call(require("../api/voice"), { query: { id: "lunik-20301114", v: "x" } });
  const j = JSON.parse(r.body);
  assert.ok(j.fallback && /dreamy Swiss indie-pop/.test(j.script)); assert.match(r.headers["cache-control"], /s-maxage=3600/); assert.ok(!/immutable/.test(r.headers["cache-control"]));
});
test("voice search with Claude only: text works, recorded audio explains transcription isn't set up", async () => {
  const ask = require("../api/ask");
  const ok = await call(ask, { method: "POST", body: { text: "kids near zurich" }, headers: { authorization: "Bearer a.b.c" } });
  assert.strictEqual(ok.status, 200); assert.strictEqual(JSON.parse(ok.body).filters.region, "near");
  const audio = await call(ask, { method: "POST", body: { audio: "AAAA", mime: "audio/webm" }, headers: { authorization: "Bearer a.b.c" } });
  assert.strictEqual(audio.status, 501);
});

test("errors get a short, actionable reason", () => {
  assert.strictEqual(LLM.reason(new Error("claude 400 Your credit balance is too low")).code, "ai-credit");
  assert.strictEqual(LLM.reason(new Error("claude 401 invalid x-api-key")).code, "ai-key");
  assert.strictEqual(LLM.reason(Object.assign(new Error("This operation was aborted"), { name: "TimeoutError" })).code, "ai-slow");
  assert.strictEqual(LLM.reason(new Error("claude 404 model: x")).code, "ai-model");
});
test("smart model failure falls back to the fast model once", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant"; process.env.CLAUDE_SMART_MODEL = "claude-missing";
  const j = await LLM.completeWithFallback({ system: "s", user: "u", json: true, tier: "smart" }, 30000);
  assert.strictEqual(j.audience, "Kids"); assert.match(JSON.parse(sent.pop().opts.body).model, /haiku/);
  process.env.CLAUDE_SMART_MODEL = "claude-broke"; // out of credit: no point retrying
  await assert.rejects(LLM.completeWithFallback({ system: "s", user: "u", tier: "smart" }, 30000), /credit/);
  delete process.env.CLAUDE_SMART_MODEL;
});
test("plan health check reports each model without exposing the key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-secret"; process.env.CLAUDE_SMART_MODEL = "claude-broke";
  const plan = require("../api/plan");
  const r = await call(plan, { query: { action: "health" } });
  const j = JSON.parse(r.body);
  assert.strictEqual(j.provider, "claude"); assert.strictEqual(j.fast.ok, true); assert.strictEqual(j.smart.ok, false); assert.strictEqual(j.smart.code, "ai-credit");
  assert.ok(!r.body.includes("sk-ant-secret"));
  delete process.env.CLAUDE_SMART_MODEL;
});

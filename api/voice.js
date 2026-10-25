// Spoken summary of one event ("Listen" button).
// Script: written by Claude (ANTHROPIC_API_KEY) or OpenAI. Voice: with ELEVENLABS_API_KEY (or OPENAI_API_KEY) set, the script is read by a natural voice, returned as MP3 and cached at the
// edge for a year per event version (?v=), so each event is generated once. Without a key, or if generation fails,
// returns JSON {fallback:true, script} and the app reads the script with the phone's own voice.
const { templateScript, factsFor, SYSTEM } = require("../lib/voice");
const LLM = require("../lib/llm");

const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const TTS = require("../lib/tts"); // ElevenLabs (ELEVENLABS_API_KEY) or OpenAI (OPENAI_API_KEY)

async function loadEvent(id) {
  const r = await fetch(`${URL_}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(5000) });
  const rows = r.ok ? await r.json() : [];
  return rows.length ? Object.assign({}, rows[0].data, { id }) : null;
}
async function writeScript(e) { // Claude when ANTHROPIC_API_KEY is set, otherwise OpenAI (see lib/llm.js)
  const t = String(await LLM.complete({ system: SYSTEM, tier: "fast", maxTokens: 260, temperature: 0.6, timeoutMs: 15000,
    user: "Event facts (JSON):\n" + JSON.stringify(factsFor(e)) + "\n\nA plain version for reference:\n" + templateScript(e) })).replace(/\s+/g, " ").trim();
  if (t.length < 40) throw new Error("script too short");
  return t.slice(0, 900);
}
function json(res, status, body, cache) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.status(status).send(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const id = String(q.id || "");
  if (!/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id)) return json(res, 400, { error: "bad id" }, "no-store");
  let e;
  try { e = await loadEvent(id); } catch (err) { return json(res, 502, { error: "db" }, "no-store"); }
  if (!e) return json(res, 404, { error: "not found" }, "public, s-maxage=300");
  const key = TTS.ttsProvider(); // the natural voice itself (audio): ElevenLabs or OpenAI
  const fallback = (script, good) => json(res, 200, { fallback: true, script: script || templateScript(e) }, good ? "public, max-age=3600, s-maxage=31536000, immutable" : "public, max-age=60, s-maxage=300");
  if (!LLM.available()) return fallback();
  let script = null;
  try {
    script = await writeScript(e);
    if (q.format === "text") return json(res, 200, { script }, "public, s-maxage=86400");
    if (!key) return json(res, 200, { fallback: true, script }, "public, max-age=600, s-maxage=3600"); // AI script read by the phone's voice; short cache so a voice key takes effect soon
    const mp3 = await TTS.speak(script);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", mp3.length);
    // ?v= changes whenever the event changes, so a cached clip never goes stale.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.status(200).send(mp3);
  } catch (err) {
    console.warn("voice", id, err && err.message);
    return fallback(script, false);
  }
};

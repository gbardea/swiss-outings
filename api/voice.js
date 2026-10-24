// Spoken summary of one event ("Listen" button).
// With OPENAI_API_KEY set: an AI-written 20-second script read by a natural voice, returned as MP3 and cached at the
// edge for a year per event version (?v=), so each event is generated once. Without a key, or if generation fails,
// returns JSON {fallback:true, script} and the app reads the script with the phone's own voice.
const { templateScript, factsFor, SYSTEM } = require("../lib/voice");

const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const OPENAI = "https://api.openai.com/v1";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.VOICE_NAME || "coral";
const STYLE = "Warm, upbeat local radio presenter in Zurich. Friendly and natural, conversational pace, light smile in the voice. Pronounce Swiss place names the local way.";

async function loadEvent(id) {
  const r = await fetch(`${URL_}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(5000) });
  const rows = r.ok ? await r.json() : [];
  return rows.length ? Object.assign({}, rows[0].data, { id }) : null;
}
async function writeScript(e, key) {
  const r = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.6, max_tokens: 220, messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "Event facts (JSON):\n" + JSON.stringify(factsFor(e)) + "\n\nA plain version for reference:\n" + templateScript(e) }
    ] })
  });
  if (!r.ok) throw new Error("script " + r.status);
  const j = await r.json();
  const t = String(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").replace(/\s+/g, " ").trim();
  if (t.length < 40) throw new Error("script too short");
  return t.slice(0, 900);
}
async function speak(text, key) {
  const r = await fetch(`${OPENAI}/audio/speech`, {
    method: "POST", signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: VOICE, input: text, instructions: STYLE, response_format: "mp3" })
  });
  if (!r.ok) throw new Error("tts " + r.status);
  return Buffer.from(await r.arrayBuffer());
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
  const key = process.env.OPENAI_API_KEY;
  const fallback = () => json(res, 200, { fallback: true, script: templateScript(e) }, "public, max-age=60, s-maxage=300");
  if (!key) return fallback();
  try {
    const script = await writeScript(e, key);
    if (q.format === "text") return json(res, 200, { script }, "public, s-maxage=86400");
    const mp3 = await speak(script, key);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", mp3.length);
    // ?v= changes whenever the event changes, so a cached clip never goes stale.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.status(200).send(mp3);
  } catch (err) {
    console.warn("voice", id, err && err.message);
    return fallback();
  }
};

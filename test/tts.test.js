// ElevenLabs is preferred for audio when its key is set; OpenAI is the fallback.
const test = require("node:test");
const assert = require("node:assert");
const sent = [];
global.fetch = async (url, opts = {}) => {
  url = String(url); sent.push({ url, opts });
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) return new Response(Buffer.from("ID3fake"), { status: 200, headers: { "content-type": "audio/mpeg" } });
  if (url === "https://api.elevenlabs.io/v1/speech-to-text") return new Response(JSON.stringify({ text: "kids things this weekend" }), { status: 200 });
  if (url.startsWith("https://api.openai.com/")) return new Response(Buffer.from("ID3openai"), { status: 200 });
  throw new Error("unexpected " + url);
};
const TTS = require("../lib/tts");
test("ElevenLabs speaks with the configured voice and model, key in header", async () => {
  process.env.ELEVENLABS_API_KEY = "el-secret"; process.env.OPENAI_API_KEY = "sk";
  const mp3 = await TTS.speak("Hello Zurich");
  assert.strictEqual(mp3.toString(), "ID3fake");
  const c = sent.pop(); assert.match(c.url, /text-to-speech\/EXAVITQu4vr4xnSDxMaL\?output_format=mp3/);
  assert.strictEqual(c.opts.headers["xi-api-key"], "el-secret");
  assert.strictEqual(JSON.parse(c.opts.body).model_id, "eleven_multilingual_v2");
  assert.strictEqual(TTS.ttsProvider(), "elevenlabs");
});
test("ElevenLabs transcribes voice search", async () => {
  const t = await TTS.transcribe(Buffer.from("x"), "audio/webm");
  assert.strictEqual(t, "kids things this weekend");
});
test("falls back to OpenAI without an ElevenLabs key", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  assert.strictEqual(TTS.ttsProvider(), "openai");
  const mp3 = await TTS.speak("Hi"); assert.strictEqual(mp3.toString(), "ID3openai");
  delete process.env.OPENAI_API_KEY; assert.strictEqual(TTS.ttsProvider(), null);
});
test("voice health check reports the provider and a test clip, never the key", async () => {
  process.env.ELEVENLABS_API_KEY = "sk_secret123"; process.env.ANTHROPIC_API_KEY = "x";
  const voice = require("../api/voice");
  const r = await new Promise(resolve => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.c = c; return this; }, send(b) { resolve({ status: this.c, body: String(b) }); } }; voice({ query: { health: "1" } }, res); });
  const j = JSON.parse(r.body);
  assert.strictEqual(j.voice, "elevenlabs"); assert.strictEqual(j.test.ok, true); assert.ok(!r.body.includes("sk_secret123"));
  delete process.env.ELEVENLABS_API_KEY; delete process.env.ANTHROPIC_API_KEY;
});

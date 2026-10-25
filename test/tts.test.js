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

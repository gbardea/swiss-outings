// Audio: the "Listen" voice (text → speech) and voice search (speech → text).
// ElevenLabs is used when ELEVENLABS_API_KEY is set, otherwise OpenAI (OPENAI_API_KEY). Claude does the text work, not audio.
// Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (default "Sarah", a warm, clear presenter voice), ELEVENLABS_MODEL (default eleven_multilingual_v2,
//      good with Swiss place names), OPENAI_API_KEY, OPENAI_TTS_MODEL, VOICE_NAME, OPENAI_STT_MODEL.
"use strict";
const EL = "https://api.elevenlabs.io/v1", OA = "https://api.openai.com/v1";
const STYLE = "Warm, upbeat local radio presenter in Zurich. Friendly and natural, conversational pace, light smile in the voice. Pronounce Swiss place names the local way.";
const STT_HINT = "A family in Zurich asking for events: concerts, kids activities, carnivals, Chilbi, Fasnacht, Küsnacht, Meilen, Hallenstadion, ZSC Lions, FCZ.";

const ttsProvider = () => process.env.ELEVENLABS_API_KEY ? "elevenlabs" : process.env.OPENAI_API_KEY ? "openai" : null;
const sttProvider = ttsProvider;

async function speak(text) {
  if (process.env.ELEVENLABS_API_KEY) {
    const voice = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
    const r = await fetch(`${EL}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST", signal: AbortSignal.timeout(25000),
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } })
    });
    if (!r.ok) throw new Error("elevenlabs tts " + r.status + " " + (await r.text()).slice(0, 200));
    return Buffer.from(await r.arrayBuffer());
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch(`${OA}/audio/speech`, {
      method: "POST", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.VOICE_NAME || "coral", input: text, instructions: STYLE, response_format: "mp3" })
    });
    if (!r.ok) throw new Error("openai tts " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("no voice key");
}

async function transcribe(buf, mime) {
  if (buf.length > 3.5e6) throw new Error("audio too long");
  const ext = /mp4|m4a|aac/.test(mime || "") ? "m4a" : /ogg/.test(mime || "") ? "ogg" : /wav/.test(mime || "") ? "wav" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mime || "audio/webm" }), "speech." + ext);
  if (process.env.ELEVENLABS_API_KEY) {
    fd.append("model_id", "scribe_v1");
    const r = await fetch(`${EL}/speech-to-text`, { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, body: fd, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("elevenlabs stt " + r.status);
    return String((await r.json()).text || "").trim();
  }
  if (process.env.OPENAI_API_KEY) {
    fd.append("model", process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe");
    fd.append("prompt", STT_HINT);
    const r = await fetch(`${OA}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("stt " + r.status);
    return String((await r.json()).text || "").trim();
  }
  throw new Error("no voice key");
}

module.exports = { speak, transcribe, ttsProvider, sttProvider };

// Daily cron: pre-generates voice clips for the newest events so the first listener doesn't wait.
// Vercel calls this with "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
const { voiceVersion } = require("../lib/voice");
const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const SITE = process.env.SITE_URL || "https://www.swissoutings.com";
const MAX = 15;

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).send("unauthorized"); return; }
  if (!require("../lib/tts").ttsProvider()) { res.status(200).json({ skipped: "no ELEVENLABS_API_KEY or OPENAI_API_KEY" }); return; }
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`${URL_}/rest/v1/events?first_seen=gte.${since}&select=id,data&order=start_date.asc&limit=${MAX}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const rows = r.ok ? await r.json() : [];
  const done = [];
  for (let i = 0; i < rows.length; i += 4) {
    await Promise.all(rows.slice(i, i + 4).map(async row => {
      const e = Object.assign({}, row.data, { id: row.id });
      try { const x = await fetch(`${SITE}/api/voice?id=${encodeURIComponent(row.id)}&v=${voiceVersion(e)}`, { signal: AbortSignal.timeout(40000) }); await x.arrayBuffer(); done.push([row.id, x.status, x.headers.get("content-type")]); }
      catch (err) { done.push([row.id, "error"]); }
    }));
  }
  res.status(200).json({ warmed: done.length, done });
};

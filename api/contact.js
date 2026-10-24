// Emails a new contact message / venue suggestion to the owner via Resend.
// The message itself is already saved in the database (admin inbox) by the app before this is called,
// so if email isn't set up yet nothing is lost.
// Env: RESEND_API_KEY, CONTACT_TO (owner's address, never sent to the browser), CONTACT_FROM (e.g. "Swiss Outings <hello@swissoutings.com>").
const hits = new Map();
const esc = s => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = { venue: "Venue suggestion", bug: "Problem report", contact: "Message" };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= 5) { res.status(429).json({ error: "Too many messages" }); return; }
  hits.set(ip, list.concat(now));
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const body = String(b.body || "").trim().slice(0, 4000), name = String(b.name || "").trim().slice(0, 80);
  const email = String(b.email || "").trim().slice(0, 120), kind = LABEL[b.kind] ? b.kind : "contact";
  if (body.length < 2) { res.status(400).json({ error: "empty" }); return; }
  const key = process.env.RESEND_API_KEY, to = process.env.CONTACT_TO;
  if (!key || !to) { res.status(202).json({ stored: true, emailed: false }); return; }
  const validEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: process.env.CONTACT_FROM || "Swiss Outings <hello@swissoutings.com>", to: [to],
      reply_to: validEmail ? email : undefined,
      subject: `Swiss Outings · ${LABEL[kind]}${name ? " from " + name : ""}`,
      text: `${LABEL[kind]}${b.id ? " #" + b.id : ""}\nFrom: ${name || "(no name)"} <${email || "no email"}>\n\n${body}\n\nAll messages: https://www.swissoutings.com/admin.html#messages`,
      html: `<p><b>${esc(LABEL[kind])}</b>${b.id ? " #" + esc(b.id) : ""}<br>From: ${esc(name || "(no name)")} &lt;${esc(email || "no email")}&gt;</p><p style="white-space:pre-wrap">${esc(body)}</p><p><a href="https://www.swissoutings.com/admin.html#messages">Open the admin inbox</a></p>`
    })
  }).catch(() => null);
  res.status(200).json({ stored: true, emailed: !!(r && r.ok) });
};

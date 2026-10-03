// Reads a seller's ticket page and pulls out dates, prices and availability.
// Pure functions (no network) so they can be tested with saved HTML.

const STOP = new Set("the and for with von der die das und mit feat support tour live show konzert concert zurich zürich zuerich at in im am of a an la le el de".split(" "));

// Sellers that refuse automated requests. We never fetch these; the app shows the saved details instead.
const NO_LIVE = ["ticketcorner.ch", "ticketmaster.ch", "seetickets.com", "livenation.ch", "eventim.de", "starticket.ch"];

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(title) {
  // Use the part before a dash/bracket (the act's name), fall back to the whole title.
  const head = String(title || "").split(/\s[–—-]\s|\(|:|\s+(?:at|in|im)\s+/i)[0];
  let t = norm(head).split(" ").filter(w => w.length >= 3 && !STOP.has(w));
  if (!t.length) t = norm(title).split(" ").filter(w => w.length >= 3 && !STOP.has(w));
  if (!t.length) t = norm(title).split(" ").filter(Boolean);
  return t;
}
function titleMatches(candidate, title) {
  const hay = " " + norm(candidate) + " ";
  const tk = tokens(title);
  if (!tk.length) return false;
  const hit = tk.filter(w => hay.includes(" " + w + " ") || (w.length >= 5 && hay.includes(w))).length;
  return hit / tk.length >= 0.6;
}
function decode(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&ndash;|&mdash;/gi, "–")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return " "; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return " "; } });
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
function liveAllowed(u) { const h = hostOf(u); return !!h && !NO_LIVE.some(b => h === b || h.endsWith("." + b)); }

/* ---------- structured data (schema.org JSON-LD) ---------- */
function jsonLdEvents(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = n => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const t = [].concat(n["@type"] || []).map(String);
    if (t.some(x => /Event$/.test(x)) && (n.name || n.startDate)) out.push(n);
    if (n["@graph"]) walk(n["@graph"]);
    if (n.subEvent) walk(n.subEvent);
    if (n.itemListElement) walk([].concat(n.itemListElement).map(i => (i && i.item) || i));
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim())); } catch (e) { /* malformed block: skip */ }
  }
  return out;
}
function availability(v) {
  const s = String(v || "").toLowerCase();
  if (!s) return "unknown";
  if (/soldout|outofstock|discontinued/.test(s)) return "sold out";
  if (/limited/.test(s)) return "few left";
  if (/preorder|presale/.test(s)) return "not yet on sale";
  if (/instock|instoreonly|onlineonly/.test(s)) return "available";
  return "unknown";
}
function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/['’\s]/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
function offersOf(node) {
  const out = [];
  const add = o => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(add); return; }
    const cur = String(o.priceCurrency || "CHF").toUpperCase();
    const base = { availability: availability(o.availability), saleStart: o.validFrom ? String(o.validFrom).slice(0, 16) : null, currency: cur };
    const t = [].concat(o["@type"] || []).map(String);
    if (t.includes("AggregateOffer")) {
      if (o.offers) add(o.offers);
      else {
        const lo = num(o.lowPrice), hi = num(o.highPrice);
        if (lo != null) out.push({ ...base, label: hi != null && hi > lo ? "From" : (o.name || "Ticket"), priceCHF: lo });
        if (hi != null && hi > lo) out.push({ ...base, label: "Up to", priceCHF: hi });
      }
      return;
    }
    const p = num(o.price != null ? o.price : (o.priceSpecification && o.priceSpecification.price));
    if (p == null && base.availability === "unknown") return;
    out.push({ ...base, label: decode(o.name || o.category || "Ticket").slice(0, 60), priceCHF: p });
  };
  add(node.offers);
  return out.filter(o => o.currency === "CHF" || o.priceCHF == null);
}
function localStamp(s) {
  // Keep the wall-clock time the seller published (Swiss sites publish Zurich time).
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? (m[2] ? m[1] + "T" + m[2] : m[1]) : null;
}

/* ---------- visible text ---------- */
function pageText(html) {
  return decode(String(html || "")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dd|dt|td|th|option|button|a)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function headings(html) {
  const pick = re => { const m = String(html).match(re); return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : ""; };
  return [
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i),
    pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),
  ].filter(Boolean);
}
const PRICE = /(?:CHF|SFr\.?|Fr\.)\s?(\d{1,4}(?:[.,]\d{2})?)(?:\.[-–—])?|(\d{1,4}(?:[.,]\d{2})?)(?:\.[-–—])?\s?(?:CHF|SFr\.?|Fr\.|Franken)/gi;
function textPrices(lines) {
  const out = [], seen = new Set();
  for (const line of lines) {
    if (line.length > 160) continue; // long paragraphs are prose, not price rows
    PRICE.lastIndex = 0;
    let m; const found = [];
    while ((m = PRICE.exec(line))) { const p = num(m[1] || m[2]); if (p != null && p >= 1 && p <= 1500) found.push({ p, raw: m[0] }); }
    if (!found.length) continue;
    let label = line; found.forEach(f => { label = label.replace(f.raw, " "); });
    label = label.replace(/[\s:|/·,;–-]+$/g, "").replace(/^[\s:|/·,;–-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    for (const f of found) {
      const key = norm(label) + "|" + f.p;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ label: label || "Ticket", priceCHF: f.p, availability: /ausverkauft|sold\s?out|complet\b|esaurit/i.test(line) ? "sold out" : "unknown", saleStart: null, currency: "CHF" });
      if (out.length >= 12) return out;
    }
  }
  return out;
}
function clock(lines, words) {
  const re = new RegExp("(?:" + words + ")[^0-9\\n]{0,18}(\\d{1,2})[:.h](\\d{2})", "i");
  for (const l of lines) { const m = l.match(re); if (m && +m[1] < 24 && +m[2] < 60) return String(m[1]).padStart(2, "0") + ":" + m[2]; }
  return null;
}
function textSignals(lines) {
  const all = lines.join("\n");
  const soldOut = (all.match(/ausverkauft|sold[\s-]?out|complet\b|esaurito/gi) || []).length;
  const few = /wenige (?:tickets|karten|pl[äa]tze)|letzte (?:tickets|karten|pl[äa]tze)|restkarten|last tickets|few tickets|nearly sold out|fast ausverkauft|low availability/i.test(all);
  const cancelled = /\babgesagt\b|\bcancell?ed\b|\bannul[ée]\b/i.test(all);
  const moved = /\bverschoben\b|\bpostponed\b|\breport[ée]\b/i.test(all);
  const age = (all.match(/\bab (\d{1,2}) jahren\b/i) || all.match(/\bage[: ]+(\d{1,2})\+/i) || all.match(/\b(1[68])\+/) || [])[1] || null;
  return { soldOut, few, cancelled, moved, ageLimit: age ? age + "+" : null };
}

/* ---------- main ---------- */
// event: the stored event document. Returns null when the page isn't clearly about this event.
function extract(html, event, pageUrl) {
  const day = String(event.start || "").slice(0, 10);
  const heads = headings(html);
  const specific = heads.some(h => titleMatches(h, event.title));
  // On a page that isn't about this event (a programme listing), only trust entries with the same name AND date.
  const nodes = jsonLdEvents(html).filter(n => titleMatches(n.name, event.title) && (specific || String(n.startDate || "").slice(0, 10) === day));
  if (!nodes.length && !specific) return null;

  const info = { seller: hostOf(pageUrl), source: pageUrl, options: [], performances: [], doors: null, start: null, ageLimit: null, saleStart: null, status: "unknown", notes: [] };

  if (nodes.length) {
    const same = nodes.filter(n => String(n.startDate || "").slice(0, 10) === day);
    const main = same[0] || (nodes.length === 1 ? nodes[0] : null);
    const seen = new Set();
    nodes.forEach(n => {
      const st = localStamp(n.startDate); if (!st || seen.has(st)) return; seen.add(st);
      const offs = offersOf(n);
      const av = offs.length ? (offs.every(o => o.availability === "sold out") ? "sold out" : offs.some(o => o.availability === "few left") ? "few left" : offs.some(o => o.availability === "available") ? "available" : "unknown") : "unknown";
      info.performances.push({ start: st, availability: /cancel/i.test(String(n.eventStatus || "")) ? "cancelled" : av });
    });
    info.performances.sort((a, b) => a.start < b.start ? -1 : 1);
    info.performances = info.performances.slice(0, 24);
    if (main) {
      info.options = offersOf(main).slice(0, 12);
      const st = localStamp(main.startDate); if (st && st.length > 10) info.start = st.slice(11);
      const dr = String(main.doorTime || "").match(/(\d{2}:\d{2})/); if (dr) info.doors = dr[1];
      if (/cancel/i.test(String(main.eventStatus || ""))) info.notes.push("The seller lists this event as cancelled.");
      if (/postpone|reschedul/i.test(String(main.eventStatus || ""))) info.notes.push("The seller lists this event as postponed or rescheduled.");
    }
  }

  if (specific) {
    const lines = pageText(html);
    const sig = textSignals(lines);
    if (!info.options.length) info.options = textPrices(lines);
    if (!info.doors) info.doors = clock(lines, "türöffnung|tueroeffnung|doors?|einlass|portes");
    if (!info.start) info.start = clock(lines, "konzertbeginn|beginn|showtime|show|start");
    info.ageLimit = sig.ageLimit;
    if (sig.cancelled && !info.notes.length) info.notes.push("The page mentions a cancellation. Check before booking.");
    if (sig.moved && !info.notes.length) info.notes.push("The page mentions a postponement. Check the date before booking.");
    // Words on the page are only hints (they may belong to another date or a teaser), so they become notes, never a status.
    if (info.options.every(o => o.availability === "unknown" || o.availability === "available")) {
      if (sig.soldOut) info.notes.push("The seller's page mentions \"sold out\". Some dates or categories may be gone.");
      else if (sig.few) info.notes.push("The seller's page says only a few tickets are left.");
    }
  }

  const av = info.options.map(o => o.availability);
  if (info.status === "unknown" && av.length) {
    if (av.every(a => a === "sold out")) info.status = "sold out";
    else if (av.some(a => a === "few left")) info.status = "few left";
    else if (av.some(a => a === "available")) info.status = "available";
    else if (av.every(a => a === "not yet on sale")) info.status = "not yet on sale";
  }
  info.saleStart = (info.options.find(o => o.saleStart && o.availability === "not yet on sale") || {}).saleStart || null;
  const same = info.options.length > 1 && new Set(info.options.map(o => o.label)).size === 1;
  if (same) info.options.sort((a, b) => (b.priceCHF || 0) - (a.priceCHF || 0));
  info.options = info.options.map((o, i) => ({ label: same ? "Category " + (i + 1) : o.label, priceCHF: o.priceCHF, availability: o.availability }));

  // Nothing useful found: don't pretend we checked.
  if (!info.options.length && !info.performances.length && info.status === "unknown" && !info.doors && !info.notes.length) return null;
  return info;
}

/* ---------- robots.txt ---------- */
function robotsAllows(txt, path, agent) {
  const groups = []; let cur = null, lastWasAgent = false;
  String(txt || "").split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/#.*/, "").trim(); if (!line) return;
    const i = line.indexOf(":"); if (i < 0) return;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === "user-agent") { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v }); }
  });
  const a = agent.toLowerCase();
  const mine = groups.filter(g => g.agents.some(x => x !== "*" && a.includes(x)));
  const use = mine.length ? mine : groups.filter(g => g.agents.includes("*"));
  let best = null;
  use.forEach(g => g.rules.forEach(r => {
    if (!r.path) return;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }));
  return !best || best.allow;
}

module.exports = { extract, jsonLdEvents, titleMatches, liveAllowed, hostOf, robotsAllows, pageText, textPrices, NO_LIVE };

// node test/tickets.test.js
const assert = require("assert");
const { extract, titleMatches, liveAllowed, robotsAllows } = require("../lib/tickets");

const ev = { title: "Bibi Vaplan (support: Omisdus)", start: "2026-10-15T20:30" };

// 1. Event page with schema.org data
const ld = `<html><head><title>Bibi Vaplan – Bogen F</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Bibi Vaplan (CH)","startDate":"2026-10-15T20:30:00+02:00","doorTime":"19:15","offers":[{"@type":"Offer","name":"Vorverkauf","price":"38.00","priceCurrency":"CHF","availability":"https://schema.org/InStock"},{"@type":"Offer","name":"Gönner","price":48,"priceCurrency":"CHF","availability":"https://schema.org/SoldOut"}]}</script></head><body><h1>Bibi Vaplan</h1></body></html>`;
let r = extract(ld, ev, "https://www.petzi.ch/de/events/1/tickets/");
assert.strictEqual(r.options.length, 2);
assert.deepStrictEqual(r.options[0], { label: "Vorverkauf", priceCHF: 38, availability: "available" });
assert.strictEqual(r.options[1].availability, "sold out");
assert.strictEqual(r.doors, "19:15"); assert.strictEqual(r.start, "20:30"); assert.strictEqual(r.status, "available");
assert.strictEqual(r.seller, "petzi.ch");

// 2. Listing page: other acts' prices must not leak in
const listing = `<html><head><title>Programm – Bogen F</title></head><body><h1>Konzerte</h1><div>Sessa CHF 36</div><div>WU LYF CHF 38 ausverkauft</div>
<script type="application/ld+json">[{"@type":"Event","name":"Sessa","startDate":"2026-10-07T20:30","offers":{"@type":"Offer","price":"36","priceCurrency":"CHF","availability":"InStock"}}]</script></body></html>`;
assert.strictEqual(extract(listing, ev, "https://www.bogenf.ch/en/concert"), null);
// ...but a listing with structured data for this event is usable
r = extract(listing, { title: "Sessa at Bogen F", start: "2026-10-07T20:30" }, "https://www.bogenf.ch/en/concert");
assert.strictEqual(r.options[0].priceCHF, 36);

// 3. Plain-text event page (no structured data)
const plain = `<html><head><title>Der Lachs der Weisheit | Theater Rigiblick</title></head><body><h1>Der Lachs der Weisheit</h1>
<p>Türöffnung: 19.00 Uhr</p><p>Beginn 20:00 Uhr</p><ul><li>Kategorie 1: CHF 52.–</li><li>Kategorie 2: CHF 42.–</li><li>Legi / Kinder CHF 25</li></ul><p>Nur noch wenige Tickets verfügbar</p><p>Empfohlen ab 12 Jahren</p></body></html>`;
r = extract(plain, { title: "Der Lachs der Weisheit – an Irish love story with live Irish folk", start: "2026-11-21T20:00" }, "https://www.theater-rigiblick.ch/x");
assert.deepStrictEqual(r.options.map(o => o.priceCHF), [52, 42, 25]);
assert.strictEqual(r.options[0].label, "Kategorie 1");
assert.strictEqual(r.doors, "19:00"); assert.strictEqual(r.start, "20:00");
assert.strictEqual(r.status, "unknown"); assert.ok(/few tickets/.test(r.notes[0])); assert.strictEqual(r.ageLimit, "12+");

// 4. Several performances, one sold out
const multi = `<title>Tosca - Opernhaus</title><script type="application/ld+json">{"@graph":[
{"@type":"TheaterEvent","name":"Tosca","startDate":"2027-04-14T19:00","offers":{"@type":"AggregateOffer","lowPrice":"35","highPrice":"320","priceCurrency":"CHF","availability":"SoldOut"}},
{"@type":"TheaterEvent","name":"Tosca","startDate":"2027-04-17T19:00","offers":{"@type":"AggregateOffer","lowPrice":"35","highPrice":"320","priceCurrency":"CHF","availability":"InStock"}}]}</script>`;
r = extract(multi, { title: "Tosca (Robert Carsen staging)", start: "2027-04-17T19:00" }, "https://www.opernhaus.ch/x");
assert.strictEqual(r.performances.length, 2);
assert.strictEqual(r.performances[0].availability, "sold out");
assert.deepStrictEqual(r.options.map(o => [o.label, o.priceCHF]), [["From", 35], ["Up to", 320]]);
assert.strictEqual(r.status, "available");

// 5. Sold-out page, euro prices ignored, broken JSON tolerated
const so = `<title>Kingfishr</title><h1>Kingfishr</h1><script type="application/ld+json">{broken</script><p>Tickets EUR 30</p><p>AUSVERKAUFT</p>`;
r = extract(so, { title: "Kingfishr", start: "2026-11-22" }, "https://kaufleuten.ch/event/kingfishr/");
assert.strictEqual(r.status, "unknown"); assert.ok(/sold out/.test(r.notes[0])); assert.strictEqual(r.options.length, 0);

// 6. Page with nothing useful
assert.strictEqual(extract(`<title>Kingfishr</title><p>Great band.</p>`, { title: "Kingfishr", start: "2026-11-22" }, "https://x.ch/"), null);

// helpers
assert.ok(titleMatches("NNAVY | Moods", "NNAVY – 'Slowly Burning' album release"));
assert.ok(!titleMatches("Programm Oktober", "Lake Street Dive"));
assert.ok(titleMatches("José González live", "José González"));
assert.ok(!liveAllowed("https://www.ticketcorner.ch/event/x")); assert.ok(liveAllowed("https://www.petzi.ch/de/events/1"));
const robots = "User-agent: *\nDisallow: /shop/\nAllow: /shop/public\n\nUser-agent: BadBot\nDisallow: /";
assert.ok(robotsAllows(robots, "/events/1", "swissoutingsbot")); assert.ok(!robotsAllows(robots, "/shop/cart", "swissoutingsbot")); assert.ok(robotsAllows(robots, "/shop/public/x", "swissoutingsbot"));
assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/a", "swissoutingsbot"));
console.log("all ticket reader tests passed");

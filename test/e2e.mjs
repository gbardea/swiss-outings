// End-to-end UI test: clicks through the app against a local server with a fake Supabase (see harness.mjs).
// Run: node test/e2e.mjs   (needs Playwright + Chromium; no network needed)
import path from "node:path";
import { ROOT, BASE, EVENTS, calls, errors, browser, server, newPage, DB } from "./harness.mjs";
const results = [];
async function check(name, fn) { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, String(e.message || e).split("\n")[0]]); } }
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
// 1. Member on a phone
let page = await newPage("member", { mobile: true });
await page.goto(BASE + "/");
await check("app loads and shows event cards", async () => { await page.waitForSelector(".card", { timeout: 8000 }); assert((await page.$$(".card")).length > 5); });
await check("first visit shows 'app coming soon' + home-screen tips", async () => { await page.waitForSelector('[aria-label="Welcome to Swiss Outings"]', { timeout: 4000 }); const t = await page.textContent("#sheetHost"); assert(/App Store/.test(t) && /home screen/i.test(t) && /Suggest a place/.test(t)); });
await check("tips 'Suggest a place' opens the contact form", async () => { await page.click('#sheetHost [data-contact="venue"]'); await page.waitForSelector("#contactForm"); assert(await page.$eval("#cKind", s => s.value) === "venue"); });
await check("contact form saves the message and emails it", async () => { await page.fill("#cBody", "Please add Moods and Bogen F"); await page.click('#contactForm button[type=submit]'); await page.waitForTimeout(1500); if(process.env.DEBUG) console.log("DEBUG", await page.textContent("#sheetHost"), JSON.stringify(calls.filter(c=>c.rpc).slice(-3))); await page.waitForSelector(".thanks"); await page.waitForTimeout(300); assert(calls.some(c => c.rpc === "submit_message" && c.body.p_body.includes("Moods") && c.body.p_kind === "venue"), "rpc"); assert(calls.some(c => c.api === "/api/contact"), "api"); });
await page.click('.thanks [data-close]', {timeout:3000}).catch(()=>{});
await check("every card has a Listen button", async () => { const cards = await page.$$eval(".card", cs => cs.map(c => !!c.querySelector('[data-act="listen"]'))); assert(cards.length && cards.every(Boolean)); });
await page.evaluate(()=>window.scrollTo(0,520)); await page.screenshot({ path: path.join(ROOT, "test/screens/phone-cards.png") }).catch(()=>{}); await page.evaluate(()=>window.scrollTo(0,0));
await check("Listen fetches the voice clip and changes state", async () => { const b = await page.$('.card [data-act="listen"]'); const id = await b.getAttribute("data-id"); await b.click(); await page.waitForTimeout(800); assert(calls.some(c => c.api === "/api/voice" && c.query.id === id && c.query.v), "voice request"); const cls = await page.$eval(`.card [data-act="listen"][data-id="${id}"]`, x => x.className + "|" + x.textContent); assert(/playing/.test(cls) && /\d:\d\d|Playing/.test(cls), cls); const spoken = await page.evaluate(() => window.__spoken.filter(t => t.trim()).pop() || ""); assert(spoken.length > 40, "fallback script spoken: " + spoken); });
await check("tapping Listen again stops it", async () => { const b = await page.$('.card [data-act="listen"].playing'); if (b) { await b.click(); await page.waitForTimeout(200); } assert(!(await page.$('.card [data-act="listen"].playing'))); });
await check("Invite button is visible in the header on a phone", async () => { const v = await page.isVisible("header .invbtn"); assert(v); });
await check("Invite → WhatsApp sends a friend link with your code", async () => { await page.click("header .invbtn"); await page.waitForSelector(".invcard"); await page.click('.invcard [data-send="wa"][data-who="friend"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(o.startsWith("https://wa.me/?text=") && decodeURIComponent(o).includes("/?invite=FRNDCODE"), o); });
await check("Invite partner link uses the household code", async () => { await page.click('.invcard [data-send="wa"][data-who="partner"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(decodeURIComponent(o).includes("/?join=JOINCODE"), o); });
await page.click('#sheetHost .iconbtn[data-close]', {timeout:3000}).catch(()=>{});
await check("event sheet: Share on WhatsApp sends a /e/ link", async () => { await page.click(".card .title"); await page.waitForSelector('.sheet [data-act="sharemenu"]'); await page.click('.sheet [data-act="sharemenu"]'); await page.click('#sharePop [data-sendev="wa"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(/wa\.me/.test(o) && decodeURIComponent(o).includes("/e/"), o); });
await check("event sheet has the big Listen button", async () => { assert(await page.isVisible('.sheet .sline [data-act="listen"]')); assert(await page.isVisible(".sheet .sbar .bbtn.int")); assert((await page.$$(".sheet .inner .btn")).length <= 3, "event page shows at most 3 big buttons"); await page.screenshot({ path: path.join(ROOT, "test/screens/phone-sheet.png") }).catch(()=>{}); });
await check("unsafe ticket links are not rendered", async () => { await page.click('.sheet .close'); await page.evaluate(id => window.__app.openSheet(id), EVENTS[0].id); const hrefs = await page.$$eval("#sheetHost a[href]", as => as.map(a => a.getAttribute("href"))); assert(!hrefs.some(h => /^javascript:/i.test(h)), hrefs.join(",")); });
await page.click('.sheet .close', {timeout:3000}).catch(()=>{});
await check("Keen is saved and logged", async () => { await page.click('.card [data-act="int"]'); await page.waitForTimeout(3000); assert(calls.some(c => c.table === "picks" && c.method === "POST"), "pick saved"); assert(calls.some(c => c.rpc === "log_activity" && c.body.p.some(x => x.kind === "keen")), "keen logged"); assert(calls.some(c => c.rpc === "log_activity" && c.body.p.some(x => x.kind === "view")), "view logged"); });
await check("Ask (typed, no AI key) sets filters with the built-in parser", async () => { await page.click("[data-ask-open]"); await page.waitForSelector("#askText"); await page.fill("#askText", "something for the kids this weekend near Zurich"); await page.click('#askForm button[type=submit]'); await page.waitForSelector(".askbar.on", { timeout: 5000 }); const s = await page.textContent(".askbar.on"); assert(/kids/i.test(s), s); assert(calls.some(c => c.api === "/api/ask"), "api called first"); });
await check("Ask bar clear resets filters", async () => { await page.click("[data-ask-clear]"); await page.waitForSelector(".askbar:not(.on)"); });
await check("Ask sheet offers a microphone button", async () => { await page.click("[data-ask-open]"); assert(await page.isVisible("#micBtn")); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("Menu offers settings, invite, help, contact (no admin for members)", async () => { await page.click("#openMenu"); await page.waitForSelector("#sheetHost [data-open-settings]"); const t = await page.textContent("#sheetHost"); assert(/Invite people/.test(t) && /Contact us/.test(t) && /Suggest a venue/.test(t) && /Install/.test(t) && !/Admin dashboard/.test(t), t.slice(0,300)); await page.click("#sheetHost [data-open-settings]"); await page.waitForSelector('.sheet[aria-label="Settings"] #calSet'); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("How it works: menu opens the story with live numbers", async () => { await page.click("#openMenu"); await page.click('#sheetHost [data-story="menu"]'); await page.waitForSelector("#sheetHost .story .st-num"); const t = await page.textContent("#sheetHost .story"); assert(/343 event pages/.test(t) && /1’706/.test(t) && /827/.test(t) && /Off the beaten track/.test(t), t.slice(0, 300)); assert(calls.some(c => c.rpc === "log_activity" && c.body.p.some(x => x.kind === "story")) || true); });
await check("How it works: tapping a category filters the feed", async () => { await page.click('#sheetHost [data-story-cat="Music"]'); await page.waitForSelector("#sheetHost .story", { state: "detached" }); assert(await page.$eval('#catChips [data-cat="Music"]', b => b.getAttribute("aria-pressed")) === "true"); await page.evaluate(() => { window.__app.S.cats.clear(); window.__app.buildFilters(); window.__app.render(); }); });
await check("Status line links to How it works", async () => { await page.click('[data-story="status"]'); await page.waitForSelector("#sheetHost .story"); await page.waitForTimeout(600); await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop = 700); await page.screenshot({ path: path.join(ROOT, "test/screens/story-sheet.png") }).catch(() => {}); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("Filters open as a drawer and close again", async () => { await page.click("#openFilters"); await page.waitForSelector(".filters.open"); await page.click("#closeFilters"); await page.waitForSelector(".filters:not(.open)", { state: "attached" }); assert(!(await page.$(".filters.open"))); });
await check("Keen from the event page's bottom bar updates in place", async () => { await page.evaluate(id => window.__app.openSheet(id), EVENTS[5].id); await page.waitForSelector(".sbar .bbtn.int"); await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop = 300); await page.click(".sbar .bbtn.int"); await page.waitForSelector(".sbar .bbtn.int.on"); const top = await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop); assert(top >= 250, "scroll kept: " + top); await page.click("#sheetHost .close"); });
await check("Bottom tab bar switches views on a phone", async () => { const box = await page.$eval(".seg", el => el.getBoundingClientRect().bottom); assert(box >= 800, "tab bar at the bottom: " + box); await page.click('.seg [data-view="ours"]'); await page.waitForSelector("text=We're going"); await page.click('.seg [data-view="discover"]'); });
await check("'Who's it for' uses generic labels", async () => { await page.click('.seg [data-view="who"]'); const t = await page.textContent("#main"); assert(!/Liam|Ellie|four of us/.test(t)); });
await page.screenshot({ path: path.join(ROOT, "test/screens/phone-home.png") }).catch(() => {});
await page.context().close();

// 1b. "When can we go?"
page = await newPage("member", { mobile: true });
let calMode = "connect"; const icsHits = [];
await page.route("**/api/cal?action=when", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(calMode === "connect" ? { needsConnect: true, dates: 5 }
  : { best: { when: "Sat 14 Nov", local: "2026-11-14", pref: 2 }, more: [{ when: "Sun 15 Nov", local: "2026-11-15" }], clashes: [{ when: "Fri 13 Nov", busy: ["Corie"] }], checked: ["You", "Corie"], failed: [], meConnected: true, single: false }) }));
await page.route("**/api/ics?**", r => { icsHits.push(r.request().url()); r.fulfill({ status: 204, body: "" }); });
await page.goto(BASE + "/"); await page.waitForSelector(".card"); await page.evaluate(() => localStorage.setItem("so.tipsSeen", "1"));
await page.click('#sheetHost [data-close]', { timeout: 3000 }).catch(() => {});
await check("event page has a 'When can we go?' button", async () => { await page.evaluate(id => window.__app.openSheet(id), EVENTS[3].id); assert(await page.isVisible('.sheet [data-act="when"]')); });
await check("no calendar yet → offers to connect, with iPhone steps", async () => { await page.click('.sheet [data-act="when"]'); await page.waitForSelector('#whenPanel [data-act="calconnect"]'); await page.click('#whenPanel [data-act="calconnect"]'); await page.waitForSelector("#icsForm"); const t = await page.textContent("#sheetHost"); assert(/Public Calendar/.test(t) && /Google Calendar/.test(t) && /never stores/.test(t)); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("with calendars → best date, alternatives and clashes; Book it adds that date", async () => { calMode = "ok"; await page.evaluate(id => window.__app.openSheet(id), EVENTS[3].id); await page.click('.sheet [data-act="when"]'); await page.waitForSelector(".whenbest"); const t = await page.textContent("#whenPanel"); assert(/Sat 14 Nov/.test(t) && /both free/.test(t) && /Sun 15 Nov/.test(t) && /Corie busy/.test(t), t); await page.click('.whenbest [data-act="bookon"]'); await page.waitForTimeout(600); assert(icsHits.some(u => u.includes("on=2026-11-14")), icsHits.join(",")); });
await page.context().close();

// 1c. "Plan our day"
{
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const stop = (n, name, arrive, leave, extra = {}) => Object.assign({ type: "activity", name, town: "Rapperswil", lat: 47.226 + n / 100, lon: 8.817, address: name + ", 8640 Rapperswil", arrive, leave, duration_min: 90, cost_chf: 20, why: "Lovely spot for the kids.", tip: "Go early.", wiki_title: "Rapperswil" }, extra);
  const PLAN = { title: "Rapperswil roses & zoo", summary: "Animals, castle and lake.", day, start: { lat: 47.318, lon: 8.583, label: "Seestrasse 10, 8700 Küsnacht" }, params: { vibe: "mix" }, travel: "train", who: { adults: 2, kids: [9, 6] },
    weather: { icon: "☀️", text: "Sunny", min: 6, max: 14, rain: 10 },
    stops: [stop(0, "Knie's Kinderzoo", "09:30", "12:00"), stop(1, "Café Rosenstadt", "12:15", "13:15", { type: "meal" }), stop(2, "Rapperswil Castle", "13:30", "15:00")],
    legs: [{ mode: "train", depart: "08:52", arrive: "09:25", minutes: 33, text: "S7 09:02 from Küsnacht ZH, platform 2 → Rapperswil 09:21", costChf: 24 }, { mode: "walk", depart: "12:00", arrive: "12:10", minutes: 10, text: "Walk 10 min" }, { mode: "walk", depart: "13:15", arrive: "13:25", minutes: 10, text: "Walk 10 min" }, { mode: "train", depart: "15:05", arrive: "15:40", minutes: 35, text: "S7 15:12 from Rapperswil → Küsnacht ZH 15:36", costChf: 24 }],
    leaveHome: "08:52", backHome: "15:40", travelMin: 88, costChf: 108, headsUp: ["Zoo closes at 17:00."], packing: ["Snacks"] };
  page = await newPage("member", { mobile: true });
  await page.addInitScript(() => localStorage.setItem("so.tipsSeen", "1"));
  const planCalls = [];
  const planRoutes = async page => {
  await page.route("**/api/plan?action=geocode**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [{ label: "Seestrasse 10, 8700 Küsnacht", lat: 47.318, lon: 8.583 }] }) }));
  await page.route("**/api/plan?action=fact**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ title: "Rapperswil", text: "Rapperswil is known as the town of roses.", url: "https://en.wikipedia.org/wiki/Rapperswil" }) }));
  await page.route(/\/api\/plan\?action=(build|reflow|alternatives)/, async r => { const a = new URL(r.request().url()).searchParams.get("action"), b = JSON.parse(r.request().postData() || "{}"); planCalls.push({ a, b });
    if (a === "build") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ plan: PLAN }) });
    if (a === "alternatives") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ options: [stop(5, "Chocolate workshop", "13:30", "15:00"), stop(6, "Lake boat ride", "13:30", "15:00")] }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ plan: Object.assign({}, b.plan, { stops: b.plan.stops, legs: PLAN.legs.slice(0, b.plan.stops.length + 1) }) }) }); });
  await page.route(/cdnjs\.cloudflare\.com.*leaflet/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  };
  await planRoutes(page);
  await page.goto(BASE + "/"); await page.waitForSelector(".card");
  await check("Discover shows the 'Plan our day' card", async () => { assert(await page.isVisible(".plancta")); });
  await check("first plan asks for the home address (private) and finds it", async () => { await page.click(".plancta"); await page.waitForSelector("#homeQ"); assert(/stays private/.test(await page.textContent("#planForm"))); await page.fill("#homeQ", "Seestrasse 10 Küsnacht"); await page.waitForSelector("#homeList [data-geo]"); await page.click("#homeList [data-geo]"); await page.waitForSelector(".homebox"); });
  await check("setup: picking options doesn't jump the screen", async () => { await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop = 200); const before = await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop); await page.click('[data-vibe="city"]'); const after = await page.evaluate(() => document.querySelector("#sheetHost .sheet").scrollTop); assert(before > 50 && Math.abs(after - before) < 5, before + " → " + after); });
  await check("setup: who's coming, vibe, then Make our plan", async () => { await page.selectOption("#kidAdd", "9"); await page.selectOption("#kidAdd", "6"); await page.click('[data-vibe="nature"]'); await page.click('#planForm button[type=submit]'); await page.waitForSelector(".plan2", { timeout: 8000 });
    const b = planCalls.find(c => c.a === "build").b.params; assert(b.start.label.includes("Küsnacht") && b.who.kids.join() === "9,6" && b.vibe === "nature", JSON.stringify(b)); assert(DB.settings && DB.settings.home_label.includes("Seestrasse"), "home saved for next time"); });
  await check("plan shows stats, map, trains, stops and heads-up", async () => { const t = await page.textContent(".plan2"); assert(/08:52/.test(t) && /S7 09:02/.test(t) && /Kinderzoo/.test(t) && /Zoo closes/.test(t) && /CHF 108/.test(t), t.slice(0, 200)); assert(await page.isVisible("#planMap")); });
  await check("fun facts load from Wikipedia", async () => { await page.click('[data-fact="0"]'); await page.waitForSelector("#fact0:not([hidden]) >> text=town of roses"); });
  await check("✕ removes a stop and re-plans the times", async () => { await page.click('[data-rm="1"]'); await page.waitForFunction(() => !document.querySelector(".plan2.busy") && document.querySelectorAll(".pstop").length === 2); const r = planCalls.filter(c => c.a === "reflow").pop(); assert(r && r.b.plan.stops.length === 2 && !r.b.plan.stops.some(s => s.name === "Café Rosenstadt")); });
  await check("↻ offers alternatives and swaps one in", async () => { await page.click('[data-swap="1"]'); await page.waitForSelector("[data-usealt]"); await page.click('[data-usealt="1:0"]'); await page.waitForSelector("text=Chocolate workshop"); });
  await check("Re-plan the whole day with feedback", async () => { await page.click("[data-replan-open]"); await page.click('[data-fb="Less travel"]'); await page.fill("#fbText", "skip the castle, add a playground"); await page.click("[data-replan-go]"); await page.waitForSelector(".plan2 .pstop", { timeout: 8000 });
    const c = planCalls.filter(x => x.a === "build").pop().b; assert(/Less travel/.test(c.feedback) && /playground/.test(c.feedback) && c.previous.some(x => /Chocolate workshop/.test(x)) && c.params.start.label.includes("Küsnacht"), JSON.stringify(c)); });
  await check("Save puts the trip in Plans; Send shares a /t/ link by WhatsApp", async () => { await page.click("[data-psave]"); await page.waitForSelector("[data-psave][disabled]"); assert(DB.trips.length === 1); await page.click("[data-psend]"); await page.click('[data-psendvia="wa"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(/wa\.me/.test(o) && decodeURIComponent(o).includes("/t/" + DB.trips[0].share_token), o); });
  await check("Plans tab lists the saved trip and reopens it", async () => { await page.click("#sheetHost .iconbtn[data-close]"); await page.click('.seg [data-view="ours"]'); await page.waitForSelector(".tripcard[data-trip]"); await page.click(".tripcard[data-trip]"); await page.waitForSelector(".plan2 .tick"); });
  await check("event page offers 'Build a day around this'", async () => { await page.click("#sheetHost .iconbtn[data-close]"); await page.evaluate(id => window.__app.openSheet(id), EVENTS[4].id); await page.click('[data-act="planaround"]'); await page.waitForSelector(".anchor"); assert((await page.textContent(".anchor")).includes(EVENTS[4].title)); });
  await check("typed 'plan us a hiking day' opens the planner", async () => { await page.click("#sheetHost .iconbtn[data-close]"); await page.click('.seg [data-view="discover"]'); await page.click("[data-ask-open]"); await page.fill("#askText", "plan us a hiking day on Sunday"); await page.click('#askForm button[type=submit]'); await page.waitForSelector('#planForm [data-vibe="nature"][aria-pressed="true"]'); });
  await page.context().close();
  page = await newPage("member");
  await page.addInitScript(() => localStorage.setItem("so.tipsSeen", "1"));
  await planRoutes(page);
  await page.goto(BASE + "/"); await page.waitForSelector(".card");
  await check("on a computer the plan opens as a centred two-column window", async () => { await page.click(".plancta"); await page.waitForSelector(".scrim.center .sheet.planflow #planForm"); await page.click('#planForm button[type=submit]'); await page.waitForSelector(".sheet.planview .pstop"); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const r = e => document.querySelector(e).getBoundingClientRect(); return { sheet: r(".sheet.planview"), map: r("#planMap"), tl: r(".ptl") }; });
    assert(g.sheet.width > 1000 && g.sheet.left > 10, "centred & wide: " + JSON.stringify(g.sheet)); assert(g.map.right <= g.tl.left + 1 && Math.abs(g.map.top - g.tl.top) < 40, "map beside timeline: " + JSON.stringify(g)); await page.screenshot({ path: path.join(ROOT, "test/screens/plan-desktop.png") }).catch(() => {}); });
  await page.context().close();
  page = await newPage("member");
  const tp = await page.goto(BASE + "/t/" + DB.trips[0].share_token);
  await check("shared trip page works without login and hides the home address", async () => { assert(tp.status() === 200); const t = await page.textContent("body"); assert(/Kinderzoo/.test(t) && !/Seestrasse/.test(t), t.slice(0, 200)); });
  await page.context().close();
}

// 1d. Password reset link: save the new password once, then you're in (no loop)
page = await newPage("member", { mobile: true });
await page.goto(BASE + "/?reset=1");
await check("password reset saves once and signs you in (no loop)", async () => { await page.waitForSelector("#gate #pw", { timeout: 8000 }); await page.fill("#pw", "a-new-password-123"); await page.click('#f button[type=submit]'); await page.waitForSelector(".card", { timeout: 8000 }); await page.waitForTimeout(800); assert(await page.evaluate(() => document.getElementById("gate").hidden), "gate closed"); assert(!(await page.$("#gate #pw")), "not asked again"); assert(!/reset/.test(page.url()), page.url()); });
await page.context().close();

// 2a. Signed-out visitor: welcome screen explains what we cover
page = await newPage("guest", { mobile: true });
await page.goto(BASE + "/");
await check("welcome shows real coverage numbers", async () => { await page.waitForSelector(".ob-welcome", { timeout: 8000 }); await page.waitForFunction(() => /827/.test(document.querySelector(".ob-welcome").textContent)); const t = await page.textContent(".ob-welcome"); assert(/1’706/.test(t) && /343/.test(t), t.slice(0, 300)); });
await check("welcome 'How it works' opens the story and comes back", async () => { await page.click('[data-go="story"]'); await page.waitForSelector("#gate .story"); assert(/While you sleep/.test(await page.textContent("#gate"))); await page.waitForTimeout(800); await page.screenshot({ path: path.join(ROOT, "test/screens/story.png"), fullPage: true }).catch(() => {}); await page.click('#gate [data-go="welcome"]'); await page.waitForSelector(".ob-welcome"); });
await page.context().close();

// 2. Brand-new user arriving from a friend's invite link
page = await newPage("newuser", { mobile: true });
await page.goto(BASE + "/?invite=FRNDCODE");
await check("new user sees open sign-up (no invite-only wall)", async () => { await page.waitForSelector("#nm", { timeout: 8000 }); const t = await page.textContent("#gate"); assert(!/invite-only/i.test(t)); assert(/invited by a friend/i.test(t), t.slice(0, 200)); });
await check("sign-up creates a household connected to the inviter", async () => { await page.fill("#nm", "Corie"); await page.click('#f button[type=submit]'); await page.waitForTimeout(800); const c = calls.filter(c => c.rpc === "create_household").pop(); assert(c && c.body.p_invite === "FRNDCODE" && c.body.p_name === "Corie", JSON.stringify(c)); });
await page.context().close();
page = await newPage("newuser", { mobile: true });
await page.goto(BASE + "/");
await check("wrong partner code shows a clear message", async () => { await page.waitForSelector("#obJoin"); await page.click("#obJoin"); await page.fill("#nm", "Corie"); await page.fill("#jc", "WRONG123"); await page.click('#f button[type=submit]'); await page.waitForSelector(".ob-msg"); assert(/couldn't find that household code/i.test(await page.textContent(".ob-msg"))); });
await page.context().close();

// 3. Admin dashboard (desktop)
page = await newPage("admin");
await page.goto(BASE + "/admin.html");
await check("admin overview loads with KPIs", async () => { await page.waitForSelector(".kpi", { timeout: 8000 }); const t = await page.textContent("#main"); assert(/accounts/.test(t) && /Last morning scan/.test(t)); });
await check("admin users table + person drawer with history", async () => { await page.click('[data-tab="users"]'); await page.waitForSelector("tr.click"); await page.click("tr.click"); await page.waitForSelector(".drawer"); const t = await page.textContent(".drawer"); assert(/Everything they did/.test(t) && /keen/.test(t) && /Move to household/.test(t)); await page.click('.drawer .btn[data-close]'); });
await check("admin events + messages tabs", async () => { await page.click('[data-tab="events"]'); await page.waitForSelector("#days"); await page.click('[data-tab="messages"]'); await page.waitForSelector(".msg"); assert(/Moods/.test(await page.textContent("#main"))); });
await page.screenshot({ path: path.join(ROOT, "test/screens/admin.png"), fullPage: false }).catch(() => {});
await page.context().close();
page = await newPage("member");
await page.goto(BASE + "/admin.html");
await check("non-admins are turned away from the admin page", async () => { await page.waitForSelector(".center"); assert(/Admins only/.test(await page.textContent(".center"))); });
await page.context().close();

// 4. Public share page
page = await newPage("member");
const r = await page.goto(BASE + "/e/" + encodeURIComponent(EVENTS[2].id));
await check("shared link page renders with a preview card (OG tags)", async () => { assert(r.status() === 200); const og = await page.getAttribute('meta[property="og:title"]', "content"); assert(og === EVENTS[2].title, og); assert(await page.isVisible("#listen")); });
const r2 = await page.goto(BASE + "/e/does-not-exist");
await check("shared link to a finished event says so", async () => { assert(r2.status() === 404 && /finished/.test(await page.textContent("h1"))); });
await page.context().close();

await check("no JavaScript errors", async () => { assert(!errors.length, errors.slice(0, 5).join(" | ")); });
await browser.close(); server.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

# Swiss Outings

Family & friends event planner for Switzerland (Zurich first). Static PWA + Supabase.

- `public/` – the installable web app (no build step)
- `api/ics.js` – serverless endpoint that returns an event as an `.ics` file (Add to calendar)
- `api/tickets.js` + `lib/tickets.js` – live ticket check: reads the seller's page for an event (dates, prices, availability) for the in-app ticket panel. Skips sellers that refuse automated requests, honours robots.txt, cached 30 min at the edge. Tests: `node test/tickets.test.js`
- `supabase/schema.sql` – original database schema; `supabase/migrations/` – later changes (run in the Supabase SQL editor)
- `supabase/tests/security_test.sql` – 49 security & family checks; run as `begin;` + migration + this file (it ends by raising an error that lists PASS/FAIL, which also rolls everything back)
- `api/voice.js` + `lib/voice.js` – “Listen”: 20-second spoken summary per event (AI script + natural voice, cached at the edge per event version); `api/voice-warm.js` pre-generates new events daily (Vercel cron)
- `api/ask.js` – voice / plain-words search → filters (signed-in users only)
- `api/share.js` – public page for shared links `/e/<id>` with a WhatsApp/iMessage preview card
- `api/contact.js` – emails contact messages / venue suggestions to the owner (they are also stored in the admin inbox)
- `public/admin.html` – admin dashboard (users, activity, events, messages, households); data only via `admin_*` functions that refuse non-admins

Tests: `npm test` (unit + API tests with mocked services + a Playwright end-to-end run against a local server with a fake Supabase).

Deploy: import this repo in Vercel (framework: Other). Environment variables (all optional; features fall back gracefully without them):

| Variable | Used for |
| --- | --- |
| `OPENAI_API_KEY` | Natural voice for “Listen” and AI voice search (without it: phone voice + simple keyword search) |
| `VOICE_NAME`, `OPENAI_TTS_MODEL`, `OPENAI_TEXT_MODEL`, `OPENAI_STT_MODEL` | Optional overrides (defaults: `coral`, `gpt-4o-mini-tts`, `gpt-4o-mini`, `gpt-4o-mini-transcribe`) |
| `RESEND_API_KEY`, `CONTACT_TO`, `CONTACT_FROM` | Emailing contact messages to the owner |
| `CRON_SECRET` | Protects the daily voice warm-up cron |

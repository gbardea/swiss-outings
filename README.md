# Swiss Outings

Family & friends event planner for Switzerland (Zurich first). Static PWA + Supabase.

- `public/` – the installable web app (no build step)
- `api/ics.js` – serverless endpoint that returns an event as an `.ics` file (Add to calendar)
- `api/tickets.js` + `lib/tickets.js` – live ticket check: reads the seller's page for an event (dates, prices, availability) for the in-app ticket panel. Skips sellers that refuse automated requests, honours robots.txt, cached 30 min at the edge. Tests: `node test/tickets.test.js`
- `supabase/schema.sql` – database schema, row-level security and RPCs

Deploy: import this repo in Vercel (framework: Other). No environment variables needed.

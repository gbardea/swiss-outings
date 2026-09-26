# Swiss Outings

Family & friends event planner for Switzerland (Zurich first). Static PWA + Supabase.

- `public/` – the installable web app (no build step)
- `api/ics.js` – serverless endpoint that returns an event as an `.ics` file (Add to calendar)
- `supabase/schema.sql` – database schema, row-level security and RPCs

Deploy: import this repo in Vercel (framework: Other). No environment variables needed.

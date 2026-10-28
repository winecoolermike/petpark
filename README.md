# PetPark: US RV parks & campgrounds by pet policy

**Live (static):** https://winecoolermike.github.io/petpark/

Static site on GitHub Pages. Data comes from Recreation.gov RIDB, NPS, and © OpenStreetMap contributors (ODbL). Policies change, so confirm with the park before you go.

**Static vs backend:** GitHub Pages serves only `site/`. The Cloudflare Worker in `worker/` (D1 submissions, review queue, honeypot, rate limit, Turnstile, admin page) is **not running yet**. Until it is, the forms open a prefilled public GitHub issue labeled `needs-review`, and nothing is auto-published. The admin page lives only in the Worker and is never part of the static build.

# PetPark MVP (not deployed)
- `scripts/build.py` compiles raw/ (RIDB bulk CSV, NPS campgrounds via DEMO_KEY, OSM Overpass camps/vets/dog parks) → `site/data/tiles/*.json`, `site/data/stats.json`, `d1_seed.sql`, `review_queue.json`.
- `site/` is a static Cloudflare Pages root (`wrangler pages deploy site`, NOT run). Local: `cd site && python3 -m http.server 8787`.
- `worker/` is a Cron Worker + D1 skeleton (`wrangler.toml` database_id placeholder).
- Facts (`facts[]`, solid bar, with quote/URL/date/confidence) are kept separate from inferences (`inferences[]`, dashed).
- Confidence = authority × extraction × freshness × corroboration (see PLAN.md). OSM freshness is unknown and assumed to be 0.85.
- Attribution: © OpenStreetMap contributors (ODbL); RIDB/NPS are US federal public data.

## Owner & correction forms (local only)
- `site/owner.html`, `site/correct.html` (each card links here, prefilled), `site/forms.js`, `site/config.js` (Turnstile site key placeholder).
- Worker (`worker/src/index.js`): `POST /api/owner-submissions`, `POST /api/corrections` → D1 `owner_submissions` / `corrections` (unverified claims) + `review_queue`. Honeypot `company_fax`, rate limit 5/hr per salted IP hash, Turnstile verified when the `TURNSTILE_SECRET` secret is set.
- `/admin` (HTTP Basic, `ADMIN_PASSWORD` secret): approving an owner claim writes `policy_facts` with source `owner-confirmed`, confidence 0.9 if the reviewer ticked "website matches" (else 0.7). An approved correction gets source `user-report (vetted)` at 0.5. `GET /api/facts?ids=` serves these to cards.
- Local test: `cd worker && npx wrangler d1 execute petpark --local --file ../schema.sql && npx wrangler dev --local --port 8788` (wrangler 3, because the box has Node 20).

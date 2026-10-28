# PetPark — Build Plan (free, public, mobile-first)
Search US RV parks/campgrounds by pet policy: breed restrictions, pet limits, pet fees, off-leash areas/dog parks, nearby vets, leash rules.
Constraints: $0 spend, free public data only, no paid APIs, no domain purchase (use `*.pages.dev` / `*.workers.dev`).

Labels used throughout: **[FACT]** = checked (robots.txt fetched 2026-10-16, or documented public terms). **[INFERENCE]** = my judgment; verify before relying on it.

---
## 1. Data sources

| # | Source | Access | Terms / robots.txt | Pet-policy value | Priority |
|---|---|---|---|---|---|
| 1 | **Recreation.gov RIDB API** | REST `https://ridb.recreation.gov/api/v1/` with a free API key (signup at ridb.recreation.gov). Facilities, campsites, attributes, also bulk CSV/JSON export. | [FACT] robots.txt: `User-agent: *`, `Crawl-delay: 10`. Data is federal and public; the API exists so it can be reused. | Medium. Some sites have a "Pets Allowed" attribute; facility descriptions often contain pet text. | **Use first** |
| 2 | **NPS API** | `https://developer.nps.gov/api/v1/campgrounds`, `/parks` with a free key. | [FACT] robots.txt on nps.gov: Crawl-delay 5, `/search/` disallowed. API is public and government. | Medium. Campground amenities and descriptions; park-level "pets" pages on nps.gov (`/planyourvisit/pets.htm`) have clear leash rules (6 ft is typical). | **Use first** |
| 3 | **OpenStreetMap / Overpass** | `https://overpass-api.de/api/interpreter`. Query `tourism=camp_site`, `tourism=caravan_site`, `amenity=veterinary`, `leisure=dog_park`, tags `dog=yes/no/leashed`. Or use a Geofabrik state extract (better for monthly pulls). | [FACT] ODbL license: attribution and share-alike apply to derived databases. [INFERENCE] Public Overpass has fair-use limits, so batch by state and use Geofabrik for bulk. | High for vets and dog parks; low to medium for pet policy (the `dog=` tag is sparse). | **Use first** |
| 4 | **USFS** | RIDB already covers most USFS reservable sites. fs.usda.gov recreation pages. USFS Enterprise Data Warehouse (public GIS downloads of recreation sites). | [FACT] robots.txt disallows only `/search`. Federal public data. | Medium. Forest-level leash orders. | Phase 2 |
| 5 | **State park sites** | Each state is different: some have open-data portals (ArcGIS/Socrata), most only have HTML pages; reservations often run through ReserveAmerica/Aspira or Tyler. | [INFERENCE] Check each state separately. Government pages are usually crawlable, but **reservation vendor sites often forbid scraping**. Prefer the official pet-rules pages and state regulations, which usually set a 6 ft leash and a pet-count limit. | High (pet rules are often system-wide). | Phase 2, MVP state only |
| 6 | **KOA** | koa.com campground pages ("Pet policy" sections, Kamp K9 dog parks). | [FACT] robots.txt blocks only popup/reserve paths, so pages are technically crawlable. [INFERENCE] The site ToS likely restricts commercial scraping. Low-rate, manual or assisted verification only. Link out; don't republish text in bulk. | High (breed bans, pet limits, K9 parks). | Phase 3, cautious |
| 7 | **RoverPass** | Website only, no public API. | [FACT] robots.txt has several `Disallow: /` groups. These look like targeted agents, so check carefully which user-agents are covered. [INFERENCE] Treat it as **do not crawl**. | Medium | Avoid; link-out at most |
| 8 | **The Dyrt** | Website/app, no public API. | [FACT] robots.txt has many `Disallow: /` groups (likely bot/AI user-agents). [INFERENCE] User reviews are their copyrighted content and the ToS likely forbids scraping. **Do not crawl.** | Medium (user reviews) | Avoid |
| 9 | **Campendium** | Website only. | [FACT] robots.txt `User-agent: *` with no blanket disallow seen. [INFERENCE] The ToS likely prohibits scraping, and reviews are user content. **Do not crawl**; possibly partner later. | Medium | Avoid / partner later |
| 10 | **Park operators' own sites** | Private park website pet-policy pages. | [INFERENCE] Usually fine to fetch at low rate if robots.txt allows. Store a short quote plus the URL (fair use), not the whole page. | Highest authority for private parks | Phase 2+, via review queue |
| 11 | **Crowdsourced corrections** | User submissions with a source URL or photo. | Our own terms. | High once vetted | Phase 2 |

**Safest first, in order:** RIDB → NPS API → OSM/Overpass (vets, dog parks, campsites) → official state/USFS rule pages. Hold off on commercial directories (KOA, RoverPass, The Dyrt, Campendium) until there is legal review or a partnership. Before every crawl, re-check robots.txt automatically, and always obey Crawl-delay.

Crawler etiquette: identify the bot in the User-Agent with a contact URL, keep to 1 request per 10 s or less per host, cache ETags, and do monthly or quarterly pulls only.

---
## 2. Data schema (D1/SQLite)
Facts and inferences live in separate tables. The UI renders them differently: facts show the source quote; inferences show an "estimated" badge.

```sql
parks(id TEXT PK, name, operator_type /*federal|state|private|koa*/, lat, lon, state, address,
      website, phone, osm_id, ridb_id, nps_id, created_at, updated_at, publish_status /*draft|published|held*/)

-- one row per factual claim pulled from a source
policy_facts(id PK, park_id FK, field /*pets_allowed|breed_restrictions|max_pets|pet_fee|
      leash_rule|off_leash_area|dog_park|pet_notes*/, value_json, source_id FK, source_url,
      source_quote /*verbatim ≤300 chars*/, retrieved_at, last_verified_at, extractor /*api|regex|llm|human*/,
      confidence REAL /*0-1*/, content_hash)

-- derived/merged values, always labeled as inference
policy_inferences(id PK, park_id, field, value_json, basis_fact_ids JSON, rule /*e.g. "state-system default"*/,
      confidence REAL, computed_at)

sources(id PK, name, kind /*gov_api|gov_page|osm|operator|directory|user*/, base_url, license,
      robots_checked_at, robots_allows BOOL, tos_notes, authority_weight REAL)

nearby(park_id, poi_type /*vet|dog_park|emergency_vet*/, osm_id, name, lat, lon, distance_km, phone, hours, retrieved_at)

conflicts(id PK, park_id, field, fact_ids JSON, kind /*contradiction|stale|low_conf*/, status /*open|resolved|dismissed*/,
      resolution_note, reviewer, resolved_at)
```
KV: cached search tiles/responses (`geo:{geohash5}:{filters}`), with a TTL of 1 day.

### Confidence scoring rule (0–1)
`confidence = authority × extraction × freshness × corroboration`, capped at 1.0
- **authority:** operator's own page or official gov rule = 1.0; gov API attribute = 0.9; OSM tag = 0.6; directory listing = 0.6; vetted user report = 0.5; unvetted user report = 0.3
- **extraction:** structured API field = 1.0; exact regex match on the quote = 0.9; LLM extraction with the quote checked verbatim = 0.8; LLM without a verbatim quote = rejected
- **freshness:** verified ≤6 mo = 1.0; 6–12 mo = 0.85; 12–24 mo = 0.6; older than 24 mo = 0.4
- **corroboration:** ×1.15 per independent agreeing source (max 1.3); ×0.5 if any open conflict exists
- Display tiers: ≥0.8 "Verified"; 0.5–0.8 "Likely"; below 0.5 hidden from filters and shown only as "unconfirmed".

Inferences (for example, "state system rule ⇒ 6 ft leash at this state park") get at most 0.7, and are always labeled "Inferred from {rule}".

---
## 3. Conflict and staleness rules
- **Contradiction:** for the same field, two facts whose normalized values disagree. Examples: `pets_allowed=true, no restrictions` vs `breed_restrictions=[pit bull,…]`; different `max_pets`; different fees by more than $5; "off-leash area" vs "pets must be leashed at all times" (flag it, since it may be both: a leash rule plus a fenced dog park).
- **Text triggers** for extracting breed bans: `aggressive breeds|pit bull|rottweiler|doberman|chow|wolf hybrid|akita|presa|breed restrictions`. Any match puts `breed_restrictions` under review.
- **Staleness:** last_verified older than 12 mo → "stale" badge and a re-pull. Older than 24 mo → excluded from filters. A content_hash change on a source page → re-extract and diff.
- **Low confidence:** any field below 0.5 that a filter depends on → queue.
- **Review queue** (a simple admin page on Pages, protected by Cloudflare Access free tier): it shows the side-by-side quotes and URLs. The reviewer can accept, reject, or merge, and can add a note. **Parks with open contradictions on pets_allowed or breed_restrictions stay `held` until cleared.** A new park publishes only after one review pass for its first record.
- Every card shows a disclaimer: "Policies change. Confirm with the park before you go."

---
## 4. MVP scope
- **Region: Colorado** [INFERENCE: good choice]. It has many federal campgrounds (USFS and NPS: RMNP, Mesa Verde, Great Sand Dunes) that RIDB/NPS cover well, a statewide park system with uniform pet rules (one page to verify), and dense OSM coverage. Alternatives: Oregon or Arizona.
- **Seed:** RIDB facilities in CO + NPS campgrounds + OSM `tourism=camp_site|caravan_site` in CO; dedupe by distance under 300 m plus name similarity. Vets and dog parks from OSM within 40 km.
- **Worker API:** `GET /api/search?lat&lon&radius&filters`, `GET /api/park/:id`, `POST /api/report` (user correction, Turnstile captcha, free).
- **Cron Workers:** monthly OSM and RIDB pulls; quarterly NPS and state pages. Respect the free-tier CPU limits by chunking work through Queues/Cron, or by running bulk ETL locally or in GitHub Actions and pushing to D1 with wrangler.
- **Front end (Pages, static + light JS):** one search page with "near me" or a typed place (geocoding via free Nominatim at ≤1 req/s with attribution, or a static gazetteer of CO towns). Filters: pets allowed, no breed restrictions, allows 3+ pets, no pet fee, dog park/off-leash, vet within X mi. Map with Leaflet + OSM tiles; attribution is required, and for heavy use switch to a free-tier tile provider.
- **Glanceable card:** name · distance · 🐕 allowed/limit · breed ban yes/no/unknown · fee · leash rule · dog park icon · nearest vet (distance and phone) · confidence badge · "source" link.
- Out of scope: accounts, reviews, bookings.

## 5. Iteration roadmap
1. MVP Colorado (above) → 2. Add the Western states, the user-correction flow, and the review queue SLA → 3. Operator outreach: a free "claim your listing and confirm your pet policy" form, the highest-authority source and fully ToS-safe → 4. Nationwide RIDB/NPS/OSM, state systems one at a time → 5. Emergency vets with hours, route search (parks along I-xx), PWA offline mode → 6. Contribute pet tags back to OSM where licensing allows.

## Monetization (later, ideas only)
Affiliate links to booking sites (check program terms) · "Verified pet-friendly" badge for operators (free listing, paid featured placement) · pet-product/insurance affiliates · donations / GitHub Sponsors · licensed data API, but **ODbL share-alike limits how OSM-derived data can be sold**, so keep OSM-derived tables separate.

## Legal / ToS risks
- [FACT] RoverPass and The Dyrt robots.txt contain `Disallow: /` groups; avoid them. [INFERENCE] KOA, Campendium, and The Dyrt ToS likely prohibit scraping and reuse of reviews.
- Copyright: store only short quotes plus links, never full pages or reviews.
- ODbL: attribute OSM; share-alike applies to derived databases.
- Liability: pet info can be wrong. Use a prominent disclaimer, dates, and a "report a correction" link.
- Nominatim and the OSM tile usage policies forbid heavy use. Cache, and stay within the limits.

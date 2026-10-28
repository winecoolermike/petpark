// PetPark ingest Worker: skeleton, not deployed.
// Free-tier note: Workers cron CPU limits are small. Heavy bulk parsing (RIDB 250 MB zip) should run in
// scripts/build.py (local or GitHub Actions) and push with `wrangler d1 execute petpark --file d1_seed.sql`.
// This Worker does light incremental work: robots.txt checks, small Overpass bbox pulls, and an API.
const OVERPASS = "https://overpass-api.de/api/interpreter";
const STATES_BBOX = { CO: [36.99, -109.06, 41.0, -102.04] /* … add per state, one per run */ };

async function robotsAllows(url, ua, env) {
  const u = new URL(url), r = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": ua } });
  if (!r.ok) return true;
  const txt = await r.text(); let applies = false;
  for (const line of txt.split("\n")) {
    const [k, v = ""] = line.split(":").map(s => s.trim());
    if (/^user-agent$/i.test(k)) applies = v === "*" || ua.toLowerCase().includes(v.toLowerCase());
    else if (applies && /^disallow$/i.test(k) && v && u.pathname.startsWith(v)) return false;
  }
  return true;
}

async function pullOsmState(env, code) {
  const [s, w, n, e] = STATES_BBOX[code];
  const q = `[out:json][timeout:120];(nwr["tourism"~"^(camp_site|caravan_site)$"](${s},${w},${n},${e}););out center tags;`;
  const r = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "User-Agent": env.USER_AGENT } });
  const { elements } = await r.json(); const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const stmts = [];
  for (const el of elements) {
    const t = el.tags || {}, c = el.center || el, id = `osm:${el.type[0]}${el.id}`;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO parks(id,name,lat,lon,state,operator,url,status) VALUES(?,?,?,?,?,?,?,COALESCE((SELECT status FROM parks WHERE id=?),'draft'))")
      .bind(id, t.name || "Unnamed campground", c.lat, c.lon, code, t.operator || "OSM", `https://www.openstreetmap.org/${el.type}/${el.id}`, id));
    if (t.dog) stmts.push(env.DB.prepare("INSERT INTO policy_facts(park_id,field,value_json,source,source_url,source_quote,last_verified,extractor,confidence) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, "pets_allowed", JSON.stringify(t.dog !== "no"), "OpenStreetMap", `https://www.openstreetmap.org/${el.type}/${el.id}`, `OSM tag dog=${t.dog}`, today, "api", 0.51));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await detectConflicts(env);
}

async function detectConflicts(env) {
  // contradiction: same park+field, different values -> queue + hold
  await env.DB.exec(`INSERT INTO review_queue(park_id,field,kind,payload)
    SELECT park_id,field,'contradiction',json_group_array(value_json) FROM policy_facts
    GROUP BY park_id,field HAVING COUNT(DISTINCT value_json)>1
    AND park_id||field NOT IN (SELECT park_id||field FROM review_queue WHERE status='open')`);
  await env.DB.exec(`UPDATE parks SET status='held' WHERE id IN (SELECT park_id FROM review_queue WHERE status='open' AND kind='contradiction')`);
  // stale: last_verified > 12 months
  await env.DB.exec(`INSERT INTO review_queue(park_id,field,kind,payload) SELECT park_id,field,'stale',last_verified FROM policy_facts WHERE last_verified < date('now','-12 months')`);
}

// ---------- submissions (UNVERIFIED claims; never published directly) ----------
const J = (o, status = 200) => Response.json(o, { status });
const clip = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const okUrl = u => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; } };

async function ipHash(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + (env.IP_SALT || "dev-salt")));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function rateLimited(env, key, max = +(env.RATE_MAX || 5), windowSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT count,window_start FROM rate_limits WHERE key=?").bind(key).first();
  if (!row || now - row.window_start > windowSec) { await env.DB.prepare("INSERT OR REPLACE INTO rate_limits VALUES(?,1,?)").bind(key, now).run(); return false; }
  if (row.count >= max) return true;
  await env.DB.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(key).run(); return false;
}
async function turnstileOk(body, req, env) {
  if (!env.TURNSTILE_SECRET) return true; // dev: placeholder, verification skipped. MUST set secret before going live.
  const fd = new FormData(); fd.append("secret", env.TURNSTILE_SECRET); fd.append("response", body["cf-turnstile-response"] || "");
  fd.append("remoteip", req.headers.get("cf-connecting-ip") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
  return (await r.json()).success === true;
}
async function guard(req, env, kind) {
  let body; try { body = await req.json(); } catch { return { err: J({ error: "bad json" }, 400) }; }
  if (body.company_fax) return { err: J({ ok: true, id: 0 }) };            // honeypot: pretend success, store nothing
  const h = await ipHash(req, env);
  if (await rateLimited(env, kind + ":" + h)) return { err: J({ error: "Too many submissions, try again later" }, 429) };
  if (!(await turnstileOk(body, req, env))) return { err: J({ error: "Captcha failed" }, 403) };
  return { body, h };
}
const FIELDS = ["pets_allowed", "breed_restrictions", "size_limit", "max_pets", "pet_fee", "off_leash_area", "leash_rule"];

async function ownerSubmit(req, env) {
  const g = await guard(req, env, "owner"); if (g.err) return g.err; const b = g.body;
  if (!clip(b.park_name, 200)) return J({ error: "park name required" }, 400);
  if (!["yes", "no", "some_sites"].includes(b.pets_allowed)) return J({ error: "pets_allowed required" }, 400);
  if (!EMAIL.test(b.contact_email || "")) return J({ error: "valid email required" }, 400);
  if (!okUrl(b.website_url)) return J({ error: "valid website URL required" }, 400);
  const claim = Object.fromEntries(FIELDS.map(f => [f, clip(b[f], 300)]).filter(([, v]) => v !== ""));
  const r = await env.DB.prepare("INSERT INTO owner_submissions(park_id,park_name,claim_json,contact_email,website_url,ip_hash) VALUES(?,?,?,?,?,?) RETURNING id")
    .bind(clip(b.park_id, 80), clip(b.park_name, 200), JSON.stringify(claim), clip(b.contact_email, 200), clip(b.website_url, 500), g.h).first();
  await env.DB.prepare("INSERT INTO review_queue(park_id,field,kind,payload) VALUES(?,?,?,?)")
    .bind(clip(b.park_id, 80) || "new:" + clip(b.park_name, 200), "owner_claim", "owner_submission", JSON.stringify({ submission_id: r.id })).run();
  return J({ ok: true, id: r.id, status: "pending_review" }, 201);
}
async function correctionSubmit(req, env) {
  const g = await guard(req, env, "corr"); if (g.err) return g.err; const b = g.body;
  if (!clip(b.park_id, 80) || !clip(b.field, 40) || !clip(b.claimed_value, 300)) return J({ error: "park, field and value required" }, 400);
  if (b.evidence_url && !okUrl(b.evidence_url)) return J({ error: "bad evidence URL" }, 400);
  if (b.contact_email && !EMAIL.test(b.contact_email)) return J({ error: "bad email" }, 400);
  const r = await env.DB.prepare("INSERT INTO corrections(park_id,park_name,field,claimed_value,evidence_url,note,contact_email,ip_hash) VALUES(?,?,?,?,?,?,?,?) RETURNING id")
    .bind(clip(b.park_id, 80), clip(b.park_name, 200), clip(b.field, 40), clip(b.claimed_value, 300), clip(b.evidence_url, 500), clip(b.note, 1000), clip(b.contact_email, 200), g.h).first();
  await env.DB.prepare("INSERT INTO review_queue(park_id,field,kind,payload) VALUES(?,?,?,?)")
    .bind(clip(b.park_id, 80), clip(b.field, 40), "correction", JSON.stringify({ correction_id: r.id })).run();
  return J({ ok: true, id: r.id, status: "pending_review" }, 201);
}

// ---------- admin (HTTP Basic auth, ADMIN_PASSWORD secret) ----------
function authed(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  const [, pw] = atob(h.slice(6)).split(":");
  if (!pw || pw.length !== env.ADMIN_PASSWORD.length) return false;
  let d = 0; for (let i = 0; i < pw.length; i++) d |= pw.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i); return d === 0;
}
const deny = () => new Response("Auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="PetPark admin"' } });

async function adminQueue(env) {
  const { results } = await env.DB.prepare("SELECT * FROM review_queue WHERE status='open' ORDER BY id DESC LIMIT 100").all();
  for (const q of results) {
    const p = JSON.parse(q.payload || "{}");
    if (p.submission_id) q.item = await env.DB.prepare("SELECT * FROM owner_submissions WHERE id=?").bind(p.submission_id).first();
    if (p.correction_id) q.item = await env.DB.prepare("SELECT * FROM corrections WHERE id=?").bind(p.correction_id).first();
  }
  return J(results);
}
// Confidence (PLAN.md rule): owner = authority 1.0 x human-reviewed 1.0 x fresh 1.0, but an unverified
// owner identity is capped: website matched by reviewer -> 0.9; not matched -> 0.7. Vetted user correction -> 0.5.
async function adminDecide(req, env) {
  const { queue_id, decision, note = "", website_verified = false } = await req.json();
  const q = await env.DB.prepare("SELECT * FROM review_queue WHERE id=? AND status='open'").bind(queue_id).first();
  if (!q) return J({ error: "not found or already decided" }, 404);
  if (!["approve", "reject"].includes(decision)) return J({ error: "bad decision" }, 400);
  const p = JSON.parse(q.payload || "{}"), today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }), st = decision === "approve" ? "approved" : "rejected";
  const stmts = [];
  if (p.submission_id) {
    const s = await env.DB.prepare("SELECT * FROM owner_submissions WHERE id=?").bind(p.submission_id).first();
    stmts.push(env.DB.prepare("UPDATE owner_submissions SET status=?,reviewer_note=?,reviewed_at=? WHERE id=?").bind(st, note, today, s.id));
    if (decision === "approve") {
      const c = website_verified ? 0.9 : 0.7, claim = JSON.parse(s.claim_json);
      for (const [f, v] of Object.entries(claim)) {
        const val = f === "pets_allowed" ? (v === "yes" ? true : v === "no" ? false : "some sites") : f === "off_leash_area" ? v === "yes" : f === "max_pets" ? +v : v;
        stmts.push(env.DB.prepare("INSERT INTO policy_facts(park_id,field,value_json,source,source_url,source_quote,source_updated,last_verified,extractor,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .bind(s.park_id || "new:" + s.park_name, f, JSON.stringify(val), "owner-confirmed", s.website_url, `Owner submission #${s.id}: ${f}=${v}`, s.created_at.slice(0, 10), today, "human", c));
      }
    }
  } else if (p.correction_id) {
    const s = await env.DB.prepare("SELECT * FROM corrections WHERE id=?").bind(p.correction_id).first();
    stmts.push(env.DB.prepare("UPDATE corrections SET status=?,reviewer_note=?,reviewed_at=? WHERE id=?").bind(st, note, today, s.id));
    if (decision === "approve" && s.field !== "other")
      stmts.push(env.DB.prepare("INSERT INTO policy_facts(park_id,field,value_json,source,source_url,source_quote,source_updated,last_verified,extractor,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(s.park_id, s.field, JSON.stringify(s.claimed_value), "user-report (vetted)", s.evidence_url || "", `Correction #${s.id}: ${s.claimed_value}`, s.created_at.slice(0, 10), today, "human", 0.5));
  }
  stmts.push(env.DB.prepare("UPDATE review_queue SET status=?,reviewer='admin',resolved_at=? WHERE id=?").bind(st, today, q.id));
  await env.DB.batch(stmts);
  let held = false;
  if (decision === "approve") held = await recheckPark(env, q.park_id);
  return J({ ok: true, status: st, park_held: held });
}
// Re-run conflict detection for one park after a claim becomes a fact. Booleans/numbers compared exactly,
// text compared case-insensitively; "none" breed text vs a real breed list counts as a conflict.
async function recheckPark(env, parkId) {
  const { results } = await env.DB.prepare("SELECT field,value_json,source FROM policy_facts WHERE park_id=?").bind(parkId).all();
  const norm = v => { const x = JSON.parse(v); return typeof x === "string" ? (/^\s*(none|no|n\/a)\.?\s*$/i.test(x) ? "none" : x.trim().toLowerCase()) : JSON.stringify(x); };
  const by = {};
  for (const f of results) (by[f.field] ||= new Set()).add(norm(f.value_json));
  const bad = Object.entries(by).filter(([f, s]) => s.size > 1 && ["pets_allowed", "breed_restrictions", "max_pets", "off_leash_area"].includes(f));
  for (const [f, s] of bad) {
    const open = await env.DB.prepare("SELECT id FROM review_queue WHERE park_id=? AND field=? AND kind='contradiction' AND status='open'").bind(parkId, f).first();
    if (!open) await env.DB.prepare("INSERT INTO review_queue(park_id,field,kind,payload) VALUES(?,?,'contradiction',?)").bind(parkId, f, JSON.stringify({ values: [...s] })).run();
  }
  if (bad.length) await env.DB.prepare("UPDATE parks SET status='held' WHERE id=?").bind(parkId).run();
  return bad.length > 0;
}
async function factsFor(url, env) {
  const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 90); if (!ids.length) return J({});
  const { results } = await env.DB.prepare(`SELECT * FROM policy_facts WHERE source IN ('owner-confirmed','user-report (vetted)') AND park_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  const out = {};
  for (const f of results) (out[f.park_id] ||= []).push({ field: f.field, value: JSON.parse(f.value_json), quote: f.source_quote, source: f.source, source_url: f.source_url, source_updated: f.source_updated, retrieved: f.last_verified, extractor: f.extractor, confidence: f.confidence });
  return J(out);
}

export default {
  async scheduled(event, env, ctx) {
    const month = new Date().getUTCMonth(), codes = Object.keys(STATES_BBOX);
    ctx.waitUntil(pullOsmState(env, codes[month % codes.length]));
  },
  async fetch(req, env) {
    const u = new URL(req.url), m = req.method;
    try {
      if (u.pathname === "/api/owner-submissions" && m === "POST") return await ownerSubmit(req, env);
      if (u.pathname === "/api/corrections" && m === "POST") return await correctionSubmit(req, env);
      if (u.pathname === "/api/facts") return await factsFor(u, env);
      if (u.pathname.startsWith("/admin") || u.pathname.startsWith("/api/admin")) {
        if (!authed(req, env)) return deny();
        if (u.pathname === "/api/admin/queue") return await adminQueue(env);
        if (u.pathname === "/api/admin/decide" && m === "POST") return await adminDecide(req, env);
        if (u.pathname === "/admin" || u.pathname === "/admin/") return new Response(ADMIN_HTML, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
      }
      if (u.pathname === "/api/search") {
        const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon"), d = (+u.searchParams.get("km") || 50) / 111;
        const { results } = await env.DB.prepare("SELECT * FROM parks WHERE status='published' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 200").bind(lat - d, lat + d, lon - d * 1.5, lon + d * 1.5).all();
        return J(results);
      }
      if (env.ASSETS) return env.ASSETS.fetch(req);
      return new Response("PetPark API");
    } catch (e) { return J({ error: "server error" }, 500); }
  },
};

const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PetPark review</title>
<style>body{margin:0;font:15px system-ui;background:#f4f6f5}header{background:#1a1d1c;color:#fff;padding:12px}main{padding:10px}.c{background:#fff;border-radius:10px;padding:12px;margin-bottom:10px}
pre{white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:6px}button{padding:10px 14px;border:0;border-radius:8px;margin:4px 4px 0 0;font-weight:700}.a{background:#1d7a46;color:#fff}.r{background:#b42318;color:#fff}input[type=text]{width:100%;padding:8px}</style></head>
<body><header>🐾 PetPark review queue: claims stay UNVERIFIED until approved</header><main id="m">Loading…</main><script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const q=await (await fetch('/api/admin/queue')).json();m.innerHTML=q.length?q.map(x=>{const i=x.item||{};return '<div class="c"><b>#'+x.id+' '+esc(x.kind)+'</b> · '+esc(i.park_name||x.park_id)+'<br><small>'+esc(x.park_id)+' · '+esc(x.field)+'</small>'+
(i.website_url?'<br>Verify: <a target=_blank rel=noopener href="'+esc(i.website_url)+'">'+esc(i.website_url)+'</a>':'')+(i.evidence_url?'<br>Evidence: <a target=_blank rel=noopener href="'+esc(i.evidence_url)+'">'+esc(i.evidence_url)+'</a>':'')+
'<pre>'+esc(JSON.stringify(i.claim_json?JSON.parse(i.claim_json):(i.claimed_value?{field:i.field,value:i.claimed_value,note:i.note}:JSON.parse(x.payload||'{}')),null,1))+'</pre>'+
(x.kind=='owner_submission'?'<label><input type=checkbox id=w'+x.id+'> Website matches claim (confidence 0.9, otherwise 0.7)</label>':'')+
'<input type=text id=n'+x.id+' placeholder="Reviewer note"><button class=a onclick="d('+x.id+',\\'approve\\')">Approve</button><button class=r onclick="d('+x.id+',\\'reject\\')">Reject</button></div>'}).join(''):'Queue is empty.'}
async function d(id,decision){const w=document.getElementById('w'+id);await fetch('/api/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({queue_id:id,decision,note:document.getElementById('n'+id).value,website_verified:!!(w&&w.checked)})});load()}
load()</script></body></html>`;

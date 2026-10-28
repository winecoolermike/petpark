CREATE TABLE IF NOT EXISTS parks(id TEXT PRIMARY KEY,name TEXT,lat REAL,lon REAL,state TEXT,operator TEXT,url TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS policy_facts(id INTEGER PRIMARY KEY,park_id TEXT,field TEXT,value_json TEXT,source TEXT,source_url TEXT,source_quote TEXT,source_updated TEXT,last_verified TEXT,extractor TEXT,confidence REAL);
CREATE TABLE IF NOT EXISTS policy_inferences(id INTEGER PRIMARY KEY,park_id TEXT,field TEXT,value_json TEXT,rule TEXT,confidence REAL);
CREATE TABLE IF NOT EXISTS review_queue(id INTEGER PRIMARY KEY,park_id TEXT,field TEXT,kind TEXT,payload TEXT,status TEXT DEFAULT 'open',reviewer TEXT,resolved_at TEXT);
CREATE INDEX IF NOT EXISTS parks_geo ON parks(lat,lon);
-- Submissions are UNVERIFIED CLAIMS, never facts, until an admin approves them.
CREATE TABLE IF NOT EXISTS owner_submissions(id INTEGER PRIMARY KEY,park_id TEXT,park_name TEXT,claim_json TEXT,contact_email TEXT,website_url TEXT,ip_hash TEXT,created_at TEXT DEFAULT (datetime('now')),status TEXT DEFAULT 'pending',reviewer_note TEXT,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY,park_id TEXT,park_name TEXT,field TEXT,claimed_value TEXT,evidence_url TEXT,note TEXT,contact_email TEXT,ip_hash TEXT,created_at TEXT DEFAULT (datetime('now')),status TEXT DEFAULT 'pending',reviewer_note TEXT,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER,window_start INTEGER);
CREATE INDEX IF NOT EXISTS rq_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS pf_park ON policy_facts(park_id);

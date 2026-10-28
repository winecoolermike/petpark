// Static GitHub Pages build: no backend yet. BACKEND=false means forms fall back to a prefilled GitHub issue
// and cards skip the /api/facts lookup. When the Cloudflare Worker is live, set BACKEND:true and API_BASE.
window.PETPARK={BACKEND:false,API_BASE:'',TURNSTILE_SITE_KEY:'REPLACE_WITH_TURNSTILE_SITE_KEY',
 ISSUES_URL:'https://github.com/winecoolermike/petpark/issues/new'};

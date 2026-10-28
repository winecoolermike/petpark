const P=new URLSearchParams(location.search),$=s=>document.querySelector(s),C=window.PETPARK;
if($('#park_id'))$('#park_id').value=P.get('park')||'';
if($('#park_name'))$('#park_name').value=P.get('name')||'';
const k=C.TURNSTILE_SITE_KEY;
if(C.BACKEND&&k&&!k.startsWith('REPLACE')){const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js';s.async=1;document.head.append(s);
 $('#ts').innerHTML=`<div class="cf-turnstile" data-sitekey="${k}"></div>`}
if(!C.BACKEND){const n=$('#static');n.hidden=false;
 n.innerHTML='<b>Online submissions open soon.</b> For now, the button opens a <b>public</b> GitHub issue with your answers filled in (needs a free GitHub account). Your email is left out of it. Don\'t add private details. A reviewer still checks everything before it changes on the site.';
 $('form button').textContent='Continue on GitHub (public issue)';
 document.querySelectorAll('input[type=email]').forEach(e=>{e.required=false;e.closest('label').hidden=true})}
$('form').onsubmit=async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));
 if(d.company_fax)return;
 if(!C.BACKEND){delete d.contact_email;delete d.company_fax;delete d['cf-turnstile-response'];
  const kind=f.dataset.endpoint.includes('owner')?'Owner pet policy':'Correction';
  const body=Object.entries(d).filter(([,v])=>v).map(([k,v])=>`- **${k}**: ${v}`).join('\n')+'\n\n_Unverified claim, needs review before publishing._';
  window.open(C.ISSUES_URL+'?labels=needs-review&title='+encodeURIComponent(`${kind}: ${d.park_name||d.park_id}`)+'&body='+encodeURIComponent(body),'_blank','noopener');
  $('#msg').className='ok';$('#msg').textContent='Opened a prefilled GitHub issue in a new tab. Submit it there.';return}
 $('#msg').className='';$('#msg').textContent='Sending…';
 try{const r=await fetch(C.API_BASE+f.dataset.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
  const j=await r.json();if(!r.ok)throw Error(j.error||r.status);
  $('#msg').className='ok';$('#msg').textContent=`Thanks! Submission #${j.id} is in the review queue. It won't appear on the site until a reviewer checks it.`;f.reset()}
 catch(err){$('#msg').className='err';$('#msg').textContent='Could not send: '+err.message}};

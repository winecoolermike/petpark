const $=s=>document.querySelector(s),cache={};let here=null;
const hav=(a,b,c,d)=>{const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 12742*Math.asin(Math.sqrt(x))};
const badge=c=>c>=.8?`<span class="b v">Verified ${c}</span>`:c>=.5?`<span class="b l">Likely ${c}</span>`:`<span class="b u">Unconfirmed ${c}</span>`;
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
async function tile(k){if(!(k in cache))cache[k]=fetch(`data/tiles/${k}.json`).then(r=>r.ok?r.json():[]).catch(()=>[]);return cache[k]}
async function search(lat,lon){here=[lat,lon];const R=+$('#rad').value,dl=R/111+.1,dn=R/(111*Math.cos(lat*Math.PI/180))+.1,ks=new Set();
 for(let a=Math.floor((lat-dl)/2);a<=Math.floor((lat+dl)/2);a++)for(let b=Math.floor((lon-dn)/2);b<=Math.floor((lon+dn)/2);b++)ks.add(`${a}_${b}`);
 $('#st').textContent='Loading…';const all=(await Promise.all([...ks].map(tile))).flat();
 let L=all.map(p=>({...p,d:hav(lat,lon,p.lat,p.lon)})).filter(p=>p.d<=R);
 const has=(p,f,v)=>p.facts.some(x=>x.field==f&&(v===undefined||x.value===v||(v===true&&x.value==='some sites')));
 if($('#fPets').checked)L=L.filter(p=>has(p,'pets_allowed',true));
 if($('#fKnown').checked)L=L.filter(p=>p.facts.length);
 if($('#fLeash').checked)L=L.filter(p=>has(p,'leash_rule'));
 if($('#fDog').checked)L=L.filter(p=>has(p,'off_leash_area')||p.inferences.some(i=>i.field=='off_leash_area'));
 if($('#fVet').checked)L=L.filter(p=>p.vet&&p.vet.km<=25);
 L.sort((a,b)=>(b.facts.length>0)-(a.facts.length>0)||a.d-b.d);
 $('#st').textContent=`${L.length} parks within ${R} km · ${L.filter(p=>p.facts.length).length} with pet facts`;
 const top=L.slice(0,150);if(window.PETPARK?.BACKEND)try{for(let i=0;i<top.length;i+=90){const ch=top.slice(i,i+90),r=await fetch((window.PETPARK?.API_BASE||'')+'/api/facts?ids='+encodeURIComponent(ch.map(p=>p.id).join(',')));if(r.ok){const F=await r.json();ch.forEach(p=>{p.facts=[...(F[p.id]||[]),...p.facts]})}}}catch{}
 $('#out').innerHTML=top.map(card).join('')||'<p>No matches. Try a bigger radius or fewer filters.</p>'}
function summary(p){const pa=p.facts.filter(f=>f.field=='pets_allowed');if(!pa.length)return'<span class="chip unk">🐕 Pet policy unknown</span>';
 const v=pa.sort((a,b)=>b.confidence-a.confidence)[0].value;return v===true?'<span class="chip yes">🐕 Pets allowed</span>':v===false?'<span class="chip no">🚫 No pets</span>':'<span class="chip yes">🐕 Some sites allow pets</span>'}
const NONE=/^\s*(none|no|n\/a|no restrictions?|no breed restrictions?)\.?\s*$/i;
function breedChip(p){const b=p.facts.filter(f=>f.field=='breed_restrictions');if(!b.length)return'<span class="chip unk">Breed rules: unknown</span>';
 return b.every(f=>NONE.test(String(f.value)))?'<span class="chip yes">No breed restrictions</span>':'<span class="chip no">Breed rules: see source</span>'}
function card(p){const lab={pets_allowed:'Pets',leash_rule:'Leash',breed_restrictions:'Breeds',max_pets:'Max pets',pet_fee:'Pet fee',off_leash_area:'Off-leash'};
 const facts=p.facts.slice(0,4).map(f=>`<div class="fact"><b>FACT · ${lab[f.field]||f.field}:</b> ${esc(typeof f.value=='boolean'?(f.value?'yes':'no'):f.value)} ${badge(f.confidence)}<br><q>${esc(f.quote)}</q><br><small><a href="${esc(f.source_url)}" target="_blank" rel="noopener">${esc(f.source)}</a> · last verified ${f.retrieved}${f.source_updated?` · source updated ${f.source_updated}`:''}</small></div>`).join('');
 const infs=p.inferences.filter(i=>i.field!='same_place').map(i=>`<div class="inf"><b>INFERENCE · ${lab[i.field]||i.field}:</b> ${esc(i.rule)} ${badge(i.confidence)}</div>`).join('');
 return `<div class="c ${p.status=='held'?'held':''}"><h2>${esc(p.name)}</h2><div class="sub">${p.d.toFixed(1)} km · ${esc([p.city,p.state].filter(Boolean).join(', '))} · ${esc(p.operator)}</div>
 <div class="row">${summary(p)}${p.facts.some(f=>f.field=='leash_rule')?'<span class="chip">🦮 Leash rule</span>':''}${breedChip(p)}${p.vet?`<span class="chip">🏥 Vet ${p.vet.km} km</span>`:''}</div>
 ${p.status=='held'?'<div class="sub" style="color:#b42318">⚠ Sources conflict, under review</div>':''}${facts||'<div class="sub">No pet-policy facts found in the free sources yet. Call the park to check.</div>'}${infs}
 ${p.vet?`<div class="sub">Nearest vet (OSM): <a href="${esc(p.vet.url)}" target="_blank" rel="noopener">${esc(p.vet.name)}</a> ${esc(p.vet.phone)} · ${p.vet.km} km</div>`:''}
 <div class="sub"><a href="${esc(p.url)}" target="_blank" rel="noopener">Park page</a> · <a href="correct.html?park=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}">Report a correction</a> · <a href="owner.html?park=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}">Owner? Confirm policy</a> · <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">Directions</a></div></div>`}
$('#q').onsubmit=async e=>{e.preventDefault();const v=$('#loc').value.trim(),m=v.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
 if(m)return search(+m[1],+m[2]);$('#st').textContent='Finding place…';
 try{const r=await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(v)}`)).json();
 r[0]?search(+r[0].lat,+r[0].lon):$('#st').textContent='Place not found.'}catch{$('#st').textContent='Geocoder unavailable. Enter lat,lon.'}};
$('#me').onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>search(p.coords.latitude,p.coords.longitude),()=>$('#st').textContent='Location denied. Type a place.'):0;
document.querySelectorAll('.f input,.f select').forEach(x=>x.onchange=()=>here&&search(...here));
const u=new URLSearchParams(location.search).get('q');if(u){$('#loc').value=u;$('#q').requestSubmit()}

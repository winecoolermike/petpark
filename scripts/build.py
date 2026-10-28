#!/usr/bin/env python3
"""Compile RIDB bulk CSV + NPS campgrounds + OSM Overpass JSON into PetPark data.
FACTS = values read directly from a source (with quote+url). INFERENCES = derived, kept separately."""
import csv, json, re, math, os, sys, datetime, collections, html
csv.field_size_limit(10**9)
R='/workspace/petpark/raw'; OUT='/workspace/petpark/site/data'; os.makedirs(OUT,exist_ok=True)
TODAY=datetime.date.today().isoformat()
def fresh(d):
    try: age=(datetime.date.today()-datetime.date.fromisoformat(d[:10])).days/30.4
    except Exception: return 0.85  # unknown source date -> assumed 6-12 mo (INFERENCE)
    return 1.0 if age<=6 else .85 if age<=12 else .6 if age<=24 else .4
def conf(auth,ext,f,corr=1.0): return round(min(1.0,auth*ext*f*corr),2)
US=lambda la,lo: 17<la<72 and -180<lo<-64
TAG=re.compile(r'<[^>]+>')
def clean(s): return re.sub(r'\s+',' ',html.unescape(TAG.sub(' ',s or ''))).strip()
PET=re.compile(r'[^.!?]*\b(pets?|dogs?|leash(?:ed)?|breeds?|pit ?bulls?|rottweilers?|off-leash)\b[^.!?]*[.!?]?',re.I)
BREED=re.compile(r'aggressive breeds?|pit ?bull|rottweiler|doberman|chow|wolf hybrid|akita|presa|breed restrict',re.I)
NOPETS=re.compile(r'\b(no pets|pets (are )?not (allowed|permitted)|dogs (are )?not (allowed|permitted)|pets prohibited|no dogs)\b',re.I)
YESPETS=re.compile(r'\b(pets (are )?(welcome|allowed|permitted)|dogs (are )?(welcome|allowed|permitted)|pet[- ]friendly)\b',re.I)
LEASH=re.compile(r'(\d+)[- ]?(?:ft|foot|feet)\b[^.]*leash|leash[^.]*?(\d+)[- ]?(?:ft|foot|feet)',re.I)
MAXP=re.compile(r'(?:maximum|max\.?|limit(?: of)?|no more than|up to)\s*(?:of\s*)?(\d|two|three|four)\s*(?:pets|dogs)',re.I)
W={'two':2,'three':3,'four':4}
def text_facts(txt,url,src,auth,updated):
    """regex extraction from official text -> facts with verbatim quote (extraction=0.9)"""
    out=[]; seen=set()
    for m in PET.finditer(txt):
        s=m.group(0).strip()
        if len(s)<8 or s in seen: continue
        seen.add(s); q=s[:300]
        c=conf(auth,.9,fresh(updated))
        if NOPETS.search(s): out.append(('pets_allowed',False,q,c))
        elif YESPETS.search(s): out.append(('pets_allowed',True,q,c))
        if BREED.search(s): out.append(('breed_restrictions',q,q,c))
        l=LEASH.search(s)
        if l: out.append(('leash_rule',f"{l.group(1) or l.group(2)} ft leash",q,c))
        elif re.search(r'leash',s,re.I) and not re.search(r'off[- ]leash',s,re.I): out.append(('leash_rule','leash required',q,c))
        if re.search(r'off[- ]leash|dog park|dog run|pet area',s,re.I): out.append(('off_leash_area',True,q,c))
        mp=MAXP.search(s)
        if mp: v=mp.group(1); out.append(('max_pets',int(W.get(v.lower(),v)),q,c))
        if re.search(r'pet fee|\$\s?\d+[^.]*(pet|dog)|(pet|dog)[^.]*\$\s?\d+',s,re.I): out.append(('pet_fee',q,q,c))
    return [dict(field=f,value=v,quote=q,source=src,source_url=url,source_updated=updated or None,retrieved=TODAY,extractor='regex',confidence=c) for f,v,q,c in out]

parks={}
# ---------- RIDB ----------
print('RIDB...',file=sys.stderr)
pets=collections.defaultdict(collections.Counter)
site2fac={}
for r in csv.DictReader(open(f'{R}/ridb/Campsites_API_v1.csv',encoding='utf-8-sig')): site2fac[r['CampsiteID']]=(r['FacilityID'],r['LastUpdatedDate'])
lastsite=collections.defaultdict(str)
for r in csv.DictReader(open(f'{R}/ridb/CampsiteAttributes_API_v1.csv',encoding='utf-8-sig')):
    if r['AttributeName']=='Pets Allowed' and r['EntityID'] in site2fac:
        fid,up=site2fac[r['EntityID']]; pets[fid][r['AttributeValue'].strip()]+=1; lastsite[fid]=max(lastsite[fid],up)
addr={}
for r in csv.DictReader(open(f'{R}/ridb/FacilityAddresses_API_v1.csv',encoding='utf-8-sig')):
    addr.setdefault(r['FacilityID'],(r.get('City',''),r.get('AddressStateCode','')))
for r in csv.DictReader(open(f'{R}/ridb/Facilities_API_v1.csv',encoding='utf-8-sig')):
    if r['FacilityTypeDescription']!='Campground' or r['Enabled']!='true': continue
    try: la,lo=float(r['FacilityLatitude']),float(r['FacilityLongitude'])
    except: continue
    if not US(la,lo): continue
    fid=r['FacilityID']; url=f'https://www.recreation.gov/camping/campgrounds/{fid}'
    p=dict(id='ridb:'+fid,name=r['FacilityName'].title(),lat=round(la,5),lon=round(lo,5),
           city=addr.get(fid,('',''))[0],state=addr.get(fid,('',''))[1],operator='federal (Recreation.gov)',
           url=url,phone=r['FacilityPhone'],facts=[],inferences=[],sources=['RIDB'])
    c=pets.get(fid)
    if c:
        y=sum(v for k,v in c.items() if k.lower() in('yes','domestic','true')); n=sum(v for k,v in c.items() if k.lower() in('no','false'))
        q=f"RIDB campsite attribute 'Pets Allowed': " + ', '.join(f'{k}={v} sites' for k,v in c.most_common())
        up=lastsite[fid] or r['LastUpdatedDate']
        if y and not n: p['facts'].append(dict(field='pets_allowed',value=True,quote=q,source='RIDB bulk export',source_url=url,source_updated=up,retrieved=TODAY,extractor='api',confidence=conf(.9,1,fresh(up))))
        elif n and not y: p['facts'].append(dict(field='pets_allowed',value=False,quote=q,source='RIDB bulk export',source_url=url,source_updated=up,retrieved=TODAY,extractor='api',confidence=conf(.9,1,fresh(up))))
        elif y and n:
            p['facts'].append(dict(field='pets_allowed',value='some sites',quote=q,source='RIDB bulk export',source_url=url,source_updated=up,retrieved=TODAY,extractor='api',confidence=conf(.9,1,fresh(up))))
    p['facts']+=text_facts(clean(r['FacilityDescription']),url,'RIDB facility description',1.0,r['LastUpdatedDate'])
    parks[p['id']]=p
# ---------- NPS ----------
print('NPS...',file=sys.stderr)
for d in json.load(open(f'{R}/nps.json'))['data']:
    try: la,lo=float(d['latitude']),float(d['longitude'])
    except: continue
    url=d.get('regulationsurl') or d['url'] or f"https://www.nps.gov/{d['parkCode']}/"
    a=(d.get('addresses') or [{}])[0]
    p=dict(id='nps:'+d['id'],name=d['name'],lat=round(la,5),lon=round(lo,5),city=a.get('city',''),state=a.get('stateCode',''),
           operator=f"National Park Service ({d['parkCode'].upper()})",url=d['url'] or url,phone='',facts=[],inferences=[],sources=['NPS'])
    txt=clean(' '.join([d.get('regulationsOverview',''),d.get('description',''),d.get('accessibility',{}).get('additionalInfo','')]))
    p['facts']=text_facts(txt,url,'NPS campground regulations/description',1.0,(d.get('lastIndexedDate') or '')[:10])
    parks[p['id']]=p
# ---------- OSM ----------
print('OSM...',file=sys.stderr)
def pts(fn):
    for e in json.load(open(f'{R}/{fn}.json'))['elements']:
        c=e.get('center',e); 
        if 'lat' in c: yield e,c['lat'],c['lon']
osm_camps=0
for e,la,lo in pts('camps'):
    t=e.get('tags',{})
    if t.get('access') in('private','no') or t.get('backcountry')=='yes' or t.get('camp_site')=='pitch': continue
    if not US(la,lo): continue
    osm_camps+=1
    url=f"https://www.openstreetmap.org/{e['type']}/{e['id']}"
    p=dict(id=f"osm:{e['type'][0]}{e['id']}",name=t.get('name') or ('Unnamed RV park' if t.get('tourism')=='caravan_site' else 'Unnamed campground'),
           lat=round(la,5),lon=round(lo,5),city=t.get('addr:city',''),state=t.get('addr:state',''),
           operator=t.get('operator','')+(' (OSM)' if t.get('operator') else 'OSM'),url=t.get('website') or url,phone=t.get('phone',''),
           facts=[],inferences=[],sources=['OSM'],kind=t.get('tourism'))
    c=conf(.6,1,.85)
    for k in('dog','pets'):
        v=t.get(k)
        if v: p['facts'].append(dict(field='pets_allowed',value=(v!='no') if v!='leashed' else True,quote=f'OSM tag {k}={v}',source='OpenStreetMap',source_url=url,source_updated=None,retrieved=TODAY,extractor='api',confidence=c))
        if v=='leashed': p['facts'].append(dict(field='leash_rule',value='leash required',quote=f'OSM tag {k}={v}',source='OpenStreetMap',source_url=url,source_updated=None,retrieved=TODAY,extractor='api',confidence=c))
    for k in('description','note'):
        if t.get(k): p['facts']+=text_facts(t[k],url,'OSM '+k,.6,None)
    parks[p['id']]=p
# ---------- dedupe: OSM point within 300 m of RIDB/NPS -> merge (INFERENCE that they're the same park) ----------
g=collections.defaultdict(list)
for p in parks.values():
    if not p['id'].startswith('osm:'): g[(round(p['lat']*100),round(p['lon']*100))].append(p)
def hav(a,b,c,d):
    a,b,c,d=map(math.radians,(a,b,c,d)); return 6371*2*math.asin(math.sqrt(math.sin((c-a)/2)**2+math.cos(a)*math.cos(c)*math.sin((d-b)/2)**2))
merged=0
for pid in [k for k in parks if k.startswith('osm:')]:
    o=parks[pid]; best=None
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for q in g.get((round(o['lat']*100)+dx,round(o['lon']*100)+dy),[]):
                dd=hav(o['lat'],o['lon'],q['lat'],q['lon'])
                if dd<.3 and (best is None or dd<best[0]): best=(dd,q)
    if best:
        q=best[1]; q['facts']+=o['facts']; q['sources'].append('OSM'); q['osm']=pid; merged+=1
        if not q['state'] and o['state']: q['state']=o['state']
        if not q['phone']: q['phone']=o['phone']
        q['inferences'].append(dict(field='same_place',value=pid,rule=f'OSM feature within {int(best[0]*1000)} m treated as same park',confidence=.7))
        del parks[pid]
# ---------- nearby vets & dog parks ----------
def grid(fn,step=.5):
    G=collections.defaultdict(list); n=0
    for e,la,lo in pts(fn):
        t=e.get('tags',{}); n+=1
        G[(int(la//step),int(lo//step))].append((la,lo,t.get('name','Unnamed'),t.get('phone') or t.get('contact:phone',''),f"https://www.openstreetmap.org/{e['type']}/{e['id']}"))
    return G,n
VG,nv=grid('vets'); DG,nd=grid('dogparks')
def nearest(G,la,lo,maxkm,step=.5):
    best=None
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for v in G.get((int(la//step)+dx,int(lo//step)+dy),[]):
                d=hav(la,lo,v[0],v[1])
                if d<=maxkm and (best is None or d<best[0]): best=(d,v)
    return best
# ---------- inferences + conflicts ----------
queue=[]
for p in parks.values():
    v=nearest(VG,p['lat'],p['lon'],40)
    if v: p['vet']=dict(name=v[1][2],phone=v[1][3],km=round(v[0],1),url=v[1][4],source='OpenStreetMap amenity=veterinary',retrieved=TODAY)
    d=nearest(DG,p['lat'],p['lon'],1.0)
    if d: p['inferences'].append(dict(field='off_leash_area',value=True,rule=f"OSM leisure=dog_park '{d[1][2]}' {int(d[0]*1000)} m away (may be outside park)",source_url=d[1][4],confidence=.5))
    pa={json.dumps(f['value']) for f in p['facts'] if f['field']=='pets_allowed'}
    if 'true' in pa and 'false' in pa:
        queue.append(dict(park_id=p['id'],name=p['name'],field='pets_allowed',kind='contradiction',facts=[f for f in p['facts'] if f['field']=='pets_allowed'],status='open'))
    br=[f for f in p['facts'] if f['field']=='breed_restrictions']
    if br: queue.append(dict(park_id=p['id'],name=p['name'],field='breed_restrictions',kind='breed_keyword_needs_review',facts=br,status='open'))
    if br and 'true' in pa and any('welcome' in f['quote'].lower() for f in p['facts'] if f['field']=='pets_allowed'):
        queue.append(dict(park_id=p['id'],name=p['name'],field='breed_restrictions',kind='contradiction',note="'welcome' vs breed restriction",facts=br,status='open'))
    mp={f['value'] for f in p['facts'] if f['field']=='max_pets'}
    if len(mp)>1: queue.append(dict(park_id=p['id'],name=p['name'],field='max_pets',kind='contradiction',facts=[f for f in p['facts'] if f['field']=='max_pets'],status='open'))
    for f in p['facts']:
        if f['source_updated'] and fresh(f['source_updated'])<=.6:
            queue.append(dict(park_id=p['id'],name=p['name'],field=f['field'],kind='stale',note=f"source updated {f['source_updated']}",facts=[f],status='open')); break
    # corroboration: same value from 2 independent sources
    by=collections.defaultdict(set)
    for f in p['facts']:
        if f['field']=='pets_allowed': by[json.dumps(f['value'])].add(f['source'].split()[0])
    for f in p['facts']:
        if f['field']=='pets_allowed' and len(by[json.dumps(f['value'])])>1: f['confidence']=round(min(1,f['confidence']*1.15),2)
    held={x['field'] for x in queue if x['park_id']==p['id'] and x['kind']=='contradiction'}
    for f in p['facts']:
        if f['field'] in held: f['confidence']=round(f['confidence']*.5,2)
    p['status']='held' if held else 'published'
    p['has_pet_data']=bool(p['facts'])
# ---------- write: tiles of 2 degrees ----------
tiles=collections.defaultdict(list)
for p in parks.values(): tiles[f"{int(p['lat']//2)}_{int(p['lon']//2)}"].append(p)
os.makedirs(f'{OUT}/tiles',exist_ok=True)
for k,v in tiles.items(): json.dump(v,open(f'{OUT}/tiles/{k}.json','w'),separators=(',',':'))
json.dump(queue,open('/workspace/petpark/review_queue.json','w'),indent=1)
stats=dict(built=TODAY,parks=len(parks),ridb=sum(p['id'].startswith('ridb') for p in parks.values()),nps=sum(p['id'].startswith('nps') for p in parks.values()),
  osm_only=sum(p['id'].startswith('osm') for p in parks.values()),osm_campsites_raw=osm_camps,osm_merged_into_gov=merged,vets=nv,dog_parks=nd,
  with_pet_facts=sum(p['has_pet_data'] for p in parks.values()),unknown=sum(not p['has_pet_data'] for p in parks.values()),
  with_vet_40km=sum('vet' in p for p in parks.values()),held=sum(p['status']=='held' for p in parks.values()),review_queue=len(queue),
  review_by_kind=dict(collections.Counter(x['kind'] for x in queue)),
  facts_by_field=dict(collections.Counter(f['field'] for p in parks.values() for f in p['facts'])),tiles=sorted(tiles))
json.dump(stats,open(f'{OUT}/stats.json','w'),indent=1)
# D1 SQL
with open('/workspace/petpark/d1_seed.sql','w') as s:
    s.write(open('/workspace/petpark/schema.sql').read()+'\n')
    e=lambda x:"NULL" if x is None else "'"+str(x).replace("'","''")+"'"
    for p in parks.values():
        s.write(f"INSERT INTO parks VALUES({e(p['id'])},{e(p['name'])},{p['lat']},{p['lon']},{e(p['state'])},{e(p['operator'])},{e(p['url'])},{e(p['status'])});\n")
        for f in p['facts']: s.write(f"INSERT INTO policy_facts(park_id,field,value_json,source,source_url,source_quote,source_updated,last_verified,extractor,confidence) VALUES({e(p['id'])},{e(f['field'])},{e(json.dumps(f['value']))},{e(f['source'])},{e(f['source_url'])},{e(f['quote'])},{e(f['source_updated'])},{e(f['retrieved'])},{e(f['extractor'])},{f['confidence']});\n")
        for f in p['inferences']: s.write(f"INSERT INTO policy_inferences(park_id,field,value_json,rule,confidence) VALUES({e(p['id'])},{e(f['field'])},{e(json.dumps(f['value']))},{e(f['rule'])},{f['confidence']});\n")
print(json.dumps({k:v for k,v in stats.items() if k!='tiles'},indent=1))

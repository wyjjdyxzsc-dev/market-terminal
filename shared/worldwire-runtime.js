(function (root, factory) {
  const api = factory(root.MarketTerminalWorldwire || (typeof require === 'function' && require('./worldwire-core.js')));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalWorldwireRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const KEY = 'worldwire:state:v1';
  const HEARTBEAT_KEY = 'worldwire:cron:last-attempt';
  const QUERIES = [
    '(earthquake OR flood OR wildfire OR storm OR volcano)',
    '(war OR missile OR drone OR sanctions OR ceasefire)',
    '(oil OR gas OR opec OR tanker OR shipping OR port)',
    '(semiconductor OR cyberattack OR artificial intelligence OR telecom)',
    '(inflation OR central bank OR tariff OR ipo OR airline OR breakthrough)'
  ];
  async function getJson(url, options={}) {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const res=await fetch(url,{...options,signal:controller.signal});
      if (!res.ok) { const e=new Error('HTTP '+res.status); e.kind=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH':'SOURCE_DOWN'; throw e; }
      const contentType=res.headers.get('content-type')||'';
      if (Number(res.headers.get('content-length'))>4_000_000) throw Object.assign(new Error('Source response exceeds bound'),{kind:'SCHEMA_CHANGE'});
      const reader=res.body?.getReader(); let body='';
      if (reader) {
        const decoder=new TextDecoder(); let bytes=0;
        while (true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>4_000_000) { await reader.cancel(); throw Object.assign(new Error('Source response exceeds bound'),{kind:'SCHEMA_CHANGE'}); } body+=decoder.decode(value,{stream:true}); }
        body+=decoder.decode();
      } else body=await res.text();
      // EONET currently sends JSON bytes with application/rss+xml. Validate bytes
      // and schema rather than trusting that incorrect header or an HTML error page.
      if ((!/json|rss\+xml/i.test(contentType))||!/^\s*[{[]/.test(body)) { const e=new Error('Non-JSON source response'); e.kind='PARSER'; throw e; }
      let json; try { json=JSON.parse(body); } catch { const e=new Error('Invalid JSON source response'); e.kind='PARSER'; throw e; }
      if (!json||typeof json!=='object') { const e=new Error('Invalid source schema'); e.kind='SCHEMA_CHANGE'; throw e; } return json;
    } catch(e) { if (e.name==='AbortError') e.kind='TIMEOUT'; throw e; }
    finally { clearTimeout(timer); }
  }
  function gdeltDate(value) { const s=String(value||''); return /^\d{14}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`:value; }
  function gdelt(j) {
    if (!Array.isArray(j.articles)) throw Object.assign(new Error('GDELT article schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.articles.slice(0,250).map(a=>({provider:'GDELT',sourceName:a.domain||'GDELT article',sourceUrl:a.url,title:a.title,publishedAt:gdeltDate(a.seendate),language:a.language,sourceCountry:a.sourcecountry,rawCategories:[]}));
  }
  const USGS_COUNTRIES={Argentina:'AR',Australia:'AU',Brazil:'BR',Canada:'CA',Chile:'CL',China:'CN',Colombia:'CO',Greece:'GR',India:'IN',Indonesia:'ID',Iran:'IR',Italy:'IT',Japan:'JP',Mexico:'MX',Nepal:'NP','New Zealand':'NZ',Pakistan:'PK',Peru:'PE',Philippines:'PH',Russia:'RU',Taiwan:'TW',Tonga:'TO',Turkey:'TR',Ukraine:'UA','United States':'US'};
  function usgsCountry(place) { return USGS_COUNTRIES[String(place||'').split(',').at(-1)?.trim()]||null; }
  function usgs(j) {
    if (j.type!=='FeatureCollection'||!Array.isArray(j.features)) throw Object.assign(new Error('USGS schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.features.filter(f=>Number(f.properties?.mag)>=3).slice(0,300).map(f=>({provider:'USGS',officialId:f.id,sourceName:'USGS Earthquake Hazards Program',sourceUrl:f.properties?.url,title:`M${Number(f.properties.mag).toFixed(1)} earthquake — ${f.properties?.place||'location unreported'}`,publishedAt:f.properties?.time,updatedAt:f.properties?.updated,country:usgsCountry(f.properties?.place),region:f.properties?.place,magnitude:f.properties?.mag,geo:f.geometry?.type==='Point'?{lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}:null,rawCategories:['CLIMATE_NATURAL_DISASTERS']}));
  }
  function eonet(j) {
    if (!Array.isArray(j.events)) throw Object.assign(new Error('EONET schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.events.slice(0,300).map(e=>{ const g=e.geometry?.at(-1), source=e.sources?.[0]?.url||e.link; return {provider:'EONET',officialId:e.id,sourceName:'NASA EONET',sourceUrl:source,title:e.title,publishedAt:g?.date,updatedAt:g?.date,geo:g?.type==='Point'&&Array.isArray(g.coordinates)?{lat:g.coordinates[1],lon:g.coordinates[0]}:null,rawCategories:['CLIMATE_NATURAL_DISASTERS']}; });
  }
  function nws(j) {
    if (j.type!=='FeatureCollection'||!Array.isArray(j.features)) throw Object.assign(new Error('NWS schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.features.filter(f=>!/test|exercise|demo/i.test(String(f.properties?.event||''))).slice(0,250).map(f=>{ const p=f.properties||{}; let geo=null; if (f.geometry?.type==='Polygon'&&Array.isArray(f.geometry.coordinates?.[0])) { const points=f.geometry.coordinates[0]; if (points.length) geo={lat:points.reduce((n,p)=>n+p[1],0)/points.length,lon:points.reduce((n,p)=>n+p[0],0)/points.length}; } return {provider:'NWS',officialId:p.id||f.id,sourceName:'National Weather Service',sourceUrl:p['@id']||p.id,title:p.headline||`${p.event||'Weather alert'} — ${p.areaDesc||'United States'}`,publishedAt:p.sent||p.effective,updatedAt:p.updated||p.sent,country:'US',region:p.areaDesc,severity:p.severity,geo,rawCategories:['CLIMATE_NATURAL_DISASTERS']}; });
  }
  const ADAPTERS={USGS:()=>getJson(core.SOURCES.USGS.url).then(usgs),EONET:()=>getJson(core.SOURCES.EONET.url).then(eonet),NWS:()=>getJson(core.SOURCES.NWS.url,{headers:{'User-Agent':'MarketTerminal/1.0 (market-terminal contact via GitHub repository)','Accept':'application/geo+json'}}).then(nws),GDELT:async(now=new Date().toISOString())=>{ const q=QUERIES[Math.floor(Date.parse(now)/3600000)%QUERIES.length]; return gdelt(await getJson(`${core.SOURCES.GDELT.url}?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=250&timespan=6h`)); }};
  function makeRefs(atlasCore,atlasSnapshot,nexusSnapshot,launchpadSnapshot) {
    const companies=(nexusSnapshot.companies||[]).filter(c=>c.name?.length>=6);
    const alias=c=>c.name.replace(/\b(incorporated|corporation|corp|inc|limited|ltd|plc|company|co)\.?$/i,'').trim();
    const counts=new Map(); for(const c of companies){const a=alias(c).toLowerCase();counts.set(a,(counts.get(a)||0)+1);}
    const nexus=companies.map(c=>({...c,alias:alias(c),aliasUnique:counts.get(alias(c).toLowerCase())===1}));
    const atlas=atlasCore.buildFromSnapshot(atlasSnapshot).entities.filter(e=>e.authoritative&&['PORT','SHIPPING_CHOKEPOINT','REFINERY','POWER_PLANT','AIRPORT','NUCLEAR_PLANT'].includes(e.type));
    const index=items=>{const out=new Map();for(const item of items){const words=item.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]{3,}/gu)||[];const key=words.find(w=>!['the','new','and','for','with'].includes(w));if(!key)continue;const list=out.get(key)||[];list.push(item);out.set(key,list);}return out;};
    return {atlas,atlasIndex:index(atlas),nexus,nexusIndex:index(nexus),launchpad:[...(launchpadSnapshot.markets?.IN?.records||[]),...(launchpadSnapshot.markets?.US?.records||[])]};
  }
  async function run(storage,refs={},now=new Date().toISOString()) {
    const previous=await storage.get(KEY)||{events:[],metrics:{},health:{}};
    let health=previous.health||{}, signals=[]; const sourceResults={};
    for (const [provider,fetcher] of Object.entries(ADAPTERS)) {
      const state=health[provider]; if (state?.nextAttemptAt&&Date.parse(state.nextAttemptAt)>Date.parse(now)) { sourceResults[provider]='BACKOFF'; continue; }
      const started=Date.now();
      try { const rows=await fetcher(now); if (!rows.length&&provider==='USGS') throw Object.assign(new Error('Implausible empty USGS day feed'),{kind:'SCHEMA_CHANGE'}); signals.push(...rows); health=core.health(health,provider,true,rows.length,null,now,Date.now()-started); sourceResults[provider]=rows.length; }
      catch(e) { health=core.health(health,provider,false,0,e.kind||'NETWORK',now,Date.now()-started); sourceResults[provider]=e.kind||'NETWORK'; }
    }
    const next=core.ingest(previous,signals,refs,now); next.health=health; next.sourceResults=sourceResults;
    if (!signals.length) next.lastIngestAt=previous.lastIngestAt||null;
    next.totals={duplicatesSuppressed:(previous.totals?.duplicatesSuppressed||0)+next.metrics.duplicatesSuppressed,clustersCreated:(previous.totals?.clustersCreated||0)+next.metrics.clustersCreated,materialUpdates:(previous.totals?.materialUpdates||0)+next.metrics.materialUpdates};
    if (signals.length||!previous.events?.length) await storage.put(KEY,next);
    else { next.events=previous.events; await storage.put(KEY,next); }
    return next;
  }
  function respond(path,store,params={}) {
    const safe=store||{events:[],health:{},metrics:{},totals:{},lastIngestAt:null};
    if (path.endsWith('/sources')) return {sources:core.SOURCES};
    if (path.endsWith('/categories')) return {categories:core.CATEGORIES};
    if (path.endsWith('/health')) return {health:safe.health||{},lastIngestAt:safe.lastIngestAt||null,scheduledAttempt:safe.scheduledAttempt||null};
    if (path.endsWith('/coverage')) {
      const events=safe.events||[], within24=events.filter(e=>Date.now()-Date.parse(e.lastObservedAt)<86400000);
      const regions=[...new Set(events.flatMap(e=>e.regions))], categories=[...new Set(events.flatMap(e=>e.categories))];
      return {coverage:'MAXIMUM PRACTICAL CONNECTED-SOURCE COVERAGE',sourceCount:Object.values(core.SOURCES).filter(s=>s.enabled).length,sourceHealth:Object.fromEntries(Object.entries(safe.health||{}).map(([name,h])=>[name,h.status])),regions:regions.slice(0,100),regionCount:regions.length,languages:[...new Set(events.flatMap(e=>e.sourceSignals.map(s=>s.language)))],categories,categoryCounts:Object.fromEntries(categories.map(c=>[c,events.filter(e=>e.categories.includes(c)).length])),events24h:within24.length,clusters24h:events.filter(e=>Date.now()-Date.parse(e.firstObservedAt)<86400000).length,signals24h:events.flatMap(e=>e.sourceSignals).filter(s=>Date.now()-Date.parse(s.observedAt)<86400000).length,lastRunMetrics:safe.metrics||{},duplicatesSuppressed:safe.totals?.duplicatesSuppressed||0,clustersCreated:safe.totals?.clustersCreated||0,materialUpdates:safe.totals?.materialUpdates||0,lastIngestAt:safe.lastIngestAt||null,failedSources:Object.entries(safe.health||{}).filter(([,h])=>h.status==='FAILED').map(([name])=>name),retention:core.RETENTION,archivedMaterialEvents:safe.archive?.length||0};
    }
    if (path.endsWith('/event')) return {event:(safe.events||[]).find(e=>e.id===params.id)||null};
    if (path.endsWith('/changes')) return {changes:(safe.events||[]).flatMap(e=>(e.updates||[]).map(u=>({eventId:e.id,...u}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,Math.min(50,Math.max(1,Number(params.limit)||25)))};
    return core.query(safe,params);
  }
  function geoEvents(store,atlasCore,now=Date.now()) {
    const out=[];
    for (const e of (store?.events||[])) {
      const g=e.geo?.[0]; if (!g||!Number.isFinite(g.lat)||!Number.isFinite(g.lon)) continue;
      const signal=e.sourceSignals?.find(s=>s.geo&&s.sourceUrl); if (!signal) continue;
      const title=e.title.toLowerCase();
      const type=/earthquake|quake/.test(title)?'EARTHQUAKE':/flood/.test(title)?'FLOOD':/fire/.test(title)?'WILDFIRE':/storm|hurricane|typhoon|cyclone|weather/.test(title)?'STORM':/volcano/.test(title)?'VOLCANO':e.categories.includes('WAR_SECURITY')?'WAR':'OTHER';
      try { out.push(atlasCore.createGeoEvent({id:'event:worldwire:'+e.id,type,title:e.title,location:{lat:g.lat,lon:g.lon,name:e.regions[0]||e.countries[0]||''},startedAt:e.occurredAt||e.firstObservedAt,updatedAt:e.updatedAt,sourceEvidence:[{source:signal.sourceName,sourceUrl:signal.sourceUrl,confidence:signal.credibilityClass==='PRIMARY_OFFICIAL'?'HIGH':'MEDIUM',observedAt:signal.observedAt,lastVerified:signal.lastVerified||null}],attributes:{worldwireId:e.id,materiality:e.materiality,urgency:e.urgency,coordinateKind:signal.provider==='NWS'?'OFFICIAL_POLYGON_CENTROID':'SOURCE_POINT'}},now)); } catch { /* invalid coordinates/evidence never map */ }
    }
    return out.slice(0,600);
  }
  function mergeGeoEvents(legacy,worldwireEvents) {
    const recent=worldwireEvents||[];
    const unique=(legacy||[]).filter(x=>!recent.some(y=>x.type===y.type&&Math.abs(x.location.lat-y.location.lat)<0.03&&Math.abs(x.location.lon-y.location.lon)<0.03&&Math.abs(Date.parse(x.startedAt)-Date.parse(y.startedAt))<3600000));
    return [...recent,...unique].slice(0,800);
  }
  return Object.freeze({KEY,HEARTBEAT_KEY,QUERIES,ADAPTERS,gdelt,usgs,eonet,nws,makeRefs,run,respond,geoEvents,mergeGeoEvents});
});

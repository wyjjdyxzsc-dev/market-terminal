(function (root, factory) {
  const api = factory(root.MarketTerminalWorldwire || (typeof require === 'function' && require('./worldwire-core.js')));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalWorldwireRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const KEY = 'worldwire:state:v1';
  const HEARTBEAT_KEY = 'worldwire:cron:last-attempt';
  const GDELT_ADAPTER_VERSION='GAL_RSS_2026-09-26';
  async function getRss(url) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const res=await fetch(url,{signal:controller.signal});
      if(!res.ok) throw Object.assign(new Error('HTTP '+res.status),{kind:res.status===429?'RATE_LIMIT':'SOURCE_DOWN'});
      if(!/xml|rss/i.test(res.headers.get('content-type')||'')) throw Object.assign(new Error('Non-RSS source response'),{kind:'PARSER'});
      if(Number(res.headers.get('content-length'))>4_000_000) throw Object.assign(new Error('Source response exceeds bound'),{kind:'SCHEMA_CHANGE'});
      const reader=res.body?.getReader(); if(!reader) throw Object.assign(new Error('Missing RSS body'),{kind:'PARSER'});
      const decoder=new TextDecoder(); let body='',bytes=0;
      while(true){ const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>4_000_000){await reader.cancel();throw Object.assign(new Error('Source response exceeds bound'),{kind:'SCHEMA_CHANGE'});} body+=decoder.decode(value,{stream:true}); }
      return body+decoder.decode();
    } catch(e){if(e.name==='AbortError')e.kind='TIMEOUT';throw e;}
    finally{clearTimeout(timer);}
  }
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
  function xmlText(s) { return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,x)=>{if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x.toLowerCase()]||'';}); }
  const EVENT_ACTION=/\b(killed|injured|strik(?:e|es|ing)|struck|attack(?:s|ed)?|bombed|bombing|earthquake|quake|wildfire|hurricane|typhoon|cyclone|tsunami|erupts?|explosion|outage|blackout|ceasefire|flood(?:s|ed|ing)?|collapses?|collapsed|announces?|announced|approves?|approved|rejects?|rejected|launches?|launched|files?|filed|delays?|delayed|withdraws?|withdrawn|disrupts?|disrupted|disruption|shutdown|closes?|closed|reopens?|reopened|breaches?|breached|hacks?|hacked|discovers?|discovered|acquires?|acquired|merges?|merged|takeover|raises?|cuts?|hikes?|slashes?|falls?|drops?|surges?|rises?|declines?|defaults?|halts?|cancels?|suspends?|resumes?|signs?|agrees?|passes?|votes?|wins?|loses?|pricing|warns?|warned|proposes?|proposed|succeeds?|succeeded)\b/i;
  function galRss(body,now=new Date().toISOString()) {
    if(!/^\s*<\?xml\b/i.test(body)||!/<rss\b/i.test(body)||!/<channel\b/i.test(body)||!/<\/rss>\s*$/i.test(body)) throw Object.assign(new Error('GDELT GAL RSS schema changed'),{kind:'SCHEMA_CHANGE'});
    const built=/<lastBuildDate>([^<]+)<\/lastBuildDate>/i.exec(body)?.[1];
    if(!built||!Number.isFinite(Date.parse(built))||Math.abs(Date.parse(now)-Date.parse(built))>90*60000) throw Object.assign(new Error('GDELT GAL feed stale'),{kind:'SOURCE_DOWN'});
    const rows=[],seenUrls=new Set(),itemRe=/<item>([\s\S]*?)<\/item>/gi; let item,itemCount=0;
    const field=(s,name)=>xmlText(new RegExp('<'+name+'>([\\s\\S]*?)<\\/'+name+'>','i').exec(s)?.[1]);
    while((item=itemRe.exec(body))!==null){
      itemCount++; const title=field(item[1],'title'),sourceUrl=field(item[1],'link'),observedAt=field(item[1],'pubDate');
      const signal=core.normalizeSignal({provider:'GDELT',sourceUrl,title,observedAt},now);
      if(!signal||!signal.categories.some(c=>!['INDIA','UNITED_STATES','SECOND_ORDER_EFFECTS'].includes(c))||!EVENT_ACTION.test(title)||seenUrls.has(signal.id)) continue;
      seenUrls.add(signal.id);
      rows.push({provider:'GDELT',sourceName:new URL(signal.sourceUrl).hostname.replace(/^www\./,'')+' via GDELT',sourceUrl:signal.sourceUrl,title,publishedAt:null,observedAt,language:'und',rawCategories:[]});
      if(rows.length>=250) break;
    }
    if(!itemCount) throw Object.assign(new Error('Empty GDELT GAL feed'),{kind:'SCHEMA_CHANGE'});
    return rows;
  }
  const USGS_COUNTRIES={Argentina:'AR',Australia:'AU',Brazil:'BR',Canada:'CA',Chile:'CL',China:'CN',Colombia:'CO',Greece:'GR',India:'IN',Indonesia:'ID',Iran:'IR',Italy:'IT',Japan:'JP',Mexico:'MX',Nepal:'NP','New Zealand':'NZ',Pakistan:'PK',Peru:'PE',Philippines:'PH',Russia:'RU',Taiwan:'TW',Tonga:'TO',Turkey:'TR',Ukraine:'UA','United States':'US'};
  function usgsCountry(place) { return USGS_COUNTRIES[String(place||'').split(',').at(-1)?.trim()]||null; }
  function usgs(j) {
    if (j.type!=='FeatureCollection'||!Array.isArray(j.features)) throw Object.assign(new Error('USGS schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.features.filter(f=>Number(f.properties?.mag)>=3).slice(0,300).map(f=>({provider:'USGS',officialId:f.id,sourceName:'USGS Earthquake Hazards Program',sourceUrl:f.properties?.url,title:`M${Number(f.properties.mag).toFixed(1)} earthquake — ${f.properties?.place||'location unreported'}`,publishedAt:f.properties?.time,updatedAt:f.properties?.updated,country:usgsCountry(f.properties?.place),region:f.properties?.place,magnitude:f.properties?.mag,geo:f.geometry?.type==='Point'?{lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}:null,rawCategories:['CLIMATE_NATURAL_DISASTERS']}));
  }
  function eonet(j) {
    if (!Array.isArray(j.events)) throw Object.assign(new Error('EONET schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.events.slice(0,300).map(e=>{ const g=e.geometry?.at(-1), officialUrl=e.link, linkedSource=e.sources?.[0]?.url; return {provider:'EONET',officialId:e.id,sourceName:officialUrl?'NASA EONET':'EONET linked source',sourceUrl:officialUrl||linkedSource,title:e.title,publishedAt:g?.date,updatedAt:g?.date,geo:g?.type==='Point'&&Array.isArray(g.coordinates)?{lat:g.coordinates[1],lon:g.coordinates[0]}:null,rawCategories:['CLIMATE_NATURAL_DISASTERS']}; });
  }
  function nws(j) {
    if (j.type!=='FeatureCollection'||!Array.isArray(j.features)) throw Object.assign(new Error('NWS schema changed'),{kind:'SCHEMA_CHANGE'});
    return j.features.filter(f=>!/test|exercise|demo/i.test(String(f.properties?.event||''))).slice(0,250).map(f=>{ const p=f.properties||{}; let geo=null; if (f.geometry?.type==='Polygon'&&Array.isArray(f.geometry.coordinates?.[0])) { const points=f.geometry.coordinates[0]; if (points.length) geo={lat:points.reduce((n,p)=>n+p[1],0)/points.length,lon:points.reduce((n,p)=>n+p[0],0)/points.length}; } return {provider:'NWS',officialId:p.id||f.id,sourceName:'National Weather Service',sourceUrl:p['@id']||p.id,title:p.headline||`${p.event||'Weather alert'} — ${p.areaDesc||'United States'}`,publishedAt:p.sent||p.effective,updatedAt:p.updated||p.sent,country:'US',region:p.areaDesc,severity:p.severity,geo,rawCategories:['CLIMATE_NATURAL_DISASTERS']}; });
  }
  const ADAPTERS={USGS:()=>getJson(core.SOURCES.USGS.url).then(usgs),EONET:()=>getJson(core.SOURCES.EONET.url).then(eonet),NWS:()=>getJson(core.SOURCES.NWS.url,{headers:{'User-Agent':'MarketTerminal/1.0 (market-terminal contact via GitHub repository)','Accept':'application/geo+json'}}).then(nws),GDELT:(now)=>getRss(core.SOURCES.GDELT.url).then(body=>galRss(body,now))};
  function makeRefs(atlasCore,atlasSnapshot,nexusSnapshot,launchpadSnapshot) {
    const companies=(nexusSnapshot.companies||[]).filter(c=>c.name?.length>=6);
    const alias=c=>c.name.replace(/\b(incorporated|corporation|corp|inc|limited|ltd|plc|company|co)\.?$/i,'').trim();
    const counts=new Map(); for(const c of companies){const a=alias(c).toLowerCase();counts.set(a,(counts.get(a)||0)+1);}
    const nexus=companies.map(c=>({...c,alias:alias(c),aliasUnique:counts.get(alias(c).toLowerCase())===1}));
    const atlas=atlasCore.buildFromSnapshot(atlasSnapshot).entities.filter(e=>e.authoritative&&['PORT','SHIPPING_CHOKEPOINT','REFINERY','POWER_PLANT','AIRPORT','NUCLEAR_PLANT'].includes(e.type));
    const index=items=>{const out=new Map();for(const item of items){const words=item.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]{3,}/gu)||[];const key=words.find(w=>!['the','new','and','for','with'].includes(w));if(!key)continue;const list=out.get(key)||[];list.push(item);out.set(key,list);}return out;};
    return {atlas,atlasIndex:index(atlas),nexus,nexusIndex:index(nexus),launchpad:[...(launchpadSnapshot.markets?.IN?.records||[]),...(launchpadSnapshot.markets?.US?.records||[])]};
  }
  async function run(storage,refs={},now=new Date().toISOString(),providers=null) {
    const previous=await storage.get(KEY)||{events:[],metrics:{},health:{}};
    let health=previous.health||{}, signals=[]; const sourceResults={};
    if(health.GDELT?.adapterVersion!==GDELT_ADAPTER_VERSION) health={...health,GDELT:{consecutiveFailures:0}};
    for (const [provider,fetcher] of Object.entries(ADAPTERS)) {
      if(providers&&!providers.includes(provider)) continue;
      const state=health[provider]; if (state?.nextAttemptAt&&Date.parse(state.nextAttemptAt)>Date.parse(now)) { sourceResults[provider]='BACKOFF'; continue; }
      const started=Date.now();
      try { const rows=await fetcher(now); if (!rows.length&&['USGS','GDELT'].includes(provider)) throw Object.assign(new Error('Implausible empty source feed'),{kind:'SCHEMA_CHANGE'}); signals.push(...rows); health=core.health(health,provider,true,rows.length,null,now,Date.now()-started); if(provider==='GDELT')health.GDELT.adapterVersion=GDELT_ADAPTER_VERSION; sourceResults[provider]=rows.length; }
      catch(e) { health=core.health(health,provider,false,0,e.kind||'NETWORK',now,Date.now()-started); if(provider==='GDELT')health.GDELT.adapterVersion=GDELT_ADAPTER_VERSION; sourceResults[provider]=e.kind||'NETWORK'; }
    }
    const next=core.ingest(previous,signals,refs,now); next.health=health; next.sourceResults=sourceResults;
    if (!signals.length) next.lastIngestAt=previous.lastIngestAt||null;
    next.totals={duplicatesSuppressed:(previous.totals?.duplicatesSuppressed||0)+next.metrics.duplicatesSuppressed,clustersCreated:(previous.totals?.clustersCreated||0)+next.metrics.clustersCreated,materialUpdates:(previous.totals?.materialUpdates||0)+next.metrics.materialUpdates};
    const history=previous.dailyMetrics?.length?previous.dailyMetrics:previous.lastIngestAt&&previous.metrics?[{at:previous.lastIngestAt,...previous.metrics}]:[];
    next.dailyMetrics=[...history,{at:now,...next.metrics}].filter(x=>Date.parse(now)-Date.parse(x.at)<86400000).slice(-96);
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
      const runs=(safe.dailyMetrics||[]).filter(x=>Date.now()-Date.parse(x.at)<86400000), sum=k=>runs.reduce((n,x)=>n+(Number(x[k])||0),0);
      return {coverage:'MAXIMUM PRACTICAL CONNECTED-SOURCE COVERAGE',sourceCount:Object.values(core.SOURCES).filter(s=>s.enabled).length,sourceHealth:Object.fromEntries(Object.entries(safe.health||{}).map(([name,h])=>[name,h.status])),regions:regions.slice(0,100),regionCount:regions.length,languages:[...new Set(events.flatMap(e=>e.sourceSignals.map(s=>s.language)))],categories,categoryCounts:Object.fromEntries(categories.map(c=>[c,events.filter(e=>e.categories.includes(c)).length])),events24h:within24.length,clusters24h:runs.length?sum('clustersCreated'):events.filter(e=>Date.now()-Date.parse(e.firstObservedAt)<86400000).length,signals24h:runs.length?sum('accepted'):events.flatMap(e=>e.sourceSignals).filter(s=>Date.now()-Date.parse(s.observedAt)<86400000).length,lastRunMetrics:safe.metrics||{},duplicatesSuppressed:safe.totals?.duplicatesSuppressed||0,clustersCreated:safe.totals?.clustersCreated||0,materialUpdates:safe.totals?.materialUpdates||0,lastIngestAt:safe.lastIngestAt||null,failedSources:Object.entries(safe.health||{}).filter(([,h])=>h.status==='FAILED').map(([name])=>name),retention:core.RETENTION,archivedMaterialEvents:safe.archive?.length||0};
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
  return Object.freeze({KEY,HEARTBEAT_KEY,ADAPTERS,galRss,usgs,eonet,nws,makeRefs,run,respond,geoEvents,mergeGeoEvents});
});

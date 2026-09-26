(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalWorldwire = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '2026-09-23a';
  const MAX_EVENTS = 1000;
  const MAX_SIGNALS = 12;
  const RETENTION = Object.freeze({hotEvents:1000,warmMaterialEvents:400,warmDays:90,seenSignalHours:48,seenSignalLimit:10000,archiveMetadataOnly:true});
  const CATEGORIES = Object.freeze(['GEOPOLITICS','WAR_SECURITY','ENERGY','TECHNOLOGY','MARITIME','HOSPITALITY_TRAVEL','BREAKTHROUGHS','SPACE_AEROSPACE','HEALTHCARE_BIOTECH','MACRO','CENTRAL_BANKS','FX_SOVEREIGN_DEBT','BANKING_CREDIT','COMMODITIES','AGRICULTURE_FOOD','CLIMATE_NATURAL_DISASTERS','SUPPLY_CHAINS','TRADE','REGULATION','DEFENSE','CYBER','AUTOMOTIVE','CONSUMER_RETAIL','REAL_ESTATE_CONSTRUCTION','MEDIA_ENTERTAINMENT','MA','IPO_CAPITAL_RAISING','EARNINGS_CORPORATE','LABOR','INFRASTRUCTURE','CRITICAL_MINERALS','WATER','NUCLEAR','DIGITAL_ASSETS','EMERGING_MARKETS','INDIA','UNITED_STATES','SECOND_ORDER_EFFECTS']);
  const SOURCES = Object.freeze({
    GDELT: { owner:'GDELT Project', url:'https://api.gdeltproject.org/api/v2/doc/doc', type:'news discovery', coverage:'global, multilingual sampled articles', freshness:'15-minute indexed cycles', auth:'none', license:'Public API; original publishers retain article rights', attribution:'GDELT discovery and original publisher link', limitations:'Search result sampling, uncertain publication metadata; article signal is not verified event fact', enabled:true },
    USGS: { owner:'US Geological Survey', url:'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', type:'official event feed', coverage:'global earthquakes', freshness:'frequent', auth:'none', license:'US government public domain', attribution:'USGS Earthquake Hazards Program', limitations:'Preliminary measurements may be revised', enabled:true },
    EONET: { owner:'NASA EONET', url:'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300', type:'official natural event aggregator', coverage:'global selected natural events', freshness:'source dependent', auth:'none', license:'NASA open data; linked source rights vary', attribution:'NASA EONET and linked source', limitations:'Open-event catalog is selective and not real-time for every hazard', enabled:true },
    NWS: { owner:'NOAA National Weather Service', url:'https://api.weather.gov/alerts/active', type:'official weather alerts', coverage:'United States only', freshness:'active alerts', auth:'none; descriptive User-Agent', license:'US government public domain', attribution:'National Weather Service', limitations:'US-only; polygon/zone coverage may lack a point', enabled:true },
    ACLED: { owner:'ACLED', url:'https://acleddata.com', type:'conflict events', coverage:'global', freshness:'unknown', auth:'required', license:'REQUIRES_OWNER_LICENSE_AUTHORIZATION', attribution:'ACLED', limitations:'Disabled; commercial usage needs owner authorization', enabled:false, reason:'REQUIRES_OWNER_LICENSE_AUTHORIZATION' }
  });
  const DICT = { terremoto:'earthquake', seisme:'earthquake', séisme:'earthquake', erdbeben:'earthquake', sismo:'earthquake', taiwan:'taiwan', taïwan:'taiwan', tremblement:'earthquake', gempa:'earthquake', seism:'earthquake', quake:'earthquake', hits:'strike', hit:'strike', strikes:'strike', struck:'strike', poderoso:'powerful', puissant:'powerful', hualien:'hualien' };
  const STOP = new Set(['the','a','an','in','on','at','near','of','to','and','for','with','from','after','as','by','is','are','new','latest','report','reports','says','powerful','major','live','update','updates','le','la','les','de','du','des','en','un','une','sur','el','en','un','una','del','y','der','die','das','und']);
  const RULES = [
    ['WAR_SECURITY',/\b(war|attack|missile|drone|battle|ceasefire|military|terror|strike on|bombing)\b/i],
    ['GEOPOLITICS',/\b(sanction|diplomat|election|territorial|government policy)\b/i],
    ['ENERGY',/\b(oil|brent|wti|opec|lng|natural gas|refiner|pipeline|electric grid|power outage)\b/i],
    ['TECHNOLOGY',/\b(artificial intelligence|semiconductor|chipmaker|cloud computing|robotic|quantum|telecom)\b/i],
    ['MARITIME',/\b(tanker|ship|shipping|port|strait|subsea|seabed|piracy|maritime)\b/i],
    ['HOSPITALITY_TRAVEL',/\b(hotel|tourism|airline|airport|cruise|casino|travel disruption)\b/i],
    ['BREAKTHROUGHS',/\b(breakthrough|discovery|clinical trial|new material|fusion milestone)\b/i],
    ['MACRO',/\b(inflation|gdp|employment|pmi|recession)\b/i],
    ['CENTRAL_BANKS',/\b(federal reserve|\bfed\b|\brbi\b|\becb\b|\bboj\b|central bank)\b/i],
    ['IPO_CAPITAL_RAISING',/\b(ipo|initial public offering|public issue|prospectus)\b/i],
    ['TRADE',/\b(tariff|export control|import restriction|trade dispute)\b/i],
    ['CYBER',/\b(cyberattack|ransomware|data breach)\b/i],
    ['SPACE_AEROSPACE',/\b(satellite launch|rocket launch|spacecraft|space station|aerospace|aircraft manufacturer)\b/i],
    ['HEALTHCARE_BIOTECH',/\b(biotech|drug approval|clinical trial|vaccine|medical device|pharmaceutical)\b/i],
    ['FX_SOVEREIGN_DEBT',/\b(exchange rate|currency devaluation|sovereign bond|sovereign debt|foreign exchange reserve)\b/i],
    ['BANKING_CREDIT',/\b(bank failure|banking crisis|credit rating downgrade|loan default|bank capital)\b/i],
    ['COMMODITIES',/\b(commodity supply|copper mine|gold mine|uranium mine|iron ore|rare earths|lithium mine)\b/i],
    ['AGRICULTURE_FOOD',/\b(crop failure|harvest|food shortage|grain export|wheat crop|corn crop|soybean crop)\b/i],
    ['SUPPLY_CHAINS',/\b(supply chain|supplier disruption|factory shutdown|component shortage|logistics bottleneck)\b/i],
    ['REGULATION',/\b(regulator|regulatory approval|regulatory ban|new regulation|compliance rule)\b/i],
    ['DEFENSE',/\b(defense contract|defence contract|weapons system|arms export|fighter jet)\b/i],
    ['AUTOMOTIVE',/\b(automaker|electric vehicle|ev battery|autonomous vehicle|car production)\b/i],
    ['CONSUMER_RETAIL',/\b(retail sales|consumer spending|store closure|consumer goods)\b/i],
    ['REAL_ESTATE_CONSTRUCTION',/\b(real estate|housing starts|property developer|construction project)\b/i],
    ['MEDIA_ENTERTAINMENT',/\b(streaming service|film studio|media merger|entertainment company)\b/i],
    ['MA',/\b(merger|acquisition|takeover bid|buyout offer)\b/i],
    ['EARNINGS_CORPORATE',/\b(earnings report|quarterly results|profit warning|revenue guidance)\b/i],
    ['LABOR',/\b(labor strike|labour strike|workers strike|labor shortage|layoffs)\b/i],
    ['INFRASTRUCTURE',/\b(bridge collapse|rail disruption|power grid|infrastructure project|port closure)\b/i],
    ['CRITICAL_MINERALS',/\b(critical mineral|rare earths|lithium mine|cobalt mine|nickel mine)\b/i],
    ['WATER',/\b(water shortage|water supply|reservoir|desalination|water treatment)\b/i],
    ['NUCLEAR',/\b(nuclear reactor|nuclear power|uranium enrichment|nuclear plant)\b/i],
    ['DIGITAL_ASSETS',/\b(bitcoin|cryptocurrency|crypto exchange|stablecoin|digital asset)\b/i],
    ['EMERGING_MARKETS',/\b(emerging markets|emerging market debt)\b/i],
    ['SECOND_ORDER_EFFECTS',/\b(second.order effect|knock.on effect|downstream disruption)\b/i],
    ['CLIMATE_NATURAL_DISASTERS',/\b(earthquake|quake|storm|hurricane|typhoon|cyclone|flood|wildfire|volcano|drought)\b/i]
  ];
  const COMMODITIES = { BRENT:/\bbrent\b/i, WTI:/\bwti\b/i, NATURAL_GAS:/\b(natural gas|lng)\b/i, GOLD:/\bgold\b/i, SILVER:/\bsilver\b/i, COPPER:/\bcopper\b/i, URANIUM:/\buranium\b/i, LITHIUM:/\blithium\b/i, NICKEL:/\bnickel\b/i, COBALT:/\bcobalt\b/i, IRON_ORE:/\biron ore\b/i, ALUMINIUM:/\b(aluminium|aluminum)\b/i, RARE_EARTHS:/\brare earths?\b/i, WHEAT:/\bwheat\b/i, CORN:/\bcorn\b/i, SOY:/\bsoy(bean)?s?\b/i };
  function hash(s) { let h=2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619); } return (h>>>0).toString(36); }
  function validUrl(s) { try { const u=new URL(s); return /^https?:$/.test(u.protocol) && !/^(localhost|127\.|0\.|10\.|192\.168\.)/.test(u.hostname) ? u.toString() : null; } catch { return null; } }
  function canonicalUrl(s) { const url=validUrl(s); if (!url) return null; const u=new URL(url); u.hash=''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k); return u.toString().replace(/\/$/,''); }
  function iso(s) { const n=typeof s==='number'?s:Date.parse(s); return Number.isFinite(n) ? new Date(n).toISOString() : null; }
  function tokens(s) { return [...new Set(String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)?.map(w=>DICT[w]||w).filter(w=>w.length>2&&!STOP.has(w))||[])].sort(); }
  function categories(text, provider, raw=[]) { const out=new Set(); if (provider==='USGS'||provider==='EONET'||provider==='NWS') out.add('CLIMATE_NATURAL_DISASTERS'); for (const [cat,re] of RULES) if (re.test(text)) out.add(cat); if (/\bIndia(n)?\b/i.test(text)) out.add('INDIA'); if (/\b(United States|U\.S\.|US government)\b/i.test(text)) out.add('UNITED_STATES'); for (const r of raw) if (CATEGORIES.includes(r)) out.add(r); return [...out]; }
  function sourceClass(provider,url) { if(provider!=='GDELT') return 'PRIMARY_OFFICIAL'; const host=new URL(url).hostname.replace(/^www\./,''); return ['reuters.com','apnews.com','afp.com'].includes(host)?'MAJOR_WIRE':'UNKNOWN'; }
  function sourceSummary(signal) { return signal.provider==='GDELT'?`Unverified article signal from ${signal.sourceName}: ${signal.title}`:signal.title; }
  function normalizeSignal(raw, now=new Date().toISOString()) {
    if (!raw||!SOURCES[raw.provider]?.enabled) return null;
    const sourceUrl=canonicalUrl(raw.sourceUrl), title=String(raw.title||'').trim().slice(0,240);
    if (!sourceUrl||!title||/^<(!doctype|html)/i.test(title)) return null;
    const provider=raw.provider, publishedAt=iso(raw.publishedAt), observedAt=iso(raw.observedAt)||now;
    const coords=raw.geo && Number.isFinite(Number(raw.geo.lat))&&Number.isFinite(Number(raw.geo.lon))&&Math.abs(Number(raw.geo.lat))<=90&&Math.abs(Number(raw.geo.lon))<=180 ? { lat:Number(raw.geo.lat), lon:Number(raw.geo.lon), source:provider } : null;
    const officialId=String(raw.officialId||'').trim().slice(0,100);
    const id='sig:'+hash(provider+'|'+(officialId||sourceUrl));
    return { id, provider, sourceName:String(raw.sourceName||SOURCES[provider].owner).slice(0,100), sourceUrl, canonicalUrl:sourceUrl, title, originalTitle:title, translatedTitle:raw.translatedTitle?String(raw.translatedTitle).slice(0,240):null, publishedAt, observedAt, lastUpdated:iso(raw.updatedAt)||publishedAt||observedAt, lastVerified:provider==='GDELT'?null:observedAt, language:String(raw.language||'und').slice(0,20), country:String(raw.country||'').toUpperCase().slice(0,3)||null, sourceCountry:String(raw.sourceCountry||'').slice(0,80)||null, region:String(raw.region||'').slice(0,100)||null, rawCategories:Array.isArray(raw.rawCategories)?raw.rawCategories.slice(0,8):[], categories:categories(title+' '+(raw.translatedTitle||''),provider,raw.rawCategories||[]), geo:coords, officialId:officialId||null, magnitude:Number.isFinite(Number(raw.magnitude))?Number(raw.magnitude):null, severity:String(raw.severity||'').toUpperCase()||null, credibilityClass:sourceClass(provider,sourceUrl), fingerprint:hash((officialId||sourceUrl).toLowerCase()), extractedEntities:[], eventCandidateId:null, disputedClaims:provider==='GDELT'?[]:(Array.isArray(raw.disputedClaims)?raw.disputedClaims.slice(0,4).map(x=>String(x).slice(0,160)):[]) };
  }
  function eventKey(signal) { if (signal.officialId) return signal.provider+':'+signal.officialId; const t=tokens(signal.translatedTitle||signal.title); return [signal.categories[0]||'OTHER',signal.country||'',signal.region?.toLowerCase()||'',(signal.publishedAt||signal.observedAt).slice(0,10),t.slice(0,5).join(':')].join('|'); }
  function similarity(a,b) { const x=tokens(a.translatedTitle||a.title), y=tokens(b.translatedTitle||b.title); const overlap=x.filter(t=>y.includes(t)).length; return {overlap, ratio:overlap/Math.max(1,Math.min(x.length,y.length))}; }
  function mayMerge(event,signal) {
    if (event.sourceSignals.some(s=>s.id===signal.id)) return true;
    if (signal.officialId && event.sourceSignals.some(s=>s.provider===signal.provider&&s.officialId===signal.officialId)) return true;
    const first=event.sourceSignals[0];
    if (signal.officialId && first?.officialId && signal.provider===first.provider) return false;
    if (!first||!first.categories.some(c=>signal.categories.includes(c))) return false;
    if (first.country&&signal.country&&first.country!==signal.country) return false;
    if (first.region&&signal.region&&first.region.toLowerCase()!==signal.region.toLowerCase()) return false;
    if (first.geo&&signal.geo&&Math.hypot(first.geo.lat-signal.geo.lat,first.geo.lon-signal.geo.lon)>1) return false;
    const hours=Math.abs(Date.parse(first.publishedAt||first.observedAt)-Date.parse(signal.publishedAt||signal.observedAt))/3600000;
    if (hours>48) return false;
    const sim=similarity(first,signal);
    return sim.overlap>=2&&sim.ratio>=0.8&&(!!first.country||!!first.region||sim.overlap>=4);
  }
  function independenceKey(s) { const u=new URL(s.canonicalUrl); const wire=/\b(reuters|associated press|ap news|afp|bloomberg)\b/i.exec(s.sourceName+' '+s.title); return wire?'wire:'+wire[1].toLowerCase():u.hostname.replace(/^www\./,''); }
  function linkEntities(event, refs={}) {
    const text=(event.title+' '+event.sourceSignals.map(s=>s.title).join(' ')).toLowerCase();
    const matchName=(name)=>{ if(!name||name.length<5) return false; const escaped=name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return new RegExp('(^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])').test(text); };
    event.commodities=Object.entries(COMMODITIES).filter(([,re])=>re.test(text)).map(([c])=>c);
    const textTokens=tokens(text);
    const indexed=(index,fallback)=>index instanceof Map?[...new Set(textTokens.flatMap(t=>index.get(t)||[]))]:(fallback||[]);
    event.atlasEntityIds=indexed(refs.atlasIndex,refs.atlas).filter(e=>e&&e.id&&matchName(e.name)&&Array.isArray(e.sourceEvidence)&&e.sourceEvidence.length).slice(0,8).map(e=>e.id);
    const candidates=indexed(refs.nexusIndex,refs.nexus);
    const companies=candidates.filter(c=>c&&c.id&&(matchName(c.name)||(c.aliasUnique&&matchName(c.alias)))&&Array.isArray(c.sourceEvidence)&&c.sourceEvidence.length).slice(0,8);
    event.nexusSecurityIds=companies.map(c=>c.id); event.nexusCompanyIds=[...new Set(companies.map(c=>c.companyId).filter(Boolean))]; event.companies=companies.map(c=>({id:c.id,name:c.name,symbol:c.symbol,sector:c.sector||null}));
    event.sectors=[...new Set(companies.map(c=>c.sector).filter(Boolean))];
    event.launchpadIpoIds=(refs.launchpad||[]).filter(i=>i&&i.id&&matchName(i.name)&&event.categories.includes('IPO_CAPITAL_RAISING')&&((Array.isArray(i.evidence)&&i.evidence.length)||validUrl(i.source?.url))).slice(0,5).map(i=>i.id);
    event.unresolvedEntities=[];
  }
  function score(event,now) {
    const representatives=[];
    for (const s of event.sourceSignals) {
      const copy=representatives.some(r=>independenceKey(r)===independenceKey(s)||(Math.abs(Date.parse(r.publishedAt||r.observedAt)-Date.parse(s.publishedAt||s.observedAt))<7200000&&tokens(r.title).join('|')===tokens(s.title).join('|')));
      if (!copy) representatives.push(s);
    }
    event.sourceCount=event.sourceSignals.length; event.independentSourceCount=representatives.length;
    const official=event.sourceSignals.some(s=>s.credibilityClass==='PRIMARY_OFFICIAL');
    event.corroboration={officialSourcePresent:official,primarySourcePresent:official,independentSourceCount:representatives.length,crossRegionCorroboration:new Set(event.sourceSignals.map(s=>s.country).filter(Boolean)).size>1};
    event.credibility=official?'PRIMARY_OFFICIAL':event.sourceSignals.some(s=>s.credibilityClass==='MAJOR_WIRE')?'MAJOR_WIRE':'UNKNOWN';
    const age=(Date.parse(now)-Date.parse(event.updatedAt||event.occurredAt||event.firstObservedAt))/3600000;
    event.freshness=age<2?'RECENT':age<24?'TODAY':age<72?'AGING':'STALE';
    if (event.disputedClaims.length) event.status='DISPUTED'; else if (age>=72) event.status='STALE'; else if (official) event.status='CONFIRMED'; else event.status='DEVELOPING';
    const dimensions={ geographicScale:event.countries.length>1?'MULTI_COUNTRY':event.countries.length?'COUNTRY':'UNKNOWN', economicScale:'UNKNOWN', marketConnectivity:event.companies.length||event.commodities.length?'LINKED':'UNKNOWN', companyConnectivity:event.companies.length?'LINKED':'UNKNOWN', commodityConnectivity:event.commodities.length?'LINKED':'UNKNOWN', infrastructureCriticality:event.atlasEntityIds.length?'LINKED':'UNKNOWN', sourceConfidence:official?'OFFICIAL':representatives.length>=2?'CORROBORATED':'LIMITED' };
    event.materialityDimensions=dimensions;
    const mag=event.sourceSignals.find(s=>s.provider==='USGS')?.magnitude;
    const severity=event.sourceSignals.find(s=>s.provider==='NWS')?.severity;
    event.materiality=Number.isFinite(mag)?mag>=6?'HIGH':mag>=4.5?'MODERATE':'LOW':severity==='EXTREME'?'HIGH':severity==='SEVERE'?'MODERATE':(event.atlasEntityIds.length&&event.companies.length)?'HIGH':event.commodities.length&&representatives.length>=2?'MODERATE':'UNKNOWN';
    event.materialityExplanation=event.materiality==='UNKNOWN'?'Insufficient scale and entity evidence.':'Deterministic source and entity connectivity; no price direction inferred.';
    event.urgency=age>=24?'LOW':Number.isFinite(mag)?mag>=6&&age<6?'HIGH':mag>=4.5?'MODERATE':'LOW':severity==='EXTREME'&&age<6?'HIGH':event.categories.some(c=>['WAR_SECURITY','CYBER'].includes(c))&&age<6?'HIGH':'MODERATE';
    event.marketRelevance={US:event.countries.includes('US')||event.categories.includes('UNITED_STATES')||event.companies.some(c=>c.id.startsWith('US:'))?1:0,IN:event.countries.includes('IN')||event.categories.includes('INDIA')||event.companies.some(c=>c.id.startsWith('IN:'))?1:0};
  }
  function createEvent(signal,now,refs) {
    const key=eventKey(signal), id='ww:'+hash(signal.id);
    const event={ id, fingerprint:hash(key), title:signal.title, summary:sourceSummary(signal), status:'DEVELOPING', firstObservedAt:signal.observedAt, lastObservedAt:signal.observedAt, occurredAt:signal.publishedAt, updatedAt:signal.lastUpdated, categories:[...signal.categories], subcategories:[], countries:signal.country?[signal.country]:[], regions:signal.region?[signal.region]:[], geo:signal.geo?[signal.geo]:[], atlasEntityIds:[], people:[], organizations:[], companies:[], nexusCompanyIds:[], nexusSecurityIds:[], sectors:[], industries:[], commodities:[], currencies:[], launchpadIpoIds:[], sourceSignals:[signal], evidence:[{source:signal.sourceName,url:signal.sourceUrl,publishedAt:signal.publishedAt,credibilityClass:signal.credibilityClass}], sourceCount:1, independentSourceCount:1, credibility:'',corroboration:{},novelty:'NEW_EVENT',materiality:'UNKNOWN',urgency:'MODERATE',freshness:'',disputedClaims:[...signal.disputedClaims],unresolvedEntities:[],updates:[{kind:'NEW_EVENT',at:signal.observedAt,signalId:signal.id}] };
    linkEntities(event,refs); score(event,now); return event;
  }
  function ingest(previous,rawSignals,refs={},now=new Date().toISOString()) {
    const events=Array.isArray(previous?.events)?previous.events.filter(e=>e&&Array.isArray(e.sourceSignals)&&!e.sourceSignals.some(s=>s.provider==='NWS'&&/\b(test|exercise|demo)\b/i.test(s.title))):[];
    const bySignal=new Map(), byBucket=new Map(), ids=new Set(events.map(e=>e.id));
    const seenSignals=new Map(Object.entries(previous?.seenSignals||{}).filter(([,at])=>Date.parse(now)-Date.parse(at)<RETENTION.seenSignalHours*3600000));
    const bucket=s=>{ const t=tokens(s.translatedTitle||s.title); return [s.categories[0]||'OTHER',s.country||'',(s.publishedAt||s.observedAt).slice(0,10),t.find(x=>/\d/.test(x))||t.at(-1)||''].join('|'); };
    const index=e=>{ for (const x of e.sourceSignals) bySignal.set(x.id,e); const first=e.sourceSignals[0]; if(first) { const k=bucket(first); const list=byBucket.get(k)||[]; if(!list.includes(e)) list.push(e); byBucket.set(k,list); } };
    for (const e of events) index(e);
    const metrics={received:rawSignals.length,accepted:0,duplicatesSuppressed:0,clustersCreated:0,materialUpdates:0};
    for (const raw of rawSignals.slice(0,1000)) {
      const s=normalizeSignal(raw,now); if (!s) continue; metrics.accepted++;
      let e=bySignal.get(s.id)||(byBucket.get(bucket(s))||[]).find(e=>mayMerge(e,s));
      if (!e&&seenSignals.has(s.id)) { metrics.duplicatesSuppressed++; seenSignals.set(s.id,now); continue; }
      seenSignals.set(s.id,now);
      if (!e) { e=createEvent(s,now,refs); if (ids.has(e.id)) e.id+=':'+s.fingerprint; ids.add(e.id); events.push(e); index(e); metrics.clustersCreated++; continue; }
      const existing=e.sourceSignals.find(x=>x.id===s.id);
      if (existing) {
        if (existing.title===s.title && existing.lastUpdated===s.lastUpdated) {
          existing.observedAt=s.observedAt; existing.lastVerified=s.lastVerified;
          e.lastObservedAt=s.observedAt; metrics.duplicatesSuppressed++; continue;
        }
        e.sourceSignals=e.sourceSignals.map(x=>x.id===s.id?s:x);
        e.novelty='CORRECTION'; e.updates.push({kind:'CORRECTION',at:s.observedAt,signalId:s.id});
        e.title=s.title; e.summary=sourceSummary(s); e.updatedAt=s.lastUpdated; e.lastObservedAt=s.observedAt;
        e.disputedClaims=[...new Set([...e.disputedClaims,...s.disputedClaims])];
        score(e,now); metrics.materialUpdates++; continue;
      }
      e.sourceSignals.push(s); e.sourceSignals=e.sourceSignals.slice(-MAX_SIGNALS);
      bySignal.set(s.id,e);
      e.evidence=e.sourceSignals.map(x=>({source:x.sourceName,url:x.sourceUrl,publishedAt:x.publishedAt,credibilityClass:x.credibilityClass}));
      e.lastObservedAt=s.observedAt; e.updatedAt=s.lastUpdated; e.categories=[...new Set([...e.categories,...s.categories])];
      if (s.country&&!e.countries.includes(s.country)) e.countries.push(s.country);
      if (s.region&&!e.regions.includes(s.region)) e.regions.push(s.region);
      if (s.geo&&!e.geo.some(g=>g.lat===s.geo.lat&&g.lon===s.geo.lon)) e.geo.push(s.geo);
      e.novelty='MATERIAL_UPDATE'; e.updates.push({kind:'MATERIAL_UPDATE',at:s.observedAt,signalId:s.id}); e.updates=e.updates.slice(-20); metrics.materialUpdates++;
      e.disputedClaims=[...new Set([...e.disputedClaims,...s.disputedClaims])];
      linkEntities(e,refs); score(e,now);
    }
    for (const e of events) score(e,now);
    events.sort((a,b)=>(b.lastObservedAt||'').localeCompare(a.lastObservedAt||'')||(b.updatedAt||b.occurredAt||'').localeCompare(a.updatedAt||a.occurredAt||''));
    const older=events.slice(MAX_EVENTS).filter(e=>['MODERATE','HIGH','CRITICAL'].includes(e.materiality));
    const archive=[...(previous?.archive||[]),...older.map(e=>({id:e.id,title:e.title,status:e.status,lastObservedAt:e.lastObservedAt,updatedAt:e.updatedAt,materiality:e.materiality,evidence:e.evidence.slice(0,3),archived:true}))]
      .filter(e=>Date.parse(now)-Date.parse(e.lastObservedAt)<RETENTION.warmDays*86400000);
    const warm=[...new Map(archive.map(e=>[e.id,e])).values()].sort((a,b)=>b.lastObservedAt.localeCompare(a.lastObservedAt)).slice(0,RETENTION.warmMaterialEvents);
    const recentSeen=[...seenSignals.entries()].sort((a,b)=>b[1].localeCompare(a[1])).slice(0,RETENTION.seenSignalLimit);
    return {schemaVersion:VERSION,coverage:'MAXIMUM PRACTICAL CONNECTED-SOURCE COVERAGE',retention:RETENTION,events:events.slice(0,MAX_EVENTS),archive:warm,seenSignals:Object.fromEntries(recentSeen),metrics,lastIngestAt:now};
  }
  function query(store,params={}) {
    const limit=Math.min(50,Math.max(1,Number(params.limit)||25)), offset=Math.min(MAX_EVENTS,Math.max(0,Number(params.cursor)||0));
    let out=store?.events||[];
    const now=Date.now(), maxAge={'24h':86400000,'7d':7*86400000,'30d':30*86400000}[params.time];
    if(maxAge) out=out.filter(e=>now-Date.parse(e.updatedAt||e.occurredAt)<=maxAge);
    if(params.since&&Number.isFinite(Date.parse(params.since))) out=out.filter(e=>Date.parse(e.updatedAt||e.occurredAt)>=Date.parse(params.since));
    if(params.until&&Number.isFinite(Date.parse(params.until))) out=out.filter(e=>Date.parse(e.updatedAt||e.occurredAt)<=Date.parse(params.until));
    for (const [key,field] of [['category','categories'],['country','countries'],['region','regions'],['commodity','commodities'],['sector','sectors'],['status','status'],['materiality','materiality'],['urgency','urgency']]) if (params[key]) out=out.filter(e=>Array.isArray(e[field])?e[field].includes(params[key]):e[field]===params[key]);
    if (params.company) out=out.filter(e=>e.nexusSecurityIds.includes(params.company)||e.nexusCompanyIds.includes(params.company));
    if (params.q) { const q=String(params.q).toLowerCase().slice(0,80); out=out.map(e=>({e,rank:e.nexusSecurityIds.some(x=>x.toLowerCase()===q)||e.commodities.some(x=>x.toLowerCase()===q)?3:e.title.toLowerCase().includes(q)?2:JSON.stringify([e.countries,e.regions,e.companies,e.sectors,e.organizations,e.categories]).toLowerCase().includes(q)?1:0})).filter(x=>x.rank).sort((a,b)=>b.rank-a.rank||b.e.lastObservedAt.localeCompare(a.e.lastObservedAt)).map(x=>x.e); }
    if (!params.q) {
      const market=params.market==='US'||params.market==='IN'?params.market:null;
      const weight={CRITICAL:4,HIGH:3,MODERATE:2,LOW:1,UNKNOWN:0};
      const groups=new Map(); for(const e of out){const p=e.sourceSignals[0]?.provider||'OTHER'; if(!groups.has(p)) groups.set(p,[]);groups.get(p).push(e);}
      for(const rows of groups.values()) rows.sort((a,b)=>(market?((b.marketRelevance[market]||0)-(a.marketRelevance[market]||0)):0)||(weight[b.materiality]-weight[a.materiality])||(b.updatedAt||'').localeCompare(a.updatedAt||''));
      const ordered=[]; while(ordered.length<out.length) for(const rows of groups.values()) if(rows.length) ordered.push(rows.shift());
      out=ordered;
    }
    return {schemaVersion:VERSION,total:out.length,cursor:offset+limit<out.length?String(offset+limit):null,events:out.slice(offset,offset+limit).map(e=>({...e,sourceSignals:e.sourceSignals.slice(0,MAX_SIGNALS)}))};
  }
  function health(previous={},provider,ok,count,error,now=new Date().toISOString(),latencyMs=null) { const p=previous[provider]||{consecutiveFailures:0}; const failures=ok?0:p.consecutiveFailures+1; return {...previous,[provider]:{status:ok?'HEALTHY':failures>=3?'FAILED':'DEGRADED',lastAttempt:now,lastSuccess:ok?now:p.lastSuccess||null,recordsReceived:ok?count:p.recordsReceived||0,latencyMs,errorClass:ok?null:error||'UNKNOWN',consecutiveFailures:failures,nextAttemptAt:ok?null:new Date(Date.parse(now)+Math.min(6,2**failures)*3600000).toISOString()}}; }
  return Object.freeze({VERSION,MAX_EVENTS,RETENTION,CATEGORIES,SOURCES,normalizeSignal,createEvent,mayMerge,ingest,query,health,validUrl,canonicalUrl});
});

const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../shared/worldwire-core.js');
const runtime=require('../shared/worldwire-runtime.js');
const atlas=require('../shared/atlas-core.js');
const fs=require('node:fs');
const NOW='2026-09-23T12:00:00.000Z';
const article=(title,url,extra={})=>({provider:'GDELT',sourceName:new URL(url).hostname,sourceUrl:url,title,publishedAt:'2026-09-23T11:00:00Z',observedAt:NOW,country:'TW',language:'English',...extra});
test('SourceSignal identity is URL based, canonical, and retains multilingual original',()=>{
  const s=core.normalizeSignal(article('Terremoto golpea Taiwan','https://news.example/a?utm_source=x',{language:'Spanish',translatedTitle:'Earthquake strikes Taiwan'}),NOW);
  assert.equal(s.title,'Terremoto golpea Taiwan'); assert.equal(s.language,'Spanish'); assert.equal(s.translatedTitle,'Earthquake strikes Taiwan'); assert.equal(s.canonicalUrl,'https://news.example/a');
  assert.equal(s.id,core.normalizeSignal(article('Changed headline','https://news.example/a'),NOW).id);
});
test('negative control: headline changes and translations do not create extra event identities',()=>{
  const a=article('Earthquake strikes Taiwan','https://reuters.com/quake');
  const b=article('Powerful quake hits Taiwan','https://bbc.com/quake');
  const c=article('Terremoto golpea Taiwan','https://local.tw/quake',{language:'Spanish',translatedTitle:'Earthquake strikes Taiwan'});
  const out=core.ingest(null,[a,b,c],{},NOW); assert.equal(out.events.length,1); assert.equal(out.events[0].sourceCount,3); assert.equal(out.events[0].independentSourceCount,2);
  assert.equal(out.events[0].sourceSignals[0].credibilityClass,'MAJOR_WIRE'); assert.equal(out.events[0].credibility,'MAJOR_WIRE'); assert.match(out.events[0].summary,/Unverified article signal/); assert.equal(out.events[0].status,'DEVELOPING');
});
test('negative control: unrelated same-day events and distinct official quake IDs stay apart',()=>{
  const a=article('Earthquake strikes Taiwan Hualien','https://a.example/1');
  const b=article('Earthquake strikes Taiwan Taipei','https://b.example/2');
  assert.equal(core.ingest(null,[a,b],{},NOW).events.length,2);
  const q=id=>({provider:'USGS',officialId:id,sourceUrl:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,title:'M5 earthquake near Taiwan',publishedAt:NOW,geo:{lat:23,lon:121}});
  assert.equal(core.ingest(null,[q('one'),q('two')],{},NOW).events.length,2);
});
test('negative control: syndication and source mirrors do not inflate independent count',()=>{
  const a=article('Earthquake strikes Taiwan','https://mirror-one.example/a',{sourceName:'Reuters'});
  const b=article('Earthquake strikes Taiwan','https://mirror-two.example/b',{sourceName:'Reuters mirror'});
  const e=core.ingest(null,[a,b],{},NOW).events[0]; assert.equal(e.sourceCount,2); assert.equal(e.independentSourceCount,1); assert.equal(e.status,'DEVELOPING');
  const c=article('Earthquake strikes Taiwan','https://mirror-three.example/c',{sourceName:'Mirror Three'});
  assert.equal(core.ingest(null,[a,c],{},NOW).events[0].independentSourceCount,1);
});
test('extended categories classify explicit event terms without inventing impact',()=>{
  const cases={SPACE_AEROSPACE:'Satellite launch delayed',HEALTHCARE_BIOTECH:'Drug approval announced',FX_SOVEREIGN_DEBT:'Sovereign bond auction',BANKING_CREDIT:'Bank failure reported',COMMODITIES:'Copper mine shutdown',AGRICULTURE_FOOD:'Wheat crop failure',SUPPLY_CHAINS:'Supplier disruption at factory',REGULATION:'Regulatory ban proposed',DEFENSE:'Defense contract awarded',AUTOMOTIVE:'Electric vehicle production halted',CONSUMER_RETAIL:'Retail sales fall',REAL_ESTATE_CONSTRUCTION:'Housing starts decline',MEDIA_ENTERTAINMENT:'Film studio merger',MA:'Takeover bid announced',EARNINGS_CORPORATE:'Quarterly results released',LABOR:'Labor strike called',INFRASTRUCTURE:'Bridge collapse reported',CRITICAL_MINERALS:'Lithium mine closed',WATER:'Water shortage declared',NUCLEAR:'Nuclear reactor offline',DIGITAL_ASSETS:'Stablecoin rule proposed',EMERGING_MARKETS:'Emerging market debt sale'};
  for(const [category,title] of Object.entries(cases)) assert.ok(core.normalizeSignal(article(title,'https://example.org/'+category),NOW).categories.includes(category),category);
  const e=core.ingest(null,[article('Copper mine shutdown','https://example.org/scale')],{},NOW).events[0];
  assert.equal(e.materialityDimensions.economicScale,'UNKNOWN');
});
test('negative control: duplicate official signal yields one event and correction updates it',()=>{
  const q={provider:'USGS',officialId:'abc',sourceUrl:'https://earthquake.usgs.gov/earthquakes/eventpage/abc',title:'M6 earthquake Taiwan',publishedAt:NOW,updatedAt:NOW,geo:{lat:23,lon:121}};
  let out=core.ingest(null,[q,q],{},NOW); assert.equal(out.events.length,1); assert.equal(out.metrics.duplicatesSuppressed,1);
  const next=core.ingest(out,[{...q,title:'M6.1 earthquake Taiwan',updatedAt:'2026-09-23T12:05:00Z'}],{},'2026-09-23T12:06:00Z');
  assert.equal(next.events.length,1); assert.equal(next.events[0].novelty,'CORRECTION'); assert.equal(next.events[0].status,'CONFIRMED');
});
test('negative controls: stale not breaking, unknown materiality distinct from zero, disputes visible',()=>{
  const old=article('Taiwan semiconductor policy consultation','https://a.example/old',{publishedAt:'2026-09-01T10:00:00Z',observedAt:'2026-09-01T10:00:00Z'});
  const e=core.ingest(null,[old],{},NOW).events[0]; assert.equal(e.status,'STALE'); assert.equal(e.freshness,'STALE'); assert.equal(e.materiality,'UNKNOWN');
  const disputed=core.ingest(null,[{provider:'USGS',officialId:'abc',sourceUrl:'https://earthquake.usgs.gov/a',title:'Earthquake Taiwan',publishedAt:NOW,disputedClaims:['Magnitude under revision']}],{},NOW).events[0];
  assert.equal(disputed.status,'DISPUTED'); assert.deepEqual(disputed.disputedClaims,['Magnitude under revision']);
});
test('negative controls: fabricated links, unverified coordinates and AI URLs are rejected',()=>{
  const s=article('Acme Oil refinery outage','https://a.example/1');
  const refs={nexus:[{id:'US:NYSE:ACME',name:'Acme Oil',sourceEvidence:[]}],atlas:[{id:'fake',name:'Acme Oil',sourceEvidence:[]}],launchpad:[{id:'US:IPO:ACME',name:'Acme Oil',evidence:[]}]};
  const e=core.ingest(null,[s],refs,NOW).events[0]; assert.deepEqual(e.nexusSecurityIds,[]); assert.deepEqual(e.atlasEntityIds,[]); assert.deepEqual(e.launchpadIpoIds,[]);
  assert.equal(core.normalizeSignal({...s,geo:{lat:999,lon:999}},NOW).geo,null);
  assert.equal(core.normalizeSignal({...s,sourceUrl:'javascript:alert(1)'},NOW),null);
});
test('evidence-backed NEXUS, ATLAS, LAUNCHPAD and commodity links are bounded',()=>{
  const s=article('Acme Copper IPO at New York Port','https://a.example/1',{rawCategories:['IPO_CAPITAL_RAISING']});
  const refs={nexus:[{id:'US:NYSE:ACME',companyId:'company:us:acme',name:'Acme Copper',symbol:'ACME',sector:'Materials',sourceEvidence:[{sourceUrl:'https://sec.gov/a'}]}],atlas:[{id:'ref:port:ny',name:'New York Port',sourceEvidence:[{sourceUrl:'https://wikidata.org/a'}]}],launchpad:[{id:'US:IPO:ACME',name:'Acme Copper',evidence:[{url:'https://sec.gov/b'}]}]};
  const e=core.ingest(null,[s],refs,NOW).events[0]; assert.deepEqual(e.nexusSecurityIds,['US:NYSE:ACME']); assert.deepEqual(e.atlasEntityIds,['ref:port:ny']); assert.deepEqual(e.launchpadIpoIds,['US:IPO:ACME']); assert.deepEqual(e.commodities,['COPPER']);
});
test('source policy disables ACLED, parser error pages fail, official adapters validate schema',()=>{
  assert.equal(core.SOURCES.ACLED.enabled,false); assert.equal(core.normalizeSignal({provider:'ACLED',sourceUrl:'https://acleddata.com/a',title:'test'},NOW),null);
  assert.throws(()=>runtime.gdelt({html:'error'}),/schema/); assert.throws(()=>runtime.usgs({features:[]}),/schema/); assert.throws(()=>runtime.eonet({events:null}),/schema/); assert.throws(()=>runtime.nws({features:[]}),/schema/);
  assert.equal(runtime.usgs({type:'FeatureCollection',features:[{id:'abc',geometry:{type:'Point',coordinates:[121,23]},properties:{url:'https://earthquake.usgs.gov/a',mag:5,place:'Taiwan',time:Date.parse(NOW)}}]})[0].officialId,'abc');
  assert.equal(runtime.usgs({type:'FeatureCollection',features:[{id:'ar',geometry:{type:'Point',coordinates:[-66,-28]},properties:{url:'https://earthquake.usgs.gov/ar',mag:5,place:'51 km WSW of Arauco, Argentina',time:Date.parse(NOW)}}]})[0].country,'AR');
  assert.equal(runtime.eonet({events:[{id:'x',title:'Wildfire',link:'https://eonet.gsfc.nasa.gov/x',geometry:[{type:'Point',coordinates:[2,1],date:NOW}]}]})[0].geo.lat,1);
  assert.equal(runtime.nws({type:'FeatureCollection',features:[{id:'x',properties:{headline:'Storm warning',id:'https://api.weather.gov/a',sent:NOW},geometry:null}]} )[0].country,'US');
  assert.equal(runtime.nws({type:'FeatureCollection',features:[{id:'t',properties:{event:'Test Message',headline:'Test Message',id:'https://api.weather.gov/test',sent:NOW}}]}).length,0);
});
test('provider failure isolation, health backoff and zero-result guard preserve state',async()=>{
  let stored={events:core.ingest(null,[article('Earthquake strikes Taiwan','https://a.example/1')],{},NOW).events,health:{},totals:{}};
  let writes=0; const storage={get:async()=>stored,put:async(_k,v)=>{stored=v;writes++;}};
  const fetch0=global.fetch; global.fetch=async()=>{throw new Error('down');};
  try { const out=await runtime.run(storage,{},NOW); assert.equal(out.events.length,1); assert.equal(out.health.USGS.status,'DEGRADED'); assert.equal(out.health.GDELT.status,'DEGRADED'); assert.equal(writes,1); assert.ok(Date.parse(out.health.USGS.nextAttemptAt)>Date.parse(NOW)); }
  finally { global.fetch=fetch0; }
});
test('API bounds, search ranking and market relevance preserve global results',()=>{
  const a=article('US oil pipeline outage','https://a.example/us',{country:'US'});
  const b=article('India copper port disruption','https://b.example/in',{country:'IN'});
  const out=core.ingest(null,[a,b],{},NOW);
  assert.equal(core.query(out,{limit:999}).events.length,2);
  assert.equal(core.query(out,{market:'IN'}).events[0].countries[0],'IN');
  assert.equal(core.query(out,{q:'COPPER'}).events[0].countries[0],'IN');
  assert.equal(runtime.respond('/api/worldwire/event',out,{id:'absent'}).event,null);
  const coverage=runtime.respond('/api/worldwire/coverage',{...out,health:{GDELT:{status:'DEGRADED'}}});
  assert.equal(coverage.sourceHealth.GDELT,'DEGRADED'); assert.equal(coverage.categoryCounts.ENERGY,1); assert.ok(coverage.regionCount>=0);
});
test('ATLAS projection requires source coordinates and shares WORLDWIRE id',()=>{
  const good={provider:'USGS',officialId:'xyz',sourceUrl:'https://earthquake.usgs.gov/earthquakes/eventpage/xyz',title:'M6.0 earthquake — Taiwan',publishedAt:NOW,geo:{lat:23,lon:121},magnitude:6};
  const bad={...good,officialId:'bad',sourceUrl:'https://earthquake.usgs.gov/earthquakes/eventpage/bad',geo:{lat:999,lon:121}};
  const store=core.ingest(null,[good,bad],{},NOW); const mapped=runtime.geoEvents(store,atlas,Date.parse(NOW));
  assert.equal(mapped.length,1); assert.equal(mapped[0].attributes.worldwireId,store.events.find(e=>e.geo.length).id);
  assert.equal(runtime.mergeGeoEvents([mapped[0]],mapped).length,1);
});
test('server and Worker route and ATLAS projection call the same shared runtime',()=>{
  const server=fs.readFileSync(require.resolve('../server.js'),'utf8'),worker=fs.readFileSync(require.resolve('../worker.js'),'utf8');
  for(const s of [server,worker]) { assert.match(s,/worldwire\.respond\(/); assert.match(s,/worldwire\.mergeGeoEvents\(/); assert.match(s,/worldwire\.run\(/); assert.match(s,/map:conflict:gdelt-only/); assert.doesNotMatch(s,/acleddata\.com\/api\/acled/); }
});
test('retention bounds hot events and keeps material overflow as warm metadata',()=>{
  const sample=core.ingest(null,[{provider:'USGS',officialId:'mine',sourceUrl:'https://earthquake.usgs.gov/mine',title:'M5 earthquake Taiwan',publishedAt:NOW,geo:{lat:23,lon:121},magnitude:5}],{},NOW).events[0];
  const prior={events:Array.from({length:601},(_,i)=>({...sample,id:'e:'+i,materiality:'MODERATE',updatedAt:new Date(Date.parse(NOW)-i*60000).toISOString()}))};
  const out=core.ingest(prior,[],{},NOW); assert.equal(out.events.length,600); assert.equal(out.archive.length,1); assert.equal(out.archive[0].archived,true); assert.equal(out.retention.warmDays,90);
});
test('100k signals and 10k events process in batches without an unbounded response',()=>{
  let store={events:[]}; for(let i=0;i<100000;i+=1000) { const raw=Array.from({length:1000},(_,j)=>article('Earthquake near region '+(i+j),'https://example.org/'+(i+j),{country:(i+j)%2?'US':'IN'})); store=core.ingest(store,raw,{},NOW); }
  assert.ok(store.events.length<=core.MAX_EVENTS); assert.ok(core.query(store,{limit:10000}).events.length<=50);
  const many={events:Array.from({length:10000},(_,i)=>({...store.events[0],id:'synthetic:'+i}))};
  assert.equal(core.query(many,{limit:10000}).events.length,50);
});

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = s => s ? new Date(s).toLocaleString() : 'UNKNOWN';
  const safeUrl = s => { try { const u=new URL(s); return /^https?:$/.test(u.protocol)?u.toString():''; } catch { return ''; } };
  let selected=null, cursor=null, loading=false, pending=false, opened=false;
  function params(next) {
    const p=new URLSearchParams({limit:'25'});
    if ($('wwMarket').value!=='GLOBAL') p.set('market',$('wwMarket').value);
    if ($('wwCategory').value) p.set('category',$('wwCategory').value);
    if ($('wwCountry').value.trim()) p.set('country',$('wwCountry').value.trim().toUpperCase());
    if ($('wwMateriality').value) p.set('materiality',$('wwMateriality').value);
    if ($('wwUrgency').value) p.set('urgency',$('wwUrgency').value);
    if ($('wwTime').value) p.set('time',$('wwTime').value);
    if ($('wwSearch').value.trim()) p.set('q',$('wwSearch').value.trim());
    if (next&&cursor) p.set('cursor',cursor);
    return p;
  }
  function card(e) {
    const signal=e.sourceSignals?.[0];
    return `<button type="button" class="ww-event${e.id===selected?' active':''}" data-id="${esc(e.id)}"><span class="ww-time">${esc(date(e.lastObservedAt))}</span><strong>${esc(e.title)}</strong><span>${esc(e.countries.join(', ')||e.regions.join(', ')||'Location unknown')} · ${esc(e.categories.join(' / ')||'UNCATEGORIZED')}</span><span>${esc(e.status)} · ${esc(e.materiality)} materiality · ${esc(e.independentSourceCount)} independent source${e.independentSourceCount===1?'':'s'}${signal?' · '+esc(signal.sourceName):''}</span></button>`;
  }
  function detail(e) {
    if (!e) { $('wwDetail').innerHTML='<p>Select an event for evidence and connections.</p>'; return; }
    const links=(e.evidence||[]).map(x=>{ const url=safeUrl(x.url); return url?`<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.source)}</a> · ${x.publishedAt?'published':'observed'} ${esc(date(x.publishedAt||x.observedAt))} · ${esc(x.credibilityClass)}</li>`:''; }).join('');
    const gdeltCredit=e.sourceSignals?.some(s=>s.provider==='GDELT')?'<p>Discovery data: <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">GDELT Project</a>. Open the publisher link for the original article.</p>':'';
    const nexus=(e.companies||[]).map(c=>`<li><button type="button" data-nexus="${esc(c.id)}">${esc(c.name)} (${esc(c.symbol)})</button></li>`).join('');
    const atlas=(e.atlasEntityIds||[]).map(id=>`<li><button type="button" data-atlas="${esc(id)}">${esc(id)}</button></li>`).join('');
    const ipo=(e.launchpadIpoIds||[]).map(id=>`<li><a href="#/research/launchpad">${esc(id)}</a></li>`).join('');
    const where=[...e.countries,...e.regions].join(', ')||'UNKNOWN';
    $('wwDetail').innerHTML=`<h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p><p class="ww-badges">${esc(e.status)} · ${esc(e.freshness)} · ${esc(e.categories.join(' / '))}</p><h4>Where</h4><p>${esc(where)}</p>${e.geo?.length?'<button type="button" data-map="1">View in ATLAS</button>':''}<h4>When</h4><p>Occurred: ${esc(date(e.occurredAt))}<br>First observed: ${esc(date(e.firstObservedAt))}<br>Updated: ${esc(date(e.updatedAt))}</p><h4>Evidence</h4><p>${esc(e.independentSourceCount)} independent of ${esc(e.sourceCount)} retained signals · ${esc(e.credibility)}</p><ul>${links||'<li>No linked evidence</li>'}</ul>${gdeltCredit}<h4>Entities and connections</h4><p>Commodities: ${esc(e.commodities.join(', ')||'UNKNOWN')}<br>Sectors: ${esc(e.sectors.join(', ')||'UNKNOWN')}</p><ul>${nexus}${atlas}${ipo}</ul><h4>Materiality / urgency</h4><p>${esc(e.materiality)} / ${esc(e.urgency)} · ${esc(e.materialityExplanation)}</p><h4>Updates</h4><ol>${(e.updates||[]).map(u=>`<li>${esc(date(u.at))} · ${esc(u.kind)}</li>`).join('')}</ol><h4>Disputes</h4><p>${e.disputedClaims?.length?esc(e.disputedClaims.join('; ')):'No disputed claim recorded; source claims remain attributed.'}</p>`;
    $('wwDetail').querySelector('[data-map]')?.addEventListener('click',()=>{ location.hash='#/intelligence/map'; });
    $('wwDetail').querySelectorAll('[data-atlas]').forEach(b=>b.addEventListener('click',()=>{ location.hash='#/intelligence/map'; setTimeout(()=>window.MarketTerminalAtlas?.focusEntity(b.dataset.atlas),250); }));
    $('wwDetail').querySelectorAll('[data-nexus]').forEach(b=>b.addEventListener('click',()=>{ window.MarketTerminal?.openSecurity?.(b.dataset.nexus,'nexus'); }));
  }
  async function open(id) {
    selected=id; $('wwStream').querySelectorAll('.ww-event').forEach(b=>b.classList.toggle('active',b.dataset.id===id));
    const res=await fetch('/api/worldwire/event?id='+encodeURIComponent(id)); const data=await res.json(); if (res.ok) detail(data.event);
  }
  async function load(next=false) {
    if (loading) { pending=true; return; } loading=true; $('wwStatus').textContent='Loading events…';
    try {
      const res=await fetch('/api/worldwire/'+($('wwSearch').value.trim()?'search':'events')+'?'+params(next));
      const data=await res.json(); if (!res.ok) throw new Error(data.message||'Request failed');
      cursor=data.cursor; $('wwMore').hidden=!cursor;
      if (!next) $('wwStream').innerHTML='';
      $('wwStream').insertAdjacentHTML('beforeend',data.events.map(card).join(''));
      $('wwStatus').textContent=data.total?`${data.total} matching events · showing a bounded page`:'No connected-source events in this filter yet.';
      $('wwStream').querySelectorAll('.ww-event').forEach(b=>b.onclick=()=>open(b.dataset.id));
      if (!next&&data.events.length) open(data.events.some(e=>e.id===selected)?selected:data.events[0].id);
      if (!next&&!data.events.length) detail(null);
      if (!next) { const c=await fetch('/api/worldwire/coverage').then(r=>r.json()); $('wwCoverage').dataset.lastIngest=c.lastIngestAt||''; const degraded=Object.entries(c.sourceHealth||{}).filter(([,status])=>status!=='HEALTHY').map(([name,status])=>`${name} ${status}`); $('wwCoverage').textContent=`${c.coverage||'Connected-source coverage'} · ${c.sourceCount||0} enabled sources · ${c.events24h||0} events updated in 24h · last ingest ${date(c.lastIngestAt)}${degraded.length?' · '+degraded.join(', '):''}`; if (!c.lastIngestAt&&!data.total) $('wwStatus').textContent='Awaiting the first scheduled source cycle.'; }
    } catch(e) { $('wwStatus').textContent='WORLDWIRE unavailable: '+e.message; }
    finally { loading=false; if(pending){pending=false;load();} }
  }
  async function init() {
    if (window.Market?.id==='US'||window.Market?.id==='IN') $('wwMarket').value=window.Market.id;
    const data=await fetch('/api/worldwire/categories').then(r=>r.json()).catch(()=>({categories:[]}));
    $('wwCategory').insertAdjacentHTML('beforeend',(data.categories||[]).map(c=>`<option value="${esc(c)}">${esc(c.replaceAll('_',' '))}</option>`).join(''));
    $('wwRefresh').onclick=()=>load(); $('wwMore').onclick=()=>load(true);
    for (const id of ['wwMarket','wwCategory','wwMateriality','wwUrgency','wwTime']) $(id).onchange=()=>load();
    let timer; for(const id of ['wwSearch','wwCountry']) $(id).oninput=()=>{ clearTimeout(timer); timer=setTimeout(()=>load(),300); };
    load(); setInterval(async()=>{ if (!$('gi-worldwire').classList.contains('active')) return; try { const c=await fetch('/api/worldwire/coverage').then(r=>r.json()); if(c.lastIngestAt&&$('wwCoverage').dataset.lastIngest!==c.lastIngestAt) $('wwStatus').textContent='New source cycle available · Refresh to update the stream.'; } catch {} },300000);
  }
  document.addEventListener('mt:gisub',e=>{ if (e.detail?.sub==='worldwire'&&!opened) { opened=true; init(); } });
  document.addEventListener('tabshown',e=>{ if (e.detail?.view==='news'&&$('gi-worldwire').classList.contains('active')&&!opened) { opened=true; init(); } });
  document.addEventListener('mt:market',()=>{ if (opened&&(window.Market?.id==='US'||window.Market?.id==='IN')) { $('wwMarket').value=window.Market.id; load(); } });
  window.MarketTerminalWorldwire={openEvent:id=>{location.hash='#/intelligence/worldwire'; if (!opened) { opened=true; init(); } setTimeout(()=>open(id),100);}};
})();

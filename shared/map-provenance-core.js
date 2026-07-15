(() => {
  'use strict';

  const SCHEMA_VERSION = '2026-07-15';

  const source = (name, url, authority) => Object.freeze({ name, url: url || '', authority });
  const CURATED = source('Project-curated public reference dataset', '', 'curated');
  const definition = (label, dataClass, refreshSeconds, sources, note) => Object.freeze({
    label,
    dataClass,
    refreshSeconds,
    sources: Object.freeze(sources),
    note,
  });
  const curated = (label, note) => definition(label, 'curated', 86_400, [CURATED], note);

  const LAYER_DEFINITIONS = Object.freeze({
    earthquakes: definition('Earthquakes', 'live', 900, [
      source('USGS Earthquake Hazards Program', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', 'official'),
    ], 'Public USGS event feed; position and magnitude are source observations.'),
    events: definition('Natural Events', 'live', 900, [
      source('NASA EONET', 'https://eonet.gsfc.nasa.gov/docs/v3', 'official'),
    ], 'Open NASA natural-event catalog normalized into map points.'),
    weather: definition('US Weather Alerts', 'live', 900, [
      source('National Weather Service Alerts API', 'https://www.weather.gov/documentation/services-web-api', 'official'),
    ], 'US-only alert feed. An upstream failure is shown as unavailable rather than inferred.'),
    flights: definition('Aircraft', 'live', 30, [
      source('airplanes.live', 'https://airplanes.live', 'public'),
      source('ADSB.lol', 'https://adsb.lol', 'public'),
      source('OpenSky Network', 'https://opensky-network.org', 'public'),
    ], 'Best-effort public ADS-B coverage. It is viewport-scoped, incomplete, and not authoritative air-traffic control data.'),
    fires: definition('Active Fires', 'live', 1800, [
      source('NASA FIRMS', 'https://firms.modaps.eosdis.nasa.gov', 'official'),
    ], 'Satellite fire detections, not a complete incident or evacuation feed.'),
    instability: definition('Country Instability', 'model-derived', 180, [
      source('Terminal evidence pipeline', '', 'internal'),
    ], 'Model-derived risk view. It is not an official risk assessment and must be read with its underlying evidence.'),
    daynight: definition('Day / Night', 'computed', 300, [
      source('Local astronomical calculation', '', 'computed'),
    ], 'Computed in the browser from the current time; no external data source is used.'),
    chokepoints: curated('Chokepoints', 'Reference locations curated in this project. Individual records do not yet carry per-feature citations.'),
    nuclear: definition('Nuclear Sites', 'hybrid', 86_400, [
      CURATED,
      source('IAEA PRIS', 'https://pris.iaea.org/PRIS/home.aspx', 'official'),
    ], 'Curated reference locations augmented best-effort with public IAEA reactor status.'),
    spaceports: curated('Spaceports', 'Reference locations curated in this project. Individual records do not yet carry per-feature citations.'),
    datacenters: curated('AI Data Centers', 'Reference locations curated in this project. It does not represent a complete facility inventory.'),
    exchanges: curated('Stock Exchanges', 'Reference locations curated in this project. It is not a trading-venue entitlement feed.'),
    centralbanks: curated('Central Banks', 'Reference locations curated in this project.'),
    financialCenters: curated('Financial Centers', 'Reference locations curated in this project.'),
    commodityPorts: curated('Commodity Ports', 'Reference locations curated in this project. It is not a live port-operations feed.'),
    militaryBases: definition('Military Bases', 'hybrid', 86_400, [
      CURATED,
      source('Wikidata', 'https://www.wikidata.org', 'public'),
    ], 'Curated reference locations augmented best-effort from public Wikidata records; coverage is incomplete.'),
    criticalMinerals: curated('Critical Minerals', 'Reference locations curated in this project. It is not a licensed mining-production dataset.'),
    refugeeHotspots: definition('Displacement', 'hybrid', 86_400, [
      CURATED,
      source('UNHCR Refugee Data Finder', 'https://www.unhcr.org/refugee-statistics', 'official'),
    ], 'Curated hotspot locations augmented with public UNHCR aggregate data where matches are available.'),
    conflictZones: definition('Conflict Zones', 'hybrid', 900, [
      CURATED,
      source('GDELT', 'https://www.gdeltproject.org', 'public'),
      source('ACLED', 'https://acleddata.com', 'public'),
    ], 'Curated context plus public event feeds. Geographic mentions and events are not independently verified intelligence.'),
    sanctions: curated('Sanctioned States', 'Reference locations curated in this project. It is not a legal sanctions-screening service.'),
    diseaseOutbreaks: definition('Disease Outbreaks', 'hybrid', 900, [
      CURATED,
      source('ProMED', 'https://promedmail.org', 'public'),
      source('WHO Disease Outbreak News', 'https://www.who.int/emergencies/disease-outbreak-news', 'official'),
    ], 'Curated context plus public alert feeds. Points are coarse regional geotags, not case locations.'),
    techHQs: curated('Tech HQs', 'Reference locations curated in this project.'),
    cloudRegions: curated('Cloud Regions', 'Reference locations curated in this project. It is not a live cloud-capacity feed.'),
    startupHubs: curated('Startup Hubs', 'Reference locations curated in this project.'),
    gccInvestments: curated('GCC Sovereign Funds', 'Reference locations curated in this project.'),
    economicCenters: curated('Economic Centers', 'Reference locations curated in this project.'),
    internetExchanges: curated('Internet Exchanges', 'Reference locations curated in this project. It is not a live reachability or outage feed.'),
    gpsJamming: definition('GPS Jamming', 'hybrid', 21_600, [
      CURATED,
      source('GPSJam', 'https://gpsjam.org', 'public'),
    ], 'Curated hotspots plus a public interference probability grid. It is not a definitive attribution source.'),
    webcams: curated('Curated Webcams', 'Reference webcam links curated in this project; availability can change without notice.'),
    'webcams-live': definition('Live Webcams', 'live', 3600, [
      source('Windy Webcams', 'https://www.windy.com', 'public'),
    ], 'Third-party live webcam catalog. Image and player availability is provider-controlled.'),
    tradeRoutes: curated('Trade Routes', 'Reference routes curated in this project. They are illustrative paths, not live vessel tracks.'),
    cables: definition('Undersea Cables', 'hybrid', 86_400, [
      CURATED,
      source('OpenStreetMap Overpass API', 'https://overpass-api.de', 'public'),
    ], 'Curated routes augmented best-effort from public OpenStreetMap data; it is not a complete cable inventory.'),
    pipelines: definition('Pipelines', 'hybrid', 86_400, [
      CURATED,
      source('OpenStreetMap Overpass API', 'https://overpass-api.de', 'public'),
    ], 'Curated routes augmented best-effort from public OpenStreetMap data; it is not a live operations feed.'),
    infrastructure: curated('Infrastructure', 'Derived infrastructure response built from the project-curated reference catalog.'),
  });

  function validTimestamp(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }

  function copySources(sources) {
    return sources.map((item) => ({ name: item.name, url: item.url, authority: item.authority }));
  }

  function statusFor(def, options) {
    if (options.unavailable) return 'unavailable';
    if (options.degraded) return 'degraded';
    if (def.dataClass === 'curated') return 'reference';
    if (def.dataClass === 'computed') return 'computed';
    if (def.dataClass === 'model-derived') return 'derived';
    return options.cached ? 'cached' : 'live';
  }

  function getLayerProvenance(layerId, options = {}) {
    const def = LAYER_DEFINITIONS[layerId] || definition(
      String(layerId || 'Unknown layer'),
      'unknown',
      null,
      [],
      'No provenance definition is available for this layer.'
    );
    const sourceUpdatedAt = validTimestamp(options.sourceUpdatedAt);
    const servedAt = validTimestamp(options.servedAt) || new Date().toISOString();
    return {
      layerId,
      label: def.label,
      dataClass: def.dataClass,
      status: statusFor(def, options),
      cacheState: options.cached ? 'cached' : 'fresh',
      sourceUpdatedAt,
      servedAt,
      refreshSeconds: def.refreshSeconds,
      sources: copySources(def.sources),
      note: def.note,
    };
  }

  function buildLayerCatalog(options = {}) {
    const catalog = {};
    for (const layerId of Object.keys(LAYER_DEFINITIONS)) {
      catalog[layerId] = getLayerProvenance(layerId, options);
    }
    return catalog;
  }

  function payloadObject(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
    return { data: payload };
  }

  function annotateMapPayload(payload, layerId, options = {}) {
    const body = payloadObject(payload);
    const servedAt = validTimestamp(options.servedAt) || new Date().toISOString();
    const sourceUpdatedAt = validTimestamp(options.sourceUpdatedAt || body._updated);
    if (layerId === 'layers') {
      return {
        ...body,
        provenance: {
          schemaVersion: SCHEMA_VERSION,
          kind: 'layer-catalog',
          cacheState: options.cached ? 'cached' : 'fresh',
          sourceUpdatedAt,
          servedAt,
          catalog: buildLayerCatalog({ ...options, servedAt, sourceUpdatedAt }),
        },
      };
    }
    return {
      ...body,
      provenance: {
        schemaVersion: SCHEMA_VERSION,
        kind: 'layer',
        layer: getLayerProvenance(layerId, { ...options, servedAt, sourceUpdatedAt }),
      },
    };
  }

  const api = {
    SCHEMA_VERSION,
    LAYER_DEFINITIONS,
    getLayerProvenance,
    buildLayerCatalog,
    annotateMapPayload,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalMapProvenance = api;
})();

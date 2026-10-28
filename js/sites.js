// Sites page: the individual observation stations behind the site-based
// products (AmeriFlux, NEON flux towers, PhenoCam cameras). An OpenLayers
// point map of the stations, colored by network; click a station to see its
// own monthly time series (data/sites/*), every response overlaid on one
// shared axis. Reuses the Map page's WUS view + boundary layer.

const sitesState = {
  networks: {},        // key -> full network JSON (sites + series)
  visible: new Set(),  // networks currently shown on the map
  selected: null,      // { network, site } of the clicked station
  series: "value",     // value | anomaly
  stateFilter: "",     // "" = all states; otherwise a 2-letter state filtering the dropdown
  map: null,
  layers: {},          // network -> ol vector layer
};

const SITES_EXTENT = ol.proj.transformExtent([-125.0, 31.0, -101.5, 49.5], "EPSG:4326", "EPSG:3857");
const SITES_PAN_EXTENT = ol.proj.transformExtent([-125.5, 30.5, -101.0, 50.0], "EPSG:4326", "EPSG:3857");

// Every response a site carries shares the network's units, so they overlay on
// one axis (PhenoCam GCC+RCC, AmeriFlux GPP+NEE). Each response gets its own
// color so the two curves stay distinct; GCC green / RCC red mirrors the
// greenness vs. senescence meaning. Unlisted responses fall back to the
// network marker color.
const RESPONSE_COLORS = {
  GCC: "#238b45", RCC: "#cb181d",
  // GPP (uptake) green vs NEE blue -- a strongly distinct, colorblind-safe pair
  // (not the old green/red), and NEE no longer shares the AmeriFlux network's
  // own red marker color.
  GPP: "#238b45", NEE: "#2171b5",
};

// Flux towers lead this page: AmeriFlux + NEON are listed first, shown on by
// default, and the page opens on one of their stations. PhenoCam's ~200 cameras
// are secondary (hidden until toggled on) so the tower network isn't buried in
// camera dots.
const FLUX_NETWORKS = ["AmeriFlux", "NEON"];
function orderedNetworks(networks) {
  const rank = (k) => { const i = FLUX_NETWORKS.indexOf(k); return i === -1 ? FLUX_NETWORKS.length : i; };
  return networks.slice().sort((a, b) => rank(a.key) - rank(b.key));
}
// Open on a flux tower (prefer one carrying 2026 data) so the page leads with a
// GPP/NEE record instead of an empty "click a station" prompt.
function selectDefaultFluxSite() {
  for (const key of FLUX_NETWORKS) {
    const net = sitesState.networks[key];
    if (!net || !net.sites.length) continue;
    const has2026 = (s) => (net.responses || []).some((r) => s.series[r] && s.series[r].dates.some((d) => String(d).startsWith("2026")));
    const site = net.sites.find(has2026) || net.sites[0];
    selectSite(key, site.site);
    return;
  }
}

function buildSitesMap() {
  const boundary = new ol.layer.Vector({
    source: new ol.source.Vector({ url: assetUrl("data/western_states.geojson"), format: new ol.format.GeoJSON() }),
    style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#1b1b1b", width: 1 }) }),
    zIndex: 5,
  });
  sitesState.map = new ol.Map({
    target: "sites-map",
    layers: [new ol.layer.Tile({ source: new ol.source.OSM({ opaque: false }), opacity: 0.5 }), boundary],
    view: new ol.View({ center: ol.proj.fromLonLat([-113, 40]), zoom: 5, extent: SITES_PAN_EXTENT, showFullExtent: true }),
  });
  const mapEl = document.getElementById("sites-map");
  mapEl.style.aspectRatio = `${(SITES_EXTENT[2] - SITES_EXTENT[0]) / (SITES_EXTENT[3] - SITES_EXTENT[1])}`;
  sitesState.map.updateSize();
  sitesState.map.getView().fit(SITES_EXTENT, { size: sitesState.map.getSize() || [600, 500] });

  sitesState.map.on("click", (event) => {
    const feature = sitesState.map.forEachFeatureAtPixel(event.pixel, (f) => f, { hitTolerance: 5 });
    if (feature && feature.get("site")) selectSite(feature.get("network"), feature.get("site"));
  });
  sitesState.map.on("pointermove", (event) => {
    const hit = sitesState.map.hasFeatureAtPixel(event.pixel, { hitTolerance: 5 });
    sitesState.map.getTargetElement().style.cursor = hit ? "pointer" : "";
  });
}

// Flux-tower networks (AmeriFlux, NEON) get larger markers than the PhenoCam
// camera network, which is much denser and secondary here.
function networkRadius(network) { return network === "PhenoCam" ? 4 : 7; }

function markerStyle(color, selected, radius) {
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: selected ? radius + 2.5 : radius,
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({ color: selected ? "#1b1b1b" : "#fff", width: selected ? 2.5 : 1.3 }),
    }),
  });
}

function buildNetworkLayer(network) {
  const net = sitesState.networks[network];
  const features = net.sites.map((s) => {
    const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([s.lon, s.lat])) });
    f.set("network", network);
    f.set("site", s.site);
    f.setStyle(markerStyle(net.color, false, networkRadius(network)));
    return f;
  });
  const layer = new ol.layer.Vector({ source: new ol.source.Vector({ features }), zIndex: 10 });
  sitesState.layers[network] = layer;
  sitesState.map.addLayer(layer);
}

function refreshMarkerStyles() {
  Object.entries(sitesState.networks).forEach(([network, net]) => {
    const layer = sitesState.layers[network];
    if (!layer) return;
    layer.getSource().getFeatures().forEach((f) => {
      const isSel = sitesState.selected && sitesState.selected.network === network && sitesState.selected.site === f.get("site");
      f.setStyle(markerStyle(net.color, isSel, networkRadius(network)));
    });
  });
}

function siteRecord(network, site) {
  return sitesState.networks[network].sites.find((s) => s.site === site);
}

// Site dropdown grouped by dataset (network), each network's sites A-Z.
// State filter so the dropdown (esp. PhenoCam's ~200 cameras) isn't one giant
// list. States come from each site's own `state` (point-in-polygon, set in
// dashboard_export.py::export_sites).
function populateSiteStateSelect() {
  const sel = document.getElementById("sites-state-select");
  if (!sel) return;
  const states = [...new Set(
    Object.values(sitesState.networks).flatMap((net) => net.sites.map((s) => s.state)).filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">All states</option>' + states.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function populateSiteSelect() {
  const sel = document.getElementById("sites-site-select");
  if (!sel) return;
  const filter = sitesState.stateFilter;
  let html = '<option value="">Select a site&hellip;</option>';
  Object.entries(sitesState.networks).forEach(([network, net]) => {
    const sites = net.sites
      .filter((s) => !filter || s.state === filter)
      .slice().sort((a, b) => String(a.site).localeCompare(String(b.site)));
    if (!sites.length) return;
    html += `<optgroup label="${net.label}">` + sites.map((s) =>
      `<option value="${network}|${s.site}">${s.site}</option>`
    ).join("") + "</optgroup>";
  });
  sel.innerHTML = html;
  if (sitesState.selected) sel.value = `${sitesState.selected.network}|${sitesState.selected.site}`;
}

function selectSite(network, site) {
  sitesState.selected = { network, site };
  const siteSel = document.getElementById("sites-site-select");
  if (siteSel) siteSel.value = `${network}|${site}`;
  refreshMarkerStyles();
  renderSiteChart();
}

function renderSiteChart() {
  const el = document.getElementById("sites-chart");
  if (!sitesState.selected) { el.innerHTML = ""; return; }
  const { network, site } = sitesState.selected;
  const net = sitesState.networks[network];
  const rec = siteRecord(network, site);
  const responses = net.responses.filter((r) => rec.series[r]);
  document.getElementById("sites-chart-title").textContent = `${site} — ${net.label}`;
  if (!responses.length) { el.innerHTML = '<p class="chart-empty">No data at this site.</p>'; return; }
  const isAnom = sitesState.series === "anomaly";
  // Every response at a site shares the network's units, so overlay them on one
  // axis (GCC+RCC for PhenoCam, GPP+NEE for AmeriFlux) rather than one at a time.
  const traces = responses.map((r) => {
    const s = rec.series[r];
    const color = RESPONSE_COLORS[r] || net.color;
    return {
      x: s.dates, y: isAnom ? s.anomaly : s.value, type: "scatter", mode: "lines+markers",
      name: r, line: { color, width: 2.4 }, marker: { size: 4, color },
      hovertemplate: `${r} %{x|%Y-%m}: %{y:.2f}<extra></extra>`,
    };
  });
  const yUnits = (net.units || "").replace("umol", "µmol");
  const yTitle = isAnom ? `Anomaly (${yUnits})`
    : responses.length === 1 ? `${responses[0]} (${yUnits})` : `Value (${yUnits})`;
  Plotly.newPlot(el, traces, {
    margin: { t: 10, r: 16, b: responses.length > 1 ? 70 : 44, l: 60 },
    // Solid zero line whenever 0 is in view -- NEE (and anomalies) cross it, so
    // the sign (uptake below 0 / release above) reads at a glance; for GCC/RCC
    // (~0.3-0.6, 0 off-axis) Plotly simply doesn't draw it.
    yaxis: { title: yTitle, ...PLOTLY_AXIS_LINE, zeroline: true, zerolinecolor: "#888", zerolinewidth: 1.5 },
    xaxis: { title: "Year", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    showlegend: responses.length > 1,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.2, yanchor: "top" },
  }, { responsive: true, displaylogo: false });
}

function buildNetworkToggles(index) {
  const row = document.getElementById("sites-network-toggles");
  row.innerHTML = "";
  orderedNetworks(index.networks).forEach((n) => {
    const label = document.createElement("label");
    label.className = "boundary-toggle sites-network-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = FLUX_NETWORKS.includes(n.key);
    cb.addEventListener("change", () => {
      if (cb.checked) sitesState.visible.add(n.key); else sitesState.visible.delete(n.key);
      if (sitesState.layers[n.key]) sitesState.layers[n.key].setVisible(cb.checked);
    });
    const swatch = document.createElement("span");
    swatch.className = "sites-network-swatch"; swatch.style.background = n.color;
    label.appendChild(cb);
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(`${n.label} (${n.n_sites})`));
    row.appendChild(label);
  });
}

async function init() {
  if (typeof ol === "undefined") {
    document.getElementById("sites-map").innerHTML = '<p class="chart-empty">Map library failed to load.</p>';
    return;
  }
  const index = await fetch(assetUrl("data/sites/index.json")).then((r) => (r.ok ? r.json() : null));
  if (!index || !index.networks.length) {
    document.getElementById("sites").insertAdjacentHTML("beforeend", '<p class="chart-empty">Site data not available yet.</p>');
    return;
  }
  buildSitesMap();
  buildNetworkToggles(index);
  const loaded = await Promise.all(index.networks.map((n) =>
    fetch(assetUrl(`data/sites/${n.key}.json`)).then((r) => r.json())));
  loaded.forEach((net) => {
    sitesState.networks[net.network] = net;
    if (FLUX_NETWORKS.includes(net.network)) sitesState.visible.add(net.network);
    buildNetworkLayer(net.network);
    if (!FLUX_NETWORKS.includes(net.network) && sitesState.layers[net.network]) {
      sitesState.layers[net.network].setVisible(false);
    }
  });

  populateSiteStateSelect();
  populateSiteSelect();
  selectDefaultFluxSite();
  document.getElementById("sites-state-select").addEventListener("change", (e) => { sitesState.stateFilter = e.target.value; populateSiteSelect(); });
  document.getElementById("sites-site-select").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const [network, site] = e.target.value.split("|");
    selectSite(network, site);
  });
  document.getElementById("sites-series-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-series]");
    if (!b) return;
    sitesState.series = b.dataset.series;
    document.querySelectorAll("#sites-series-toggle button").forEach((x) => x.classList.toggle("active", x === b));
    renderSiteChart();
  });
}

init();

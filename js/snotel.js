// SNOTEL page (daily resolution): the NRCS automated snow network. A station
// map colored by SWE relative to the smoothed day-of-year normal for a selected
// DAY, scrubbable through the snow season; a per-station daily record (selected
// water year vs the climatology percentile band + a long 1st-of-month history);
// and the elevation dependence of the anomaly (the warm-snow-drought signature).
// Data: data/snotel/{index,stations,climatology,history}.json + daily/{wy}.json.

const snotelState = {
  stations: null, climatology: null, history: null, waterYears: [],
  metric: "swe", wy: null, dayIndex: 182, selected: null, stateFilter: "",
  map: null, layer: null, dailyCache: {}, playTimer: null, palette: null,
};

// A continuous NCL palette (from ncl-colormaps.js) by name, used when the user
// picks a colorbar instead of each metric's default stepped bins. SNOTEL offers
// only the continuous groups (diverging + sequential), not the discrete tables,
// since its fields are continuous quantities.
function snotelPaletteColors(name) {
  if (typeof NCL_COLORMAPS === "undefined") return null;
  for (const theme of ["sequential", "diverging"]) {
    const group = NCL_COLORMAPS[theme];
    if (group && group[name]) return group[name].colors;
  }
  return null;
}

const SNOTEL_EXTENT = ol.proj.transformExtent([-125.0, 31.0, -101.5, 49.5], "EPSG:4326", "EPSG:3857");
const SNOTEL_PAN_EXTENT = ol.proj.transformExtent([-125.5, 30.5, -101.0, 50.0], "EPSG:4326", "EPSG:3857");
const PLAY_STEP_DAYS = 2;
const PLAY_INTERVAL_MS = 55;

const METRIC_SCALES = {
  pct_of_median: {
    label: "SWE % of median", field: "pct_of_median",
    bounds: [0, 50, 70, 90, 110, 130, 150, 200],
    colors: ["#8c510a", "#bf812d", "#dfc27d", "#f5f5f5", "#c7eae5", "#5ab4ac", "#2166ac", "#053061"],
  },
  percentile: {
    label: "SWE percentile", field: "percentile",
    bounds: [0, 10, 30, 50, 70, 90],
    colors: ["#b2182b", "#ef8a62", "#fddbc7", "#d1e5f0", "#67a9cf", "#2166ac"],
  },
  swe: {
    label: "SWE (mm)", field: "swe",
    bounds: [0, 50, 150, 300, 500, 750, 1000, 1500],
    colors: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08306b"],
  },
};

function colorFor(metric, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const scale = METRIC_SCALES[metric];
  if (snotelState.palette) {
    const pal = snotelPaletteColors(snotelState.palette);
    if (pal) {
      // Percentile is a 0-100 quantity; its stepped bins stop at 90, but the
      // continuous palette must span the full 0-100 or the top decile all maps
      // to a single color.
      const lo = scale.bounds[0];
      const hi = metric === "percentile" ? 100 : scale.bounds[scale.bounds.length - 1];
      const f = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
      return pal[Math.round(f * (pal.length - 1))];
    }
  }
  let bin = 0;
  while (bin < scale.bounds.length - 1 && value >= scale.bounds[bin + 1]) bin++;
  return scale.colors[bin];
}

// Date for a day index within the current water year (day 0 = Oct 1 of WY-1).
function dateForDay(wy, dayIndex) {
  const d = new Date(Date.UTC(wy - 1, 9, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d;
}
function ymd(d) { return d.toISOString().slice(0, 10); }
// Calendar day-of-year (1-365, leap-adjusted to match the reduction).
function doyOf(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  let doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
  const leap = (d.getUTCFullYear() % 4 === 0 && d.getUTCFullYear() % 100 !== 0) || d.getUTCFullYear() % 400 === 0;
  if (leap && doy >= 60) doy -= 1;
  return Math.min(Math.max(doy, 1), 365);
}

function currentDaily() { return snotelState.dailyCache[snotelState.wy]; }

function metricValue(triplet) {
  const wyData = currentDaily();
  if (!wyData) return null;
  const s = wyData.stations[triplet];
  if (!s) return null;
  const v = s[METRIC_SCALES[snotelState.metric].field][snotelState.dayIndex];
  return v === null || v === undefined ? null : v;
}

function markerStyle(color, selected) {
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: selected ? 8 : 5,
      fill: new ol.style.Fill({ color: color || "rgba(150,150,150,0.3)" }),
      stroke: new ol.style.Stroke({ color: selected ? "#1b1b1b" : "#333", width: selected ? 2.5 : 0.8 }),
    }),
  });
}

function buildMap() {
  const boundary = new ol.layer.Vector({
    source: new ol.source.Vector({ url: assetUrl("data/western_states.geojson"), format: new ol.format.GeoJSON() }),
    style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#1b1b1b", width: 1 }) }), zIndex: 5,
  });
  snotelState.map = new ol.Map({
    target: "snotel-map",
    layers: [new ol.layer.Tile({ source: new ol.source.OSM({ opaque: false }), opacity: 0.5 }), boundary],
    view: new ol.View({ center: ol.proj.fromLonLat([-113, 40]), zoom: 5, extent: SNOTEL_PAN_EXTENT, showFullExtent: true }),
  });
  const mapEl = document.getElementById("snotel-map");
  mapEl.style.aspectRatio = `${(SNOTEL_EXTENT[2] - SNOTEL_EXTENT[0]) / (SNOTEL_EXTENT[3] - SNOTEL_EXTENT[1])}`;
  snotelState.map.updateSize();
  snotelState.map.getView().fit(SNOTEL_EXTENT, { size: snotelState.map.getSize() || [600, 500] });

  const features = snotelState.stations.stations.map((st) => {
    const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([st.lon, st.lat])) });
    f.set("triplet", st.triplet);
    return f;
  });
  snotelState.layer = new ol.layer.Vector({ source: new ol.source.Vector({ features }), zIndex: 10 });
  snotelState.map.addLayer(snotelState.layer);
  snotelState.map.on("click", (event) => {
    const feature = snotelState.map.forEachFeatureAtPixel(event.pixel, (f) => f, { hitTolerance: 4 });
    if (feature && feature.get("triplet")) selectStation(feature.get("triplet"));
  });
  snotelState.map.on("pointermove", (event) => {
    snotelState.map.getTargetElement().style.cursor = snotelState.map.hasFeatureAtPixel(event.pixel, { hitTolerance: 4 }) ? "pointer" : "";
  });
}

function refreshMap() {
  if (!snotelState.layer) return;
  snotelState.layer.getSource().getFeatures().forEach((f) => {
    const t = f.get("triplet");
    f.setStyle(markerStyle(colorFor(snotelState.metric, metricValue(t)), t === snotelState.selected));
  });
  renderLegend();
  renderElevation();
  updateDayLabel();
}

// Month ticks under the day slider: the 1st of each water-year month (Oct..Sep)
// positioned by its real day index as a fraction of this water year's own track
// length -- derived from actual dates and the loaded year's n_days, so a leap
// water year (366 days) neither drifts the ticks nor clips Sep 30.
function buildSliderAxis() {
  const axis = document.getElementById("snotel-slider-axis");
  const wy = snotelState.wy;
  const nDays = (currentDaily() && currentDaily().n_days) || 365;
  const wyStart = Date.UTC(wy - 1, 9, 1);
  const months = [[10, wy - 1], [11, wy - 1], [12, wy - 1], [1, wy], [2, wy], [3, wy], [4, wy], [5, wy], [6, wy], [7, wy], [8, wy], [9, wy]];
  const labels = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  axis.innerHTML = months.map(([m, y], i) => {
    const dayIndex = Math.round((Date.UTC(y, m - 1, 1) - wyStart) / 86400000);
    return `<span class="snotel-axis-tick" style="left:${(dayIndex / (nDays - 1)) * 100}%">${labels[i]}</span>`;
  }).join("");
}

// Set the day slider's max (and clamp the current day) to the loaded water
// year's own length -- 366 for a leap water year, so its final day (Sep 30) is
// reachable instead of being cut off by a hardcoded 364.
function updateSliderRange() {
  const slider = document.getElementById("snotel-day-slider");
  const nDays = (currentDaily() && currentDaily().n_days) || 365;
  slider.max = String(nDays - 1);
  if (snotelState.dayIndex > nDays - 1) {
    snotelState.dayIndex = nDays - 1;
    slider.value = String(snotelState.dayIndex);
  }
}

function updateDayLabel() {
  const d = dateForDay(snotelState.wy, snotelState.dayIndex);
  document.getElementById("snotel-day-label").textContent =
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Stations with no value for the selected day are drawn in this gray on the map
// (same rgba used for the unavailable-marker fill below); surface it in the
// legend so a gray dot isn't an unexplained symbol.
const NO_DATA_SWATCH =
  `<span class="snotel-legend-item"><span class="snotel-legend-swatch" style="background:rgba(150,150,150,0.3)"></span>no data</span>`;

function renderLegend() {
  const scale = METRIC_SCALES[snotelState.metric];
  const d = dateForDay(snotelState.wy, snotelState.dayIndex);
  const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const label = `<span class="snotel-legend-label">${scale.label} · ${when}</span>`;
  const pal = snotelState.palette && snotelPaletteColors(snotelState.palette);
  if (pal) {
    // Match colorFor(): percentile colors span the full 0-100 even though the
    // stepped bins stop at 90, so the continuous bar must be labeled 0-100 too.
    const lo = scale.bounds[0];
    const hi = snotelState.metric === "percentile" ? 100 : scale.bounds[scale.bounds.length - 1];
    document.getElementById("snotel-legend").innerHTML = label +
      `<span class="snotel-legend-cont">${lo}` +
      `<span class="snotel-legend-bar" style="background-image:linear-gradient(to right, ${pal.join(", ")})"></span>` +
      `${hi}</span>` + NO_DATA_SWATCH;
    return;
  }
  const swatches = scale.colors.map((cc, i) => {
    const lo = scale.bounds[i], hi = i < scale.bounds.length - 1 ? scale.bounds[i + 1] : null;
    return `<span class="snotel-legend-item"><span class="snotel-legend-swatch" style="background:${cc}"></span>${hi === null ? "≥ " + lo : lo + "–" + hi}</span>`;
  }).join("");
  document.getElementById("snotel-legend").innerHTML = label + swatches + NO_DATA_SWATCH;
}

// ------------------------------------------------- station detail
function stationMeta(triplet) { return snotelState.stations.stations.find((s) => s.triplet === triplet); }

// Interpolate a climatology percentile band value at a given day-of-year from
// the downsampled (every-5-day) climatology points.
function bandAt(band, key, doy) {
  const xs = band.doy, ys = band[key];
  if (doy <= xs[0]) return ys[0];
  if (doy >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (i < xs.length && xs[i] < doy) i++;
  const frac = (doy - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + frac * (ys[i] - ys[i - 1]);
}

// Station dropdown: grouped by state, each state's stations sorted
// highest-elevation first, so sites can be found without hunting for a dot.
// Populate the State filter from the station metadata (plus an "All states"
// option). Picking a state narrows the ~800-station dropdown to one state so
// it isn't one giant list.
function populateStateSelect() {
  const sel = document.getElementById("snotel-state-select");
  if (!sel) return;
  const states = [...new Set(snotelState.stations.stations.map((s) => s.state).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All states</option>' + states.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function populateStationSelect() {
  const sel = document.getElementById("snotel-station-select");
  if (!sel) return;
  const filter = snotelState.stateFilter;
  const byState = {};
  snotelState.stations.stations.forEach((st) => {
    if (filter && st.state !== filter) return;
    (byState[st.state] = byState[st.state] || []).push(st);
  });
  let html = '<option value="">Select a station&hellip;</option>';
  Object.keys(byState).sort().forEach((state) => {
    const list = byState[state].slice().sort((a, b) => (b.elev_ft || 0) - (a.elev_ft || 0));
    const options = list.map((st) =>
      `<option value="${st.triplet}">${st.name}${st.elev_ft ? " (" + st.elev_ft.toLocaleString() + " ft)" : ""}</option>`
    ).join("");
    // When filtered to a single state the optgroup wrapper is redundant.
    html += filter ? options : `<optgroup label="${state}">${options}</optgroup>`;
  });
  sel.innerHTML = html;
  // Keep the current station shown as selected if it's still in the list.
  if (snotelState.selected) sel.value = snotelState.selected;
}

function selectStation(triplet) {
  snotelState.selected = triplet;
  const sel = document.getElementById("snotel-station-select");
  if (sel && sel.value !== triplet) sel.value = triplet;
  renderDetail();
  refreshMap();
}

function renderDetail() {
  const triplet = snotelState.selected;
  if (!triplet) return;
  // Restore the reserved chart heights once a station is actually chosen (they
  // start collapsed so an unselected page isn't a ~720px blank band).
  document.getElementById("snotel-detail-chart").style.height = "420px";
  document.getElementById("snotel-history-chart").style.height = "300px";
  const meta = stationMeta(triplet);
  const wyData = currentDaily();
  const s = wyData && wyData.stations[triplet];
  const band = snotelState.climatology.stations[triplet];
  document.getElementById("snotel-detail-title").textContent =
    `${meta.name}, ${meta.state} — ${meta.elev_ft ? meta.elev_ft.toLocaleString() + " ft" : "elevation n/a"}`;
  document.getElementById("snotel-detail-note").textContent = band
    ? `Daily SWE, water year ${snotelState.wy}, vs the ${snotelState.climatology.baseline_start_year}–${snotelState.climatology.baseline_end_year} normal (median, 10th–90th percentile band).`
    : `Daily SWE, water year ${snotelState.wy} (no climatology normal available for this station).`;

  const nDays = wyData ? wyData.n_days : 365;
  const dates = [], doys = [];
  for (let i = 0; i < nDays; i++) { const d = dateForDay(snotelState.wy, i); dates.push(ymd(d)); doys.push(doyOf(d)); }
  const yearCurve = s ? s.swe : dates.map(() => null);
  const median = band ? doys.map((dy) => bandAt(band, "p50", dy)) : null;
  const p10 = band ? doys.map((dy) => bandAt(band, "p10", dy)) : null;
  const p90 = band ? doys.map((dy) => bandAt(band, "p90", dy)) : null;
  const traces = [];
  if (band) {
    traces.push({ x: dates, y: p10, type: "scatter", mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" });
    traces.push({ x: dates, y: p90, type: "scatter", mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(33,102,172,0.15)", name: "10th–90th pct", hoverinfo: "skip" });
    traces.push({ x: dates, y: median, type: "scatter", mode: "lines", line: { color: "#2166ac", width: 2, dash: "dot" }, name: "Normal (median)" });
  }
  traces.push({ x: dates, y: yearCurve, type: "scatter", mode: "lines", line: { color: "#8c510a", width: 2.5 }, name: `WY ${snotelState.wy}`, connectgaps: false });
  Plotly.newPlot("snotel-detail-chart", traces, {
    margin: { t: 10, r: 16, b: 40, l: 60 },
    yaxis: { title: "SWE (mm)", rangemode: "tozero", ...PLOTLY_AXIS_LINE },
    xaxis: { showgrid: false, dtick: "M1", tickformat: "%b", ...PLOTLY_AXIS_LINE },
    legend: { orientation: "h", y: -0.18 }, font: { family: "Source Sans Pro, sans-serif", size: 13 },
  }, { responsive: true, displaylogo: false });

  // Long 1st-of-month history.
  const h = snotelState.history.stations[triplet];
  if (h) {
    const histDates = h.swe.map((_, i) => snotelState.history.months[h.start + i] + "-01");
    Plotly.newPlot("snotel-history-chart", [{
      x: histDates, y: h.swe, type: "scatter", mode: "lines", line: { color: "#2166ac", width: 1 },
      hovertemplate: "%{x|%Y-%m}: %{y:.0f} mm<extra></extra>",
    }], {
      margin: { t: 10, r: 16, b: 40, l: 60 },
      yaxis: { title: "SWE (mm, start of month)", rangemode: "tozero", ...PLOTLY_AXIS_LINE },
      xaxis: { title: "Full record", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
      font: { family: "Source Sans Pro, sans-serif", size: 13 },
    }, { responsive: true, displaylogo: false });
  }
}

// ------------------------------------------------- elevation lens
function renderElevation() {
  const d = dateForDay(snotelState.wy, snotelState.dayIndex);
  document.getElementById("snotel-elev-title").textContent =
    `Snow drought by elevation — ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  const wyData = currentDaily();
  // The scatter follows the same metric selector as the map (SWE % of normal /
  // percentile / raw mm). "% of normal" is a ratio whose day-of-year normal
  // denominator can be tiny at low or marginal-snow stations, so one station
  // can read many hundreds of % in a decent year (observed up to ~7000%) and
  // stretch the whole y-axis. Clamp ONLY that metric to PCT_CAP (color + hover
  // keep the true value; a clamped point draws as an up-triangle on the cap).
  // Raw mm and percentile are naturally bounded and need no clamp.
  const metric = snotelState.metric;
  const scale = METRIC_SCALES[metric];
  const PCT_CAP = 200;
  const clamp = metric === "pct_of_median";
  const xs = [], yPlot = [], yTrue = [], colors = [], text = [], symbols = [];
  if (wyData) {
    snotelState.stations.stations.forEach((st) => {
      if (st.elev_ft === null) return;
      const s = wyData.stations[st.triplet];
      const v = s ? s[scale.field][snotelState.dayIndex] : null;
      if (v === null || v === undefined) return;
      xs.push(st.elev_ft);
      yPlot.push(clamp ? Math.min(v, PCT_CAP) : v);
      yTrue.push(v);
      colors.push(colorFor(metric, v));
      text.push(`${st.name}, ${st.state}`);
      symbols.push(clamp && v > PCT_CAP ? "triangle-up" : "circle");
    });
  }
  if (!xs.length) {
    document.getElementById("snotel-elev-chart").innerHTML =
      '<p class="chart-empty">No station data for this day.</p>';
    return;
  }
  const refAt = (y) => ({ type: "line", x0: 0, x1: 1, xref: "paper", y0: y, y1: y, line: { color: "#888", width: 1, dash: "dash" } });
  const yaxis = { title: scale.label, ...PLOTLY_AXIS_LINE };
  const shapes = [];
  if (metric === "pct_of_median") { yaxis.range = [0, PCT_CAP]; shapes.push(refAt(100)); }
  else if (metric === "percentile") { yaxis.range = [0, 100]; shapes.push(refAt(50)); }
  else { yaxis.rangemode = "tozero"; }
  const unit = metric === "pct_of_median" ? "% of median" : metric === "percentile" ? "th percentile" : " mm";
  Plotly.newPlot("snotel-elev-chart", [{
    x: xs, y: yPlot, text, customdata: yTrue, type: "scatter", mode: "markers",
    marker: { size: 6, color: colors, symbol: symbols, line: { color: "#333", width: 0.5 } },
    hovertemplate: `%{text}<br>%{x:,} ft · %{customdata:.0f}${unit}<extra></extra>`,
  }], {
    margin: { t: 10, r: 16, b: 46, l: 60 },
    xaxis: { title: "Elevation (ft)", showgrid: false, ...PLOTLY_AXIS_LINE },
    yaxis,
    shapes,
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
  }, { responsive: true, displaylogo: false });
}

// ------------------------------------------------- water-year load + play
async function loadWaterYear(wy) {
  if (!snotelState.dailyCache[wy]) {
    snotelState.dailyCache[wy] = await fetch(assetUrl(`data/snotel/daily/${wy}.json`)).then((r) => r.json());
  }
  return snotelState.dailyCache[wy];
}

function stopPlay() {
  if (snotelState.playTimer) { clearInterval(snotelState.playTimer); snotelState.playTimer = null; }
  const btn = document.getElementById("snotel-play");
  btn.innerHTML = "&#9654;"; btn.classList.remove("playing");
}
function togglePlay() {
  if (snotelState.playTimer) { stopPlay(); return; }
  const btn = document.getElementById("snotel-play");
  btn.innerHTML = "&#10073;&#10073;"; btn.classList.add("playing");
  const slider = document.getElementById("snotel-day-slider");
  const lastDay = ((currentDaily() && currentDaily().n_days) || 365) - 1;
  snotelState.playTimer = setInterval(() => {
    let next = snotelState.dayIndex + PLAY_STEP_DAYS;
    if (next > lastDay) next = 0;
    snotelState.dayIndex = next; slider.value = String(next);
    refreshMap();
  }, PLAY_INTERVAL_MS);
}

async function changeWaterYear(wy) {
  stopPlay();
  snotelState.wy = wy;
  await loadWaterYear(wy);
  buildSliderAxis();
  updateSliderRange();
  refreshMap();
  if (snotelState.selected) renderDetail();
}

async function init() {
  if (typeof ol === "undefined") { document.getElementById("snotel-map").innerHTML = '<p class="chart-empty">Map library failed to load.</p>'; return; }
  const [index, stations, climatology, history] = await Promise.all([
    fetch(assetUrl("data/snotel/index.json")).then((r) => r.json()),
    fetch(assetUrl("data/snotel/stations.json")).then((r) => r.json()),
    fetch(assetUrl("data/snotel/climatology.json")).then((r) => r.json()),
    fetch(assetUrl("data/snotel/history.json")).then((r) => r.json()),
  ]);
  snotelState.stations = stations; snotelState.climatology = climatology; snotelState.history = history;
  snotelState.waterYears = index.water_years;
  snotelState.wy = index.water_years[index.water_years.length - 1];
  await loadWaterYear(snotelState.wy);
  buildMap();

  buildSliderAxis();
  updateSliderRange();
  const wySel = document.getElementById("snotel-wy-select");
  index.water_years.slice().reverse().forEach((wy) => { const o = document.createElement("option"); o.value = wy; o.textContent = `WY ${wy}`; wySel.appendChild(o); });
  wySel.value = String(snotelState.wy);

  refreshMap();
  populateStateSelect();
  populateStationSelect();
  // Default to Niwot, CO (9,940 ft) so a real station record loads on open
  // instead of an empty prompt. Falls back to the empty state if that station
  // isn't present in the data.
  const DEFAULT_STATION = "663:CO:SNTL";
  if (stationMeta(DEFAULT_STATION)) {
    selectStation(DEFAULT_STATION);
  } else {
    document.getElementById("snotel-detail-chart").innerHTML = '<p class="chart-empty">Pick a station above, or click a dot on the map, to see its daily snowpack record.</p>';
    document.getElementById("snotel-detail-chart").style.height = "auto";
    document.getElementById("snotel-history-chart").style.height = "0";
  }
  document.getElementById("snotel-state-select").addEventListener("change", (e) => { snotelState.stateFilter = e.target.value; populateStationSelect(); });
  document.getElementById("snotel-station-select").addEventListener("change", (e) => { if (e.target.value) selectStation(e.target.value); });

  document.getElementById("snotel-metric-select").addEventListener("change", (e) => { snotelState.metric = e.target.value; refreshMap(); });
  const palSel = document.getElementById("snotel-palette-select");
  if (palSel) {
    let html = `<option value="">Default (binned)</option>`;
    for (const [theme, lbl] of [["sequential", "Sequential"], ["diverging", "Diverging"]]) {
      const group = typeof NCL_COLORMAPS !== "undefined" && NCL_COLORMAPS[theme];
      if (!group) continue;
      html += `<optgroup label="${lbl}">`;
      for (const nm of Object.keys(group)) html += `<option value="${nm}">${nm}</option>`;
      html += `</optgroup>`;
    }
    palSel.innerHTML = html;
    palSel.addEventListener("change", (e) => { snotelState.palette = e.target.value || null; refreshMap(); });
  }
  wySel.addEventListener("change", (e) => changeWaterYear(parseInt(e.target.value, 10)));
  const slider = document.getElementById("snotel-day-slider");
  slider.addEventListener("input", (e) => { stopPlay(); snotelState.dayIndex = parseInt(e.target.value, 10); refreshMap(); });
  document.getElementById("snotel-play").addEventListener("click", togglePlay);
}

init();

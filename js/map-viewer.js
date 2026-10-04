// Interactive COG map viewer (OpenLayers, global `ol` UMD bundle from CDN).
// Lives on map.html only, with its own category/product/
// response picker -- mirrors js/product-picker.js's shape (used by Time
// Series/Seasonal Cycle) but is entirely independent, since the map also
// drives period/mode/year controls no other page has. Colors are never
// computed in JS: every value comes from the per-product style JSON
// exported by code/dashboard_cog_export.py (same boundaries/colors the
// pipeline's own PNG maps use, via common/maps.py's _diverging_bins +
// config.py's response_anomaly_cmap -- ported once server-side, not
// re-derived here).

const mapPickerState = { category: null, product: null, response: null };

function currentResponseEntry() {
  return manifest.categories[mapPickerState.category][mapPickerState.product][mapPickerState.response];
}

function parseSharedMapViewFromUrl() {
  if (!window.location.hash || window.location.hash.length < 2) return null;
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const view = Object.fromEntries(params.entries());
    return view.category && view.product && view.response ? view : null;
  } catch (err) {
    return null;
  }
}

let pendingSharedMapView = null;
let lastMapSelection = null;

// First-ever visit (no shared-view URL hash, no remembered localStorage
// selection) opens on this view rather than whatever happens to sort first
// in the manifest -- 2m air temperature is the most immediately legible
// variable for a first-time visitor, and March 2026 is the dashboard's own
// live season.
const DEFAULT_MAP_VIEW = {
  category: "climate", product: "ERA5-Land", response: "T2m",
  period: "03", mode: "anomaly", year: "2026",
};

// A URL fragment-only change (e.g. a shared link pasted into the same tab,
// or browser back/forward across two hash states) does not reload the page
// or re-run init(), so it must be re-applied explicitly via the hashchange
// event below.
function applySharedMapView() {
  const view = parseSharedMapViewFromUrl();
  if (!view || !manifest.categories[view.category]) return false;
  pendingSharedMapView = view;
  selectMapCategory(view.category);
  return true;
}

function initMapPicker() {
  renderMapCategoryTabs();
  if (!applySharedMapView()) {
    lastMapSelection = loadLastSelection();
    if (!lastMapSelection) pendingSharedMapView = DEFAULT_MAP_VIEW;
    const preferredCategory = lastMapSelection?.category || pendingSharedMapView?.category;
    const initialCategory = (preferredCategory && manifest.categories[preferredCategory])
      ? preferredCategory
      : manifest.category_order.find((cat) => Object.keys(manifest.categories[cat]).length > 0);
    selectMapCategory(initialCategory);
  }

  document.getElementById("product-select").addEventListener("change", (event) => {
    mapPickerState.product = event.target.value;
    populateMapResponseSelect();
  });
  document.getElementById("response-select").addEventListener("change", (event) => {
    mapPickerState.response = event.target.value;
    onMapSelectionChanged();
  });
  wireProductSearch("product-search", "product-search-results", (category, product, response) => {
    pendingSharedMapView = { category, product, response };
    selectMapCategory(category);
  });
  window.addEventListener("hashchange", applySharedMapView);
}

function renderMapCategoryTabs() {
  const nav = document.getElementById("category-tabs");
  nav.innerHTML = "";
  manifest.category_order.forEach((category) => {
    const products = manifest.categories[category];
    if (Object.keys(products).length === 0) return;
    const button = document.createElement("button");
    button.className = "category-tab";
    button.textContent = categoryLabelWithIcon(category);
    button.style.setProperty("--cat", manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectMapCategory(category));
    nav.appendChild(button);
  });
}

function selectMapCategory(category) {
  mapPickerState.category = category;
  document.querySelectorAll("#category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  populateMapProductSelect();
}

function populateMapProductSelect() {
  const select = document.getElementById("product-select");
  select.innerHTML = "";
  const products = Object.keys(manifest.categories[mapPickerState.category]);
  products.forEach((product) => {
    const option = document.createElement("option");
    option.value = product;
    option.textContent = product;
    select.appendChild(option);
  });
  const preferredProduct = pendingSharedMapView?.product || lastMapSelection?.product;
  mapPickerState.product = (preferredProduct && products.includes(preferredProduct))
    ? preferredProduct : products[0];
  select.value = mapPickerState.product;
  populateMapResponseSelect();
}

function populateMapResponseSelect() {
  const select = document.getElementById("response-select");
  select.innerHTML = "";
  const responses = Object.keys(manifest.categories[mapPickerState.category][mapPickerState.product]);
  responses.forEach((response) => {
    const option = document.createElement("option");
    option.value = response;
    option.textContent = response;
    select.appendChild(option);
  });
  const preferredResponse = pendingSharedMapView?.response || lastMapSelection?.response;
  mapPickerState.response = (preferredResponse && responses.includes(preferredResponse))
    ? preferredResponse : responses[0];
  select.value = mapPickerState.response;

  if (pendingSharedMapView) {
    if (pendingSharedMapView.period) olMapState.period = pendingSharedMapView.period;
    if (pendingSharedMapView.mode) {
      olMapState.mode = pendingSharedMapView.mode;
      document.querySelectorAll("#ol-mode-toggle button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === pendingSharedMapView.mode);
      });
    }
    if (pendingSharedMapView.year) olMapState.year = parseInt(pendingSharedMapView.year, 10);
    pendingSharedMapView = null; // restore only on initial load, never again
  }
  lastMapSelection = null; // consumed as a one-time fallback, same as pendingSharedMapView
  onMapSelectionChanged();
}

function onMapSelectionChanged() {
  const entry = currentResponseEntry();
  document.getElementById("product-meta").innerHTML = productMetaHtml(entry);
  saveLastSelection(mapPickerState.category, mapPickerState.product, mapPickerState.response);
  renderInteractiveMap();
}

const olMapState = {
  map: null,
  rasterLayer: null,
  boundaryLayer: null,
  period: null,
  mode: "climatology", // "climatology" | "raw" | "anomaly" -- one consistent control for every period
  year: null, // only meaningful when mode !== "climatology"
  availableYears: [],
  styleCache: {},
  layerCache: {}, // COG url -> built ol.layer.WebGLTile, reused across mode/period/year revisits
  currentStyle: null,
  currentCogUrl: null,
  currentScale: null,
};

const COG_NODATA = -32768;

// ol.layer.WebGLTile's style expression mirrors common/maps.py's
// BoundaryNorm discrete binning exactly: value in [boundaries[i],
// boundaries[i+1]) -> colors[i]. Below the first / at or above the last
// boundary clamp to the end colors, matching matplotlib's default "extend"
// behavior for an unbounded diverging cmap. ol.source.Raster was tried
// instead (CPU-side, no shader) but crashes the browser when combined with
// ol.source.GeoTIFF (reproduced in isolation, 2026-09, headless Chromium);
// WebGLTile+GeoTIFF is the stable, working combination once geotiff.js
// (the separate TIFF-decoding library ol.source.GeoTIFF depends on at
// runtime) is loaded alongside ol.js -- see map.html's <script> tags.
// Every mode (Climatology/Raw/Anomaly) renders as this same number of
// discrete bins now, not a mix of smooth gradients and discrete stacks
// (Dylan, 2026-09: "there is absolutely no reason the climatology maps and
// anomaly maps aren't 100% identical, including the colorbar style").
// Matches Anomaly's own server-side bin count exactly (common/maps.py's
// _diverging_bins(), bins_per_side=5 -> 11 bins: 5 per side plus one center
// bin straddling zero -- confirmed via dashboard_cog_export.py's own N_BINS,
// not assumed) so a Climatology/Raw legend (built client-side from just
// [vmin, vmax], see updateInteractiveMapLayer) looks identical in shape to
// an Anomaly one, not just similar.
const DISCRETE_BINS = 11;

function buildBinnedColorExpression(boundaries, colors, scale) {
  const band = ["band", 1];
  const value = ["/", band, scale];
  // ol.source.GeoTIFF's `nodata` option auto-generates a second (alpha)
  // band -- 1 where valid, 0 where nodata -- rather than preserving the
  // sentinel value in band 1 (confirmed directly via getData() in a real
  // browser: a known-ocean pixel read back as [0, 0], a known-land pixel as
  // [realValue, 255/1]). Without this explicit check every nodata pixel's
  // band-1 value of 0 fell into whatever bin straddles zero, rendering
  // ocean as an opaque "near-normal" color instead of transparent.
  const expr = ["case", ["==", ["band", 2], 0], ["color", 0, 0, 0, 0]];
  for (let i = 0; i < boundaries.length - 1; i++) {
    expr.push(["<", value, boundaries[i + 1]], colors[i]);
  }
  expr.push(colors[colors.length - 1]);
  return expr;
}

// Smallest number of decimal places at which every boundary in a
// BoundaryNorm scale formats to a distinct string -- e.g. [-0.11, -0.09,
// ...] needs 2 decimals (1 decimal collapses both to "-0.1").
function pickTickDecimals(boundaries) {
  for (let d = 0; d <= 6; d++) {
    const formatted = boundaries.map((v) => v.toFixed(d));
    if (new Set(formatted).size === formatted.length) return d;
  }
  return 6;
}

function olPeriodLabel(period) {
  return periodLabel(period); // shared implementation, js/common.js -- do not reimplement its body here
}

function initInteractiveMap() {
  if (olMapState.map || typeof ol === "undefined") return;

  // Western-US data domain (matches c.WEST/EAST_PLOT/SOUTH/NORTH in the
  // pipeline's own config.py): `extent` frames the initial view, while
  // `panExtent` (the same domain padded by 0.5deg on every side) is the hard
  // pan/zoom constraint on the View -- so the map can be nudged a little past
  // the data but no further onto empty ocean/continent (Dylan, 2026-10: "we
  // shouldn't be able to pan outside of the western US bbox", "a little 0.5deg
  // wiggle room but no more").
  const extent = ol.proj.transformExtent([-125.0, 31.0, -101.5, 49.5], "EPSG:4326", "EPSG:3857");
  const panExtent = ol.proj.transformExtent([-125.5, 30.5, -101.0, 50.0], "EPSG:4326", "EPSG:3857");

  olMapState.boundaryLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
      url: assetUrl("data/western_states.geojson"),
      format: new ol.format.GeoJSON(),
    }),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#1b1b1b", width: 1 }),
    }),
    zIndex: 10,
  });

  olMapState.map = new ol.Map({
    target: "ol-map",
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM({ opaque: false }), opacity: 0.5 }),
      olMapState.boundaryLayer,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([-113, 40]), // overridden by view.fit() below to the real domain extent
      zoom: 5,
      extent: panExtent, // hard pan constraint: WUS domain + 0.5deg slack, no further
      showFullExtent: true, // let the user zoom out to exactly the full extent, no further
    }),
  });
  // ol.View.fit() preserves the container's own aspect ratio, padding
  // symmetrically outside the extent wherever the container's shape doesn't
  // match the domain's -- the fixed 520px-tall container was much wider than
  // this (nearly square, once Mercator-projected) domain, so it padded with
  // a lot of visibly empty area east of the real data (and an equal amount
  // over the Pacific to the west). Setting the container's own aspect-ratio
  // to the extent's real, computed ratio first removes that padding instead
  // of guessing a height.
  const mapEl = document.getElementById("ol-map");
  mapEl.style.aspectRatio = `${(extent[2] - extent[0]) / (extent[3] - extent[1])}`;
  olMapState.map.updateSize();
  olMapState.map.getView().fit(extent, { size: olMapState.map.getSize() || [600, 500] });
  olMapState.homeExtent = extent; // "Reset view" button re-fits to this after a user pans/zooms away

  document.getElementById("ol-period-track").addEventListener("click", (event) => {
    const stop = event.target.closest("button[data-period]");
    if (!stop) return;
    stopPeriodPlayback();
    setMapPeriod(stop.dataset.period);
  });
  document.getElementById("ol-period-play").addEventListener("click", togglePeriodPlayback);
  document.getElementById("ol-mode-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button || button.disabled) return;
    olMapState.mode = button.dataset.mode;
    document.querySelectorAll("#ol-mode-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-select").addEventListener("change", (event) => {
    olMapState.year = parseInt(event.target.value, 10);
    updateYearStepperButtons();
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-prev-btn").addEventListener("click", () => stepYear(-1));
  document.getElementById("ol-year-next-btn").addEventListener("click", () => stepYear(1));
  document.getElementById("ol-boundary-toggle").addEventListener("change", (event) => {
    olMapState.boundaryLayer.setVisible(event.target.checked);
  });
  document.getElementById("ol-reset-view-btn").addEventListener("click", () => {
    olMapState.map.getView().fit(olMapState.homeExtent, { size: olMapState.map.getSize(), duration: 300 });
  });
  document.getElementById("ol-fullscreen-btn").addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.getElementById("ol-map-wrap").requestFullscreen();
    }
  });
  // Fullscreen changes the element's real pixel size, which OL doesn't
  // learn about on its own -- same updateSize() call the resize path
  // already relies on elsewhere in this file.
  document.addEventListener("fullscreenchange", () => {
    document.getElementById("ol-fullscreen-btn").textContent =
      document.fullscreenElement ? "Exit full screen" : "Full screen";
    setTimeout(() => olMapState.map.updateSize(), 0);
  });
  document.getElementById("ol-screenshot-btn").addEventListener("click", takeMapScreenshot);
  document.getElementById("ol-copy-url-btn").addEventListener("click", () => {
    if (olMapState.currentCogUrl) copyToClipboard(new URL(olMapState.currentCogUrl, window.location.href).href);
  });
  document.getElementById("ol-copy-view-btn").addEventListener("click", copyViewLink);

  olMapState.map.on("singleclick", (event) => {
    const readout = document.getElementById("ol-query-readout");
    if (!olMapState.rasterLayer) return;
    try {
      const data = olMapState.rasterLayer.getData(event.pixel);
      // ol.source.GeoTIFF's `nodata` option auto-generates a second (alpha)
      // band -- 255 where valid, 0 where nodata -- and zeroes out band 1
      // itself at nodata pixels rather than preserving the sentinel value,
      // so nodata must be detected from data[1], not by comparing data[0]
      // to COG_NODATA (confirmed directly via getData() in a real browser).
      const raw = data && data[0];
      const alpha = data && data[1];
      if (!data || !Number.isFinite(raw) || alpha === 0) {
        readout.textContent = "No data at this point.";
        return;
      }
      const value = raw / olMapState.currentScale; // undo this file's own Int16 scale (varies per file, read from its style JSON entry)
      const unitSuffix = currentResponseEntry().units || "";
      const lonLat = ol.proj.toLonLat(event.coordinate);
      readout.textContent = `${value.toFixed(2)}${unitSuffix ? " " + unitSuffix : ""} at ${lonLat[1].toFixed(3)}°N, ${lonLat[0].toFixed(3)}°E`;
    } catch (err) {
      readout.textContent = "Could not read a value at this point.";
    }
  });
}

async function fetchMapStyle(product, response) {
  const key = `${product}_${response}`;
  if (!olMapState.styleCache[key]) {
    const res = await fetch(assetUrl(`data/map_styles/${key}.json`));
    if (!res.ok) {
      olMapState.styleCache[key] = null;
      return null;
    }
    olMapState.styleCache[key] = await res.json();
  }
  return olMapState.styleCache[key];
}

// Every period (all months + all seasons) now carries a raw_<year> and
// anomaly_<year> COG for every year in the record -- see
// code/17_dashboard_cog_export.py's export_one(). One control shape works
// for every period: Climatology has no year (the slider hides); Raw/Anomaly
// show a year slider scoped to whichever years that mode's COGs actually
// cover for this specific period/product (gaps are real -- e.g. a product's
// own record start -- not guessed).
// Disables a mode button before the user clicks it into a blank map, rather
// than only reacting after the fact -- e.g. a product's raw-value COGs are
// still mid-rollout for this period (Dylan, 2026-09). Falls back to
// Climatology (always available whenever a period slot exists at all) if
// the currently active mode just became unavailable for the new period.
function updateModeToggleAvailability(slot) {
  document.querySelectorAll("#ol-mode-toggle button[data-mode]").forEach((btn) => {
    const mode = btn.dataset.mode;
    const available = mode === "climatology"
      ? "baseline" in slot
      : Object.keys(slot).some((k) => k.startsWith(`${mode}_`));
    btn.disabled = !available;
    btn.title = available ? "" : "No data for this mode in the selected period.";
    if (!available && btn.classList.contains("active")) {
      btn.classList.remove("active");
      olMapState.mode = "climatology";
      document.querySelector('#ol-mode-toggle button[data-mode="climatology"]').classList.add("active");
    }
  });
}

// A drag slider gave no precise, tap-friendly way to land on a specific
// year -- 36 years across a ~250px track is under 7px per year, with no
// visible per-year granularity (Dylan, 2026-09: "these sliders are not the
// optimal way to select the year"). A dropdown (exact, one click/tap, native
// picker on mobile) plus prev/next steppers (fast keyboard/tap browsing)
// replaces it entirely.
function updateYearControlForPeriod(slot) {
  const wrap = document.getElementById("ol-year-control-wrap");
  const select = document.getElementById("ol-year-select");

  if (olMapState.mode === "climatology") {
    wrap.style.display = "none";
    return;
  }
  const prefix = `${olMapState.mode}_`;
  const years = Object.keys(slot)
    .filter((k) => k.startsWith(prefix))
    .map((k) => parseInt(k.slice(prefix.length), 10))
    .sort((a, b) => a - b);
  olMapState.availableYears = years;
  // Not every product/period has this mode's COGs yet (e.g. the raw-value
  // export is still mid-rollout) -- hide the control entirely rather than
  // show it stuck at an empty range with no year to pick.
  if (years.length === 0) {
    wrap.style.display = "none";
    olMapState.year = null;
    return;
  }
  wrap.style.display = "inline-flex";
  if (!years.includes(olMapState.year)) {
    olMapState.year = years[years.length - 1];
  }
  select.innerHTML = "";
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    select.appendChild(option);
  });
  select.value = String(olMapState.year);
  updateYearStepperButtons();
}

function updateYearStepperButtons() {
  const years = olMapState.availableYears || [];
  const currentIndex = years.indexOf(olMapState.year);
  document.getElementById("ol-year-prev-btn").disabled = currentIndex <= 0;
  document.getElementById("ol-year-next-btn").disabled = currentIndex === -1 || currentIndex >= years.length - 1;
}

function stepYear(delta) {
  const years = olMapState.availableYears || [];
  const currentIndex = years.indexOf(olMapState.year);
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= years.length) return;
  olMapState.year = years[nextIndex];
  document.getElementById("ol-year-select").value = String(olMapState.year);
  updateYearStepperButtons();
  updateInteractiveMapLayer();
}

// Below-map table of per-region values for the currently-selected product/
// response/period/mode/year -- reuses computeWindowValue exactly as
// js/summary.js's Summary Table does (same sigma/percentile/rawValue
// computation, same regionEntries() list) rather than reimplementing window
// aggregation here. Raw mode shows the region's raw value; anomaly mode
// shows its standardized anomaly (sigma) -- matching how every OTHER page's
// "anomaly" number is expressed, not the map's own per-file physical-unit
// color scale (Dylan, 2026-09: "we have all the regional anomaly/climatology
// results in the data tables" -- pointing at the Summary Table's own
// numbers, not a new statistic).
// Raw value, standardized anomaly, AND rank on record together, always --
// not gated on the map's own Climatology/Raw/Anomaly mode toggle (Dylan,
// 2026-09-29: these are the dashboard's key findings and belong displayed
// together, not split across a mode switch). olMapState.year persists even
// while the map itself sits in Climatology mode (only the year CONTROL is
// hidden there, see updateYearControlForPeriod), so the same target year
// stays available here regardless of which mode the map is showing.
function regionTableCellClass(result, drierIsHigh) {
  if (result.sigma === null) return "";
  const isStress = drierIsHigh ? result.sigma > 0 : result.sigma < 0;
  return isStress ? "stress" : "relief";
}

function formatRankBadge(result, cls) {
  if (result.stressRank === null || result.n === null) return "&mdash;";
  const badgeCls = cls === "stress" || cls === "relief" ? cls : "";
  return `<span class="rank-badge ${badgeCls}">${result.stressRank}/${result.n}</span>`;
}

async function renderRegionValuesTable(entry) {
  const heading = document.getElementById("ol-region-table-heading");
  const note = document.getElementById("ol-region-table-note");
  const body = document.getElementById("ol-region-table-body");
  if (olMapState.year === null) {
    heading.textContent = "Regional values";
    body.innerHTML = "";
    note.textContent = olMapState.mode === "climatology"
      ? "Regional values are year-specific — switch to Raw units or Anomaly (and pick a year) to see them."
      : "No years available for this selection.";
    return;
  }
  if (!entry.aggregation) {
    heading.textContent = "Regional values";
    body.innerHTML = "";
    note.textContent = "No established window-aggregation rule for this variable.";
    return;
  }
  const period = olMapState.period;
  const year = olMapState.year;
  heading.textContent = `Regional values — ${olPeriodLabel(period)} ${year}`;
  const data = await fetchTimeseriesJson(`${mapPickerState.product}_${mapPickerState.response}`);
  // Named regions + all 11 western states + all 5 HUC2 basins -- the same
  // full region set data.html's Summary Table exposes (as three separate
  // group tabs there; here as one list with group-row dividers, since rows
  // scale far more gracefully than the Summary Table's per-region COLUMNS
  // would). Was just the 6 named regions (Dylan, 2026-09-29: "doesn't
  // include states or huc2 basins").
  const regionGroups = [
    { label: "Regions", entries: regionEntries() },
    { label: "States", entries: manifest.western_states.map((code) => ({ code, label: manifest.state_labels[code] })) },
    { label: "HUC2 basins", entries: manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] })) },
  ];
  const rows = regionGroups.flatMap(({ label: groupLabel, entries }) => {
    const groupRow = `<tr class="group-row"><td colspan="4">${groupLabel}</td></tr>`;
    const dataRows = entries.map(({ code, label }) => {
      const region = data.regions[code];
      const result = region ? computeWindowValue(data, region, period, year) : null;
      if (!result) return `<tr><td>${label}</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>`;
      const cls = regionTableCellClass(result, data.drier_is_high);
      const rawText = `${result.rawValue.toFixed(2)} ${data.units}`;
      const sigmaText = result.sigma === null ? "&mdash;" : `${result.sigma >= 0 ? "+" : ""}${result.sigma.toFixed(1)}`;
      const rankText = formatRankBadge(result, cls);
      return `<tr><td>${label}</td><td>${rawText}</td><td class="${cls}">${sigmaText}</td><td>${rankText}</td></tr>`;
    });
    return [groupRow, ...dataRows];
  });
  body.innerHTML = rows.join("");
  const nativeNote = data.native_standardized
    ? " Native standardized index -- rank on record not computed for these (the reading is already a standardized departure)."
    : "";
  note.textContent = `Rank 1 = the most drought-stressed year of record for this response's own stress direction; higher ranks are progressively closer to relief.${nativeNote}`;
}

async function updateInteractiveMapLayer() {
  const entry = currentResponseEntry();
  const titleEl = document.getElementById("ol-map-title");
  if (titleEl) {
    const modeLabel = olMapState.mode === "climatology" ? "Climatology" : olMapState.mode === "raw" ? "Raw units" : "Anomaly";
    const when = olMapState.mode === "climatology"
      ? periodLabel(olMapState.period)
      : `${periodLabel(olMapState.period)} ${olMapState.year}`;
    titleEl.textContent = `${mapPickerState.product} · ${mapPickerState.response} — ${when} (${modeLabel})`;
  }
  // Reads the same timeseries JSON every other page uses, not the map image
  // -- so a failure to load/render the actual raster tile below never
  // affects this table. NOT fully independent of COG/style availability
  // though: renderInteractiveMap() (below) returns early, skipping this
  // whole function (and so this call), whenever fetchMapStyle() finds no
  // style JSON for this product/response at all -- see its own "if
  // (!style) ... return" branch.
  renderRegionValuesTable(entry);
  const style = await fetchMapStyle(mapPickerState.product, mapPickerState.response);
  const emptyMsg = document.getElementById("ol-map-empty");
  // Reset to the default "no data expected" wording every call -- only the
  // load-failure branch below overrides it, and without this reset a prior
  // failed selection's more specific text could linger and show incorrectly
  // for a later, genuinely-just-missing selection.
  emptyMsg.textContent = "No interactive map available for this selection.";
  const wrap = document.getElementById("ol-map-wrap");
  if (!style || !style.periods[olMapState.period]) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    // Otherwise the PREVIOUS product's legend (wrong units, wrong colors,
    // wrong scale) stays on screen next to the "no map" message -- confirmed
    // live 2026-09-28: selecting a product with no COG coverage still showed
    // the prior product's fully-rendered legend.
    document.getElementById("ol-legend").innerHTML = "";
    // Same staleness for the controls that live outside #ol-map-wrap (so
    // hiding the map alone doesn't hide them): mode buttons kept the
    // previous product's enabled/disabled state, the year control kept its
    // previous range, and the download/copy actions still pointed at the
    // previous product's file.
    document.querySelectorAll("#ol-mode-toggle button[data-mode]").forEach((btn) => {
      btn.disabled = true;
      btn.title = "No data for this selection.";
    });
    document.getElementById("ol-year-control-wrap").style.display = "none";
    olMapState.currentCogUrl = null;
    const geotiffLink = document.getElementById("ol-geotiff-link");
    geotiffLink.removeAttribute("href");
    geotiffLink.removeAttribute("download");
    return;
  }
  const slot = style.periods[olMapState.period];
  updateModeToggleAvailability(slot);
  updateYearControlForPeriod(slot);
  const key = olMapState.mode === "climatology" ? "baseline" : `${olMapState.mode}_${olMapState.year}`;
  const fileEntry = slot[key];
  if (!fileEntry) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    document.getElementById("ol-legend").innerHTML = "";
    // Mode buttons/slider were already set correctly for this slot above,
    // but the download/copy actions still point at whatever file last
    // rendered successfully -- same staleness as the branch above.
    olMapState.currentCogUrl = null;
    const geotiffLink = document.getElementById("ol-geotiff-link");
    geotiffLink.removeAttribute("href");
    geotiffLink.removeAttribute("download");
    return;
  }
  const file = fileEntry.file;
  wrap.style.display = "";
  emptyMsg.style.display = "none";

  const url = assetUrl(`cogs/${file}`);
  // Revisiting a mode/period/year already viewed this session re-fetched the
  // same COG and rebuilt a fresh WebGL source/layer from scratch every time
  // (confirmed live: the browser's HTTP cache absorbed the byte transfer,
  // but decoded GeoTIFF metadata/tiles were still discarded and redone).
  // The url already fully encodes product+response+period+mode+year, so its
  // colors/boundaries are always the same on a repeat visit -- safe to
  // reuse the whole built layer, same idea as fetchMapStyle's styleCache.
  // layerCache[url] is undefined (never tried), a real layer (loaded fine),
  // or null (tried and failed) -- three states, not just cached/uncached.
  let layer = olMapState.layerCache[url];
  let source = null;
  if (layer === undefined) {
    source = new ol.source.GeoTIFF({
      sources: [{ url, nodata: -32768 }],
      normalize: false,
      // The layer's own interpolate:false (below) only controls the final
      // display-zoom texture sampling -- this source does its own separate
      // resampling first, reprojecting the COG's native lat/lon grid into
      // Web Mercator, and defaults to smoothing there too regardless of the
      // layer setting (confirmed: still smooth blob-like gradients instead
      // of sharp per-cell blocks with only the layer flag set).
      interpolate: false,
    });
    try {
      // getView() fetches the file's own metadata (dimensions/projection) --
      // the manifest can reference a COG that was never actually synced to
      // R2 (a real gap found more than once this session). Without this
      // check, a 404 there failed silently deep inside OpenLayers' own tile
      // pipeline: no error, no layer, just an empty map that looked like it
      // was loading forever instead of a clear "not available" message.
      // A 404 does NOT reject this promise on its own -- confirmed directly
      // (a forced-missing URL left it pending indefinitely, 0% CPU, 9+
      // minutes) -- fetch() doesn't throw on HTTP error status, and
      // geotiff.js evidently doesn't turn that into a rejection either. Race
      // it against an explicit timeout so a broken file still resolves to
      // the same "not available" state instead of hanging forever.
      await Promise.race([
        source.getView(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 8000)),
      ]);
    } catch (err) {
      olMapState.layerCache[url] = null;
      layer = null;
    }
  }
  if (layer === null) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    emptyMsg.textContent = "Map file failed to load for this selection.";
    document.getElementById("ol-legend").innerHTML = "";
    olMapState.currentCogUrl = null;
    const geotiffLink = document.getElementById("ol-geotiff-link");
    geotiffLink.removeAttribute("href");
    geotiffLink.removeAttribute("download");
    return;
  }

  olMapState.currentCogUrl = url;
  olMapState.currentScale = fileEntry.scale;
  document.getElementById("ol-geotiff-link").href = url;
  document.getElementById("ol-geotiff-link").setAttribute(
    "download", `${mapPickerState.product}_${mapPickerState.response}_${olMapState.period}_${mapViewSuffix()}.tif`
  );

  const legend = document.getElementById("ol-legend");
  const units = entry.units || "";
  const palette = olMapState.mode === "climatology" || olMapState.mode === "raw"
    ? style.baseline_colors : style.anomaly_colors;
  const label = olMapState.mode === "climatology" ? `Climatology (${units})`
    : olMapState.mode === "raw" ? `${olMapState.year} (${units})`
    : `${units} anomaly`;
  let boundaries = fileEntry.boundaries;
  let binColors = palette;
  let colorExpr = null;
  if (!boundaries) {
    // Native standardized indices (SPI/SPEI/EDDI/...): value IS the anomaly,
    // no boundaries computed yet -- show units only, no color scale.
    legend.innerHTML = `<div class="ol-legend-label">${units}</div>`;
  } else {
    // Climatology/Raw ships only [vmin, vmax] (a continuous ramp needs
    // nothing more), but every map now renders as discrete bins -- Anomaly
    // included, no exceptions (Dylan, 2026-09: "all the maps should use
    // discrete color bins... there is absolutely no reason the climatology
    // maps and anomaly maps aren't 100% identical, including the colorbar
    // style"). Expand [vmin, vmax] into DISCRETE_BINS evenly-spaced edges
    // and downsample the 256-stop continuous palette to match -- Anomaly's
    // own boundaries/anomaly_colors are already exactly DISCRETE_BINS bins
    // from the server (_diverging_bins), so only Climatology/Raw needs this.
    if (boundaries.length === 2) {
      const [vmin, vmax] = boundaries;
      boundaries = Array.from({ length: DISCRETE_BINS + 1 }, (_, i) => vmin + (i / DISCRETE_BINS) * (vmax - vmin));
      binColors = Array.from(
        { length: DISCRETE_BINS },
        (_, i) => palette[Math.round((i / (DISCRETE_BINS - 1)) * (palette.length - 1))],
      );
    }
    const nBins = boundaries.length - 1;
    // Ticks sit AT the color breaks (the line between two swatches), not
    // floating at a single point inside one bin -- nBins+1 boundary values,
    // not nBins bin-center values (Dylan, 2026-09-29: "the colorbar ticks
    // should be the color BREAKS, not a single point label for a whole
    // bin"). Vertical, highest value at top -- the sidebar this lives in is
    // narrow and tall, not wide.
    const decimals = pickTickDecimals(boundaries);
    // Horizontal colorbar above the map: bins ascend left-to-right (lowest
    // value on the left, the standard horizontal-colorbar convention), so no
    // reverse.
    const swatches = binColors.map((color, i) => {
      const lo = boundaries[i].toFixed(decimals);
      const hi = boundaries[i + 1].toFixed(decimals);
      return `<span class="ol-legend-swatch" style="background:${color}" title="${lo} to ${hi}"></span>`;
    }).join("");
    // One tick per boundary (nBins+1 total), each on the seam between the two
    // swatches it separates: break i sits at i/nBins of the bar's width.
    const ticks = Array.from({ length: nBins + 1 }, (_, i) => {
      const left = (i / nBins) * 100;
      return `<span class="ol-legend-tick" style="left:${left}%">${boundaries[i].toFixed(decimals)}</span>`;
    }).join("");
    legend.innerHTML = `<div class="ol-legend-label">${label}</div>` +
      `<div class="ol-legend-scale-wrap"><div class="ol-legend-scale">${swatches}</div>` +
      `<div class="ol-legend-ticks">${ticks}</div></div>`;
    colorExpr = buildBinnedColorExpression(boundaries, binColors, fileEntry.scale);
  }

  if (!layer) {
    layer = new ol.layer.WebGLTile({
      source,
      style: colorExpr ? { color: colorExpr } : undefined,
      // Default WebGL texture sampling is bilinear -- it blends each screen
      // pixel from its 4 nearest grid cells, smearing the real cell-by-cell
      // structure into smooth gradients (confirmed: the pipeline's own
      // matplotlib maps show crisp, blocky per-cell values with no such
      // blending). Nearest-neighbor sampling makes one grid cell = one flat
      // color block, matching the reference maps exactly.
      interpolate: false,
    });
    olMapState.layerCache[url] = layer;
  }
  if (olMapState.rasterLayer !== layer) {
    // Keep the previous layer visible until the new one has fully rendered,
    // then drop it -- otherwise animating through months flashes the bare
    // basemap in the gap while the new COG's tiles decode (Dylan, 2026-10).
    // Detach, not dispose: the old layer stays in layerCache and is reattached
    // (not rebuilt) if the user returns to it. Pushed on top of the old raster;
    // the boundary layer stays above both via its own zIndex.
    const previous = olMapState.rasterLayer;
    olMapState.rasterLayer = layer;
    olMapState.map.getLayers().push(layer);
    if (previous) {
      olMapState.map.once("rendercomplete", () => {
        const layers = olMapState.map.getLayers();
        if (layers.getArray().includes(previous)) layers.remove(previous);
      });
    }
  }
}

// ---- Period slider + play -------------------------------------------------
// The period picker is a horizontal slider instead of a dropdown: the longer
// seasonal windows that have map coverage sit first in their own shaded band
// (so they read as seasons, not months), then the 12 calendar months follow
// as compact single-letter stops that the play button animates through.
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const PERIOD_PLAY_INTERVAL_MS = 850;

function buildPeriodSlider(periods) {
  const track = document.getElementById("ol-period-track");
  const seasons = periods.filter((p) => !/^\d{2}$/.test(p));
  const months = periods.filter((p) => /^\d{2}$/.test(p));
  const stopHtml = (period, label, extraClass) =>
    `<button type="button" class="ol-period-stop${extraClass}" data-period="${period}" title="${olPeriodLabel(period)}">${label}</button>`;
  let html = "";
  if (seasons.length) {
    html += `<div class="ol-period-group ol-period-seasons">` +
      seasons.map((p) => stopHtml(p, olPeriodLabel(p), "")).join("") +
      `</div>`;
  }
  html += `<div class="ol-period-group ol-period-months">` +
    months.map((p) => stopHtml(p, MONTH_LETTERS[parseInt(p, 10) - 1], " ol-period-month")).join("") +
    `</div>`;
  track.innerHTML = html;
  updatePeriodSliderActive();
}

function updatePeriodSliderActive() {
  document.querySelectorAll("#ol-period-track .ol-period-stop").forEach((b) =>
    b.classList.toggle("active", b.dataset.period === olMapState.period));
}

function setMapPeriod(period) {
  olMapState.period = period;
  updatePeriodSliderActive();
  updateInteractiveMapLayer();
}

function stopPeriodPlayback() {
  if (olMapState.playTimer) {
    clearInterval(olMapState.playTimer);
    olMapState.playTimer = null;
  }
  const btn = document.getElementById("ol-period-play");
  if (btn) {
    btn.innerHTML = "&#9654;"; // play triangle
    btn.classList.remove("playing");
    btn.title = "Play through the months";
  }
}

// Animate through the 12 months only (not the seasonal windows). Starting from
// a season jumps to January; reaching December loops back to January.
function togglePeriodPlayback() {
  if (olMapState.playTimer) { stopPeriodPlayback(); return; }
  const months = Array.from(document.querySelectorAll("#ol-period-track .ol-period-month"))
    .map((b) => b.dataset.period);
  if (!months.length) return;
  let idx = months.indexOf(olMapState.period);
  if (idx === -1) { idx = 0; setMapPeriod(months[0]); }
  const btn = document.getElementById("ol-period-play");
  btn.innerHTML = "&#10073;&#10073;"; // pause bars
  btn.classList.add("playing");
  btn.title = "Pause";
  olMapState.playTimer = setInterval(() => {
    idx = (idx + 1) % months.length;
    setMapPeriod(months[idx]);
  }, PERIOD_PLAY_INTERVAL_MS);
}

async function renderInteractiveMap() {
  initInteractiveMap();
  if (!olMapState.map) {
    document.getElementById("ol-map-empty").style.display = "block";
    document.getElementById("ol-map-empty").textContent = "Interactive map library failed to load.";
    document.getElementById("ol-region-table-wrap").style.display = "none";
    return;
  }
  const style = await fetchMapStyle(mapPickerState.product, mapPickerState.response);
  stopPeriodPlayback();
  if (!style) {
    // Without this, the period slider/year toggle/boundary checkbox stay
    // visible with nothing to control -- an empty control bar next to a map
    // that isn't there.
    document.querySelector(".map-controls").style.display = "none";
    document.getElementById("ol-map-wrap").style.display = "none";
    document.getElementById("ol-map-empty").style.display = "block";
    document.getElementById("ol-map-empty").textContent = "No interactive map for this dataset yet.";
    document.getElementById("ol-region-table-wrap").style.display = "none";
    return;
  }
  document.getElementById("ol-region-table-wrap").style.display = "";
  document.querySelector(".map-controls").style.display = "";
  const periods = sortedPeriods(Object.keys(style.periods));
  if (!olMapState.period || !periods.includes(olMapState.period)) {
    olMapState.period = periods.includes("DJFM") ? "DJFM" : periods[0];
  }
  buildPeriodSlider(periods);
  setTimeout(() => olMapState.map.updateSize(), 0);
  updateInteractiveMapLayer();
}

// 300/96 DPI: exporting at the map's plain on-screen CSS pixel size would
// be far below print quality (a screen is ~96 DPI). Follows OpenLayers'
// own documented pattern (examples/print-to-scale.js): temporarily grow
// the map's target element, call updateSize(), and shrink the view
// resolution by the same factor so the same geographic extent renders at
// higher pixel density -- then restore both afterward. No new dependency:
// reuses this function's own existing canvas-compositing logic, just at a
// larger captured size.
const SCREENSHOT_SCALE_FACTOR = 3;

function takeMapScreenshot() {
  const map = olMapState.map;
  const targetEl = map.getTargetElement();
  const originalWidth = targetEl.clientWidth;
  const originalHeight = targetEl.clientHeight;
  const originalResolution = map.getView().getResolution();

  targetEl.style.width = `${originalWidth * SCREENSHOT_SCALE_FACTOR}px`;
  targetEl.style.height = `${originalHeight * SCREENSHOT_SCALE_FACTOR}px`;
  map.updateSize();
  map.getView().setResolution(originalResolution / SCREENSHOT_SCALE_FACTOR);

  map.once("rendercomplete", () => {
    const mapCanvas = document.createElement("canvas");
    const size = map.getSize();
    mapCanvas.width = size[0];
    mapCanvas.height = size[1];
    const mapContext = mapCanvas.getContext("2d");
    Array.from(document.querySelectorAll("#ol-map .ol-layer canvas, #ol-map canvas")).forEach((canvas) => {
      if (canvas.width === 0) return;
      const opacity = canvas.parentElement.style.opacity || canvas.style.opacity;
      mapContext.globalAlpha = opacity === "" ? 1 : Number(opacity);
      const transform = canvas.style.transform;
      let matrix = [1, 0, 0, 1, 0, 0];
      if (transform) {
        matrix = transform.match(/^matrix\(([^)]+)\)$/)[1].split(",").map(Number);
      }
      mapContext.setTransform(...matrix);
      mapContext.drawImage(canvas, 0, 0);
    });
    mapContext.setTransform(1, 0, 0, 1, 0, 0);
    const link = document.createElement("a");
    link.download = `${mapPickerState.product}_${mapPickerState.response}_${olMapState.period}_${mapViewSuffix()}.png`;
    link.href = mapCanvas.toDataURL();
    link.click();

    // Restore the interactive map to its normal on-screen size/resolution.
    targetEl.style.width = "";
    targetEl.style.height = "";
    map.updateSize();
    map.getView().setResolution(originalResolution);
  });
  map.renderSync();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function mapViewSuffix() {
  return olMapState.mode === "climatology" ? "climatology" : `${olMapState.mode}_${olMapState.year}`;
}

function copyViewLink() {
  const params = new URLSearchParams({
    category: mapPickerState.category, product: mapPickerState.product,
    response: mapPickerState.response, period: olMapState.period, mode: olMapState.mode,
  });
  if (olMapState.year !== null) params.set("year", String(olMapState.year));
  const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
  copyToClipboard(url);
}

async function init() {
  await loadManifest();
  initMapPicker();
}

init();

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
let mapPicker = null;

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
// or re-run init(), so re-apply it: stash the period/mode/year extras and
// drive the shared picker to the hash's product/response (the picker's own
// settle() then fires onMapSelectionChanged, which consumes the extras).
function applySharedMapView() {
  const view = parseSharedMapViewFromUrl();
  if (!view || !mapPicker) return;
  pendingSharedMapView = view;
  mapPicker.select(view.product, view.response);
}

// The map's year/period/mode live outside the shared picker (no other page has
// them), so a shared-view hash carries them separately -- apply them here.
function applyMapViewExtras(view) {
  if (!view) return;
  if (view.period) olMapState.period = view.period;
  if (view.mode) {
    olMapState.mode = view.mode;
    document.querySelectorAll("#ol-mode-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === view.mode);
    });
  }
  if (view.year) olMapState.year = parseInt(view.year, 10);
}

// Shared-picker onChange. The picker has already filled the metadata panel and
// saved the shared last-selection; here we mirror its choice into
// mapPickerState, apply any period/mode/year a shared-view hash carried (once),
// and redraw. The picker's spatial-map filter guarantees every selectable
// product/response actually has a COG, so there is no category cascade to drive.
function onMapSelectionChanged(entry, selection) {
  mapPickerState.category = selection.category;
  mapPickerState.product = selection.product;
  mapPickerState.response = selection.response;
  applyMapViewExtras(pendingSharedMapView);
  pendingSharedMapView = null;
  renderInteractiveMap();
}

function initMapPicker() {
  // The picker seeds product/response itself (shared-view hash -> remembered
  // selection -> DEFAULT_MAP_VIEW). Only the period/mode/year extras need
  // handling here: from the hash, or -- first visit, no hash, nothing
  // remembered -- from DEFAULT_MAP_VIEW.
  const urlView = parseSharedMapViewFromUrl();
  if (urlView) pendingSharedMapView = urlView;
  else if (!loadLastSelection()) pendingSharedMapView = DEFAULT_MAP_VIEW;
  mapPicker = createProductPicker({
    ids: {
      pivot: "picker-pivot", product: "product-select", response: "response-select",
      meta: "product-meta", search: "product-search", searchResults: "product-search-results",
    },
    filter: responseHasSpatialMap,
    persist: true,
    seedFromUrl: true,
    defaultView: DEFAULT_MAP_VIEW,
    onChange: onMapSelectionChanged,
  });
  mapPicker.init();
  window.addEventListener("hashchange", applySharedMapView);
}

// A response gets a spatial map only if its manifest entry actually carries
// map outputs and isn't flagged no_spatial_maps -- site/point products whose
// gridded field would be interpolated from sparse stations (PhenoCam, SNOTEL,
// NEON, AmeriFlux) have no COG at all and must not appear in the map pickers,
// only on Time Series/Seasonal/etc. (Dylan, 2026-10).
function responseHasSpatialMap(category, product, response) {
  const entry = manifest.categories[category]?.[product]?.[response];
  // The interactive map renders from the COG map_style (style.periods), not the
  // static-figure manifest. entry.maps is only the static-gallery index and is
  // EMPTY for multi-response products whose static maps share one figure dir
  // (SMAP SM/AM/PM/VOD..., SMOS SM/VOD, UA-SWE) -- those still have COGs, so gate
  // on has_cog too (set from the exported map_styles). Point networks have
  // no_spatial_maps and no COG, so they stay excluded either way.
  if (!entry || entry.no_spatial_maps) return false;
  return entry.has_cog === true || (entry.maps && Object.keys(entry.maps).length > 0);
}

function categoryHasSpatialMap(category) {
  return Object.entries(manifest.categories[category]).some(([product, responses]) =>
    Object.keys(responses).some((r) => responseHasSpatialMap(category, product, r)));
}

// The Variable panel stays put (so a different product can always be chosen);
// only the Time & type and Display panels hide when a product has no COG.
function setMapControlPanelsVisible(visible) {
  const display = visible ? "" : "none";
  document.getElementById("ol-time-panel").style.display = display;
  document.getElementById("ol-display-panel").style.display = display;
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
  currentScale: null,
  colormap: null, // null = the product's own default NCL palette; else a chosen NCL_COLORMAPS key
  invert: false, // flip the color scale direction (legend gradient + raster)
};

// The Color theme dropdown lists every palette at once (not filtered by mode),
// so look these up by name across all groups. A product default named
// "<name>_r" (reversed) is matched to its base "<name>" option plus the Invert
// button -- the dropdown itself carries no _r variants.
function lookupColormap(key) {
  if (typeof NCL_COLORMAPS === "undefined") return null;
  for (const group of Object.values(NCL_COLORMAPS)) if (group[key]) return group[key];
  return null;
}
function lookupColormapColors(key) {
  const entry = lookupColormap(key);
  return entry ? entry.colors : null;
}

const CM_THEME_LABELS = { diverging: "Diverging", sequential: "Sequential", discrete: "Discrete" };

// CSS linear-gradient preview for a palette swatch: a smooth ramp, or the same
// 11 hard bins the map's discrete mode renders.
function colormapGradientCss(colors, binned, nBins) {
  if (!colors || !colors.length) return "transparent";
  if (!binned) return `linear-gradient(to right, ${colors.join(", ")})`;
  const n = nBins || DISCRETE_BINS;
  const bins = discreteBinColors(colors, n);
  const steps = [];
  for (let i = 0; i < n; i++) {
    steps.push(`${bins[i]} ${((i / n) * 100).toFixed(2)}%`,
      `${bins[i]} ${(((i + 1) / n) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(to right, ${steps.join(", ")})`;
}

// Build the custom colour-theme panel: every palette listed once as a gradient
// swatch + name, grouped by theme (Diverging / Sequential continuous ramps,
// Discrete stepped tables). A palette's continuous-vs-stepped nature is intrinsic
// to its group -- continuous ones preview (and render) as smooth ramps, discrete
// ones stepped at their own native level count -- so there's no separate
// render-mode toggle. The active entry is marked per-render by syncColormapSelect.
function populateColormapSelect() {
  const panel = document.getElementById("ol-colormap-panel");
  if (!panel || typeof NCL_COLORMAPS === "undefined") return;
  let html = "";
  for (const [theme, themeLabel] of Object.entries(CM_THEME_LABELS)) {
    const group = NCL_COLORMAPS[theme];
    if (!group) continue;
    html += `<div class="cm-theme">${themeLabel}</div>`;
    for (const name of Object.keys(group)) {
      const entry = group[name];
      const swatch = entry.discrete
        ? colormapGradientCss(entry.colors, true, entry.colors.length)
        : colormapGradientCss(entry.colors, false);
      html += `<button type="button" role="option" class="cm-option" data-value="${name}">` +
        `<span class="cm-swatch" style="background-image:${swatch}"></span>` +
        `<span class="cm-option-name">${name}</span></button>`;
    }
  }
  panel.innerHTML = html;
}

// Reflect the active view in the trigger (swatch + name) and the highlighted
// option. Active = the user's chosen palette, else this product/mode's own
// default (modeDefaultCmapName); a default with no NCL match (USDM's discrete
// category legend) shows as "Product default" and still renders from its style.
function syncColormapSelect(style) {
  const panel = document.getElementById("ol-colormap-panel");
  if (!panel) return;
  // A product default may be a reversed "<name>_r"; the dropdown carries only
  // base names, so match (and label) by the base and let currentPalette supply
  // the actual oriented colors -- its style-colors fallback handles reversal.
  const rawName = activePaletteName(style);
  const baseName = rawName ? rawName.replace(/_r$/, "") : null;
  panel.querySelectorAll(".cm-option").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.value === baseName));
  });
  const colors = currentPalette(style);
  const disc = activeDiscreteEntry();
  const sw = document.getElementById("ol-cm-current-swatch");
  const nm = document.getElementById("ol-cm-current-name");
  if (sw) sw.style.backgroundImage = (colors && colors.length)
    ? colormapGradientCss(colors, !!disc, disc ? disc.colors.length : undefined) : "none";
  if (nm) nm.textContent = baseName ? (disc ? `${baseName} · ${disc.colors.length}-level` : baseName) : "Product default";
}

// The active palette's hex stops. olMapState.colormap is the user's chosen NCL
// table name, or null = follow the product's own default for this mode (the
// map_style's anomaly_cmap in Anomaly, baseline_cmap in Climatology/Raw). Falls
// back to the style's own baked colors if the name doesn't resolve to an
// NCL_COLORMAPS entry (e.g. USDM's discrete category legend).
function modeDefaultCmapName(style) {
  return olMapState.mode === "anomaly" ? style.anomaly_cmap : style.baseline_cmap;
}
// The active palette name: the user's override, else the product's own default
// for this mode (which may be a reversed "<name>_r").
function activePaletteName(style) {
  return olMapState.colormap || modeDefaultCmapName(style);
}
// A native-discrete table auto-switches the map to stepped rendering at its own
// level count -- but only when the user explicitly picks it. Product defaults
// keep their exported (continuous / toggle-driven) look, so return null for them.
function activeDiscreteEntry() {
  if (!olMapState.colormap) return null;
  const entry = lookupColormap(olMapState.colormap.replace(/_r$/, ""));
  return entry && entry.discrete ? entry : null;
}
function currentPalette(style) {
  let palette;
  if (olMapState.colormap) {
    // User override: the NCL table's own stops; a "<name>_r" override is the
    // base reversed (the dropdown carries only base names).
    const base = olMapState.colormap.replace(/_r$/, "");
    palette = (lookupColormapColors(base) || []).slice();
    if (/_r$/.test(olMapState.colormap)) palette.reverse();
    if (!palette.length) palette = olMapState.mode === "anomaly" ? style.anomaly_colors : style.baseline_colors;
  } else {
    // Product default: the style's own baked colors, oriented as exported.
    palette = olMapState.mode === "anomaly" ? style.anomaly_colors : style.baseline_colors;
  }
  return olMapState.invert ? palette.slice().reverse() : palette;
}

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
function hexToRgbTriple(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// Continuous color ramp (Dylan, 2026-10: "use continuous colorbars for all
// these maps... good continuous versions at NCL"). The palette's hex stops
// (256 for climatology/raw, fewer but still smooth for anomaly) are spread
// evenly across [vmin, vmax] and interpolated linearly; OL clamps values
// outside that range to the end colors. Replaces the old discrete-bin scheme,
// whose break ticks/extend arrows were hard to format on the dynamic maps.
// Cap on how many color stops go into the WebGL "interpolate" expression. A
// 256-stop baseline palette (and even a 33-stop NCL one on stricter GPUs)
// compiles to a GLSL chain so long the fragment shader fails outright with
// "Expression too complex" and the raster never paints -- raw/climatology maps
// went fully transparent while anomaly (11 stops) was fine (Dylan, 2026-10). A
// linear ramp over ~16 evenly-spaced stops of an already-smooth NCL table is
// visually indistinguishable from the full-resolution palette.
const MAX_COLOR_STOPS = 16;
function buildContinuousColorExpression(vmin, vmax, colors, scale) {
  const value = ["/", ["band", 1], scale];
  const stops = [];
  const n = Math.min(colors.length, MAX_COLOR_STOPS);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const v = vmin + t * (vmax - vmin);
    const [r, g, b] = hexToRgbTriple(colors[Math.round(t * (colors.length - 1))]);
    stops.push(v, ["color", r, g, b]);
  }
  // ol.source.GeoTIFF's `nodata` option adds an alpha band (0 at nodata); gate
  // on it so ocean/out-of-domain stays transparent instead of taking vmin's
  // color (confirmed via getData(): nodata reads back as [0, 0]).
  return ["case", ["==", ["band", 2], 0], ["color", 0, 0, 0, 0],
    ["interpolate", ["linear"], value, ...stops]];
}

// Discrete 11-bin version of the same palette (Dylan, 2026-10: pick a "Discrete
// (11-bin)" entry from the one Color-theme dropdown to switch any variable from
// a smooth ramp to hard bins). [vmin,vmax] is cut into DISCRETE_BINS equal bins;
// value in [edge_i, edge_{i+1}) takes the i-th of DISCRETE_BINS colors sampled
// across the palette. For a symmetric anomaly (vmin=-vmax) the odd count leaves
// one centre bin straddling zero, matching the pipeline's own BoundaryNorm maps.
const DISCRETE_BINS = 11;
function discreteBinColors(colors, nBins) {
  const n = nBins || DISCRETE_BINS;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(colors[Math.round((i / (n - 1)) * (colors.length - 1))]);
  }
  return out;
}
function buildDiscreteColorExpression(vmin, vmax, colors, scale, nBins) {
  const n = nBins || DISCRETE_BINS;
  const value = ["/", ["band", 1], scale];
  const bins = discreteBinColors(colors, n);
  const expr = ["case", ["==", ["band", 2], 0], ["color", 0, 0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const [r, g, b] = hexToRgbTriple(bins[i]);
    if (i < n - 1) {
      expr.push(["<", value, vmin + ((i + 1) / n) * (vmax - vmin)], ["color", r, g, b]);
    } else {
      expr.push(["color", r, g, b]); // final bin = the "case" default
    }
  }
  return expr;
}

// Like buildDiscreteColorExpression but keyed to EXPLICIT break values (the
// data's own BoundaryNorm edges) rather than even bins: value in
// [edges[i], edges[i+1]) -> colors[i]. Reproduces the pipeline's binned
// anomaly maps exactly, so the legend ticks land on the real breaks.
function buildBoundaryColorExpression(edges, colors, scale) {
  const value = ["/", ["band", 1], scale];
  const expr = ["case", ["==", ["band", 2], 0], ["color", 0, 0, 0, 0]];
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = hexToRgbTriple(colors[i]);
    if (i < colors.length - 1) {
      expr.push(["<", value, edges[i + 1]], ["color", r, g, b]);
    } else {
      expr.push(["color", r, g, b]);
    }
  }
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

// Round "axis" tick values across [vmin, vmax], stepped by 1/2/5 times a power
// of ten so the labels land on human-friendly numbers (0, 50, 100, ...) rather
// than vmin + k*(range/n) fractions -- the same idea as a matplotlib colorbar's
// tick locator. targetCount is a target, not exact: the chosen round step gives
// however many ticks fit the range.
function niceTickValues(vmin, vmax, targetCount) {
  const range = vmax - vmin;
  if (!(range > 0)) return [vmin];
  const rawStep = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const first = Math.ceil(vmin / step - 1e-9) * step;
  const ticks = [];
  for (let v = first; v <= vmax + step * 1e-9; v += step) ticks.push(v);
  return ticks;
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
  // HUC2 basin outlines, off by default -- a thicker teal stroke so they read
  // as a distinct overlay from the thin black state lines when both are shown.
  olMapState.hucLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
      url: assetUrl("data/huc2_west.geojson"),
      format: new ol.format.GeoJSON(),
    }),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#0570b0", width: 2 }),
    }),
    zIndex: 11,
    visible: false,
  });

  olMapState.map = new ol.Map({
    target: "ol-map",
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM({ opaque: false }), opacity: 0.5 }),
      olMapState.boundaryLayer,
      olMapState.hucLayer,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([-113, 40]), // overridden by view.fit() below to the real domain extent
      zoom: 5,
      extent: panExtent, // hard pan constraint: WUS domain + 0.5deg slack, no further
      showFullExtent: true, // let the user zoom out to exactly the full extent, no further
    }),
  });
  // The map fills its stage: full content width, a viewport-bounded height set
  // in CSS (.map-stage #ol-map). ol.View.fit() then frames the real domain
  // extent inside it, padding symmetrically with basemap where the stage's
  // shape doesn't match the domain's -- that surrounding context (a bit of
  // ocean west, plains/Canada/Mexico around the edges) is intentional, matching
  // how dedicated drought-mapping dashboards present a region.
  olMapState.map.updateSize();
  olMapState.map.getView().fit(extent, { size: olMapState.map.getSize() || [800, 600] });
  olMapState.homeExtent = extent; // "Reset view" button re-fits to this after a user pans/zooms away
  // The stage's final width isn't settled on the first frame (grid sizing + web
  // fonts) and it also changes at the responsive breakpoint; OL keeps the center
  // + resolution on resize but doesn't re-fit, which left the domain off-center
  // and overscaled. Re-fit to the domain on size changes until the user takes
  // control of the view.
  const refitHome = () => {
    if (olMapState.userMovedView) return;
    olMapState.map.updateSize();
    olMapState.map.getView().fit(olMapState.homeExtent, { size: olMapState.map.getSize() });
  };
  new ResizeObserver(refitHome).observe(document.getElementById("ol-map"));
  olMapState.map.on("pointerdown", () => { olMapState.userMovedView = true; });
  olMapState.map.getViewport().addEventListener("wheel", () => { olMapState.userMovedView = true; }, { passive: true });

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
    updateInteractiveMapLayer(); // re-syncs the colour-theme selection to the new mode's default

  });
  const cmDd = document.getElementById("ol-colormap-dd");
  const cmBtn = document.getElementById("ol-colormap-btn");
  const cmPanel = document.getElementById("ol-colormap-panel");
  const closeColormapPanel = () => { cmPanel.hidden = true; cmBtn.setAttribute("aria-expanded", "false"); };
  cmBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = cmPanel.hidden;
    cmPanel.hidden = !opening;
    cmBtn.setAttribute("aria-expanded", String(opening));
    if (opening) {
      const active = cmPanel.querySelector('.cm-option[aria-selected="true"]');
      if (active) active.scrollIntoView({ block: "center" });
    }
  });
  // Palette + binning are baked into each cached WebGLTile color style at
  // construction, so a change needs fresh layers (COG bytes stay HTTP-cached).
  const rebuildColormapLayers = () => {
    if (olMapState.rasterLayer) { olMapState.map.removeLayer(olMapState.rasterLayer); olMapState.rasterLayer = null; }
    olMapState.layerCache = {};
    updateInteractiveMapLayer();
  };
  cmPanel.addEventListener("click", (event) => {
    event.stopPropagation(); // keep in-panel clicks from the outside-click handler
    const opt = event.target.closest(".cm-option");
    if (!opt) return;
    olMapState.colormap = opt.dataset.value || null;
    closeColormapPanel();
    rebuildColormapLayers();
  });
  document.addEventListener("click", (event) => { if (cmDd && !cmDd.contains(event.target)) closeColormapPanel(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeColormapPanel(); });
  document.getElementById("ol-invert-btn").addEventListener("click", (event) => {
    olMapState.invert = !olMapState.invert;
    event.currentTarget.classList.toggle("active", olMapState.invert);
    event.currentTarget.setAttribute("aria-pressed", String(olMapState.invert));
    // Same rebuild as a colormap change: the palette is baked into each cached
    // WebGLTile's color style at construction, so reversed colors need fresh layers.
    if (olMapState.rasterLayer) { olMapState.map.removeLayer(olMapState.rasterLayer); olMapState.rasterLayer = null; }
    olMapState.layerCache = {};
    updateInteractiveMapLayer();
  });
  populateColormapSelect();
  document.getElementById("ol-year-select").addEventListener("change", (event) => {
    olMapState.year = parseInt(event.target.value, 10);
    updateYearStepperButtons();
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-prev-btn").addEventListener("click", () => stepYear(-1));
  document.getElementById("ol-year-next-btn").addEventListener("click", () => stepYear(1));
  document.getElementById("ol-year-slider").addEventListener("input", (event) => {
    const years = olMapState.availableYears || [];
    const year = years[parseInt(event.target.value, 10)];
    if (year === undefined || year === olMapState.year) return;
    olMapState.year = year;
    document.getElementById("ol-year-select").value = String(year);
    updateYearStepperButtons();
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-huc-toggle").addEventListener("change", (event) => {
    olMapState.hucLayer.setVisible(event.target.checked);
  });
  document.getElementById("ol-boundary-toggle").addEventListener("change", (event) => {
    olMapState.boundaryLayer.setVisible(event.target.checked);
  });
  document.getElementById("ol-reset-view-btn").addEventListener("click", () => {
    olMapState.userMovedView = false; // re-enable auto-centering on later resizes
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
      const nativeUnits = currentResponseEntry().units || "";
      // undo this file's own Int16 scale, then convert to the canonical unit
      // (e.g. kg m-2 -> mm) so the map reads in the same unit as everywhere else.
      const value = (raw / olMapState.currentScale) * canonicalUnitFactor(nativeUnits);
      const unitSuffix = canonicalUnit(nativeUnits);
      const lonLat = ol.proj.toLonLat(event.coordinate);
      const latStr = `${Math.abs(lonLat[1]).toFixed(3)}°${lonLat[1] >= 0 ? "N" : "S"}`;
      const lonStr = `${Math.abs(lonLat[0]).toFixed(3)}°${lonLat[0] >= 0 ? "E" : "W"}`;
      readout.textContent = `${value.toFixed(2)}${unitSuffix ? " " + unitSuffix : ""} at ${latStr}, ${lonStr}`;
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
  const available = {};
  document.querySelectorAll("#ol-mode-toggle button[data-mode]").forEach((btn) => {
    const mode = btn.dataset.mode;
    available[mode] = mode === "climatology"
      ? "baseline" in slot
      : Object.keys(slot).some((k) => k.startsWith(`${mode}_`));
    btn.disabled = !available[mode];
    btn.title = available[mode] ? "" : "No data for this mode in the selected period.";
  });
  // If the active mode has no COGs here, switch to the first mode that DOES --
  // a fixed climatology fallback left a raw-only product (OCO-2's sounding map,
  // which has no anomaly or climatology) blank.
  if (!available[olMapState.mode]) {
    const fallback = ["anomaly", "raw", "climatology"].find((m) => available[m]);
    document.querySelectorAll("#ol-mode-toggle button[data-mode]").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === fallback));
    if (fallback) olMapState.mode = fallback;
  }
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
  wrap.style.display = "flex";
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
  // The scrubber ranges over availableYears by INDEX (years aren't always
  // contiguous), so dragging it steps through exactly the years that have a COG.
  const slider = document.getElementById("ol-year-slider");
  slider.min = "0";
  slider.max = String(years.length - 1);
  slider.value = String(Math.max(0, years.indexOf(olMapState.year)));
  buildYearAxis(years);
  updateYearStepperButtons();
}

// Year ticks under the scrubber: pick a step (1/2/3/5/10 years) giving a dozen
// or so evenly-spaced labels -- dense enough to read a year off the slider, not
// so dense the 4-digit labels overlap. Always include the first and last year.
function buildYearAxis(years) {
  const axis = document.getElementById("ol-year-axis");
  if (!axis) return;
  if (years.length < 2) { axis.innerHTML = ""; return; }
  const last = years.length - 1;
  const lastYear = years[last];
  // A tick at EVERY year (the scrubber selects whole years, so the integer
  // granularity should be visible), with a 4-digit label only on the latest
  // year and every 5th year back from it, so labels never overlap while the
  // per-year minor ticks stay readable.
  const major = new Set([last]);
  years.forEach((y, i) => { if ((lastYear - y) % 5 === 0) major.add(i); });
  axis.innerHTML = years.map((y, i) =>
    `<span class="ol-year-tick${major.has(i) ? " major" : ""}" style="left:${(i / last) * 100}%">${major.has(i) ? y : ""}</span>`
  ).join("");
}

function updateYearStepperButtons() {
  const years = olMapState.availableYears || [];
  const currentIndex = years.indexOf(olMapState.year);
  document.getElementById("ol-year-prev-btn").disabled = currentIndex <= 0;
  document.getElementById("ol-year-next-btn").disabled = currentIndex === -1 || currentIndex >= years.length - 1;
  const slider = document.getElementById("ol-year-slider");
  if (slider && currentIndex !== -1) slider.value = String(currentIndex);
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
async function renderRegionValuesTable(entry) {
  const heading = document.getElementById("ol-region-table-heading");
  const note = document.getElementById("ol-region-table-note");
  const body = document.getElementById("ol-region-table-body");
  if (!entry.aggregation) {
    heading.textContent = "Regional values";
    body.innerHTML = "";
    note.textContent = "No established window-aggregation rule for this variable.";
    return;
  }
  const period = olMapState.period;
  const data = await fetchTimeseriesJson(`${mapPickerState.product}_${mapPickerState.response}`);
  // The table is mode-independent (raw value / normal / anomaly / sigma / rank
  // for one year), so it should populate even on a fresh load in Climatology
  // mode -- whose year CONTROL is hidden but whose target year is still
  // meaningful. Default to the latest year the data covers when none is chosen.
  if (olMapState.year === null) olMapState.year = latestYearInData(data);
  const year = olMapState.year;
  if (year === null) {
    heading.textContent = "Regional values";
    body.innerHTML = "";
    note.textContent = "No years available for this selection.";
    return;
  }
  heading.textContent = `Regional values — ${mapPickerState.product} · ${responseDisplay(mapPickerState.response)}, ${olPeriodLabel(period)} ${year}`;
  const rawHeader = document.getElementById("ol-region-rawval-th");
  if (rawHeader) rawHeader.textContent = rawValueHeaderLabel(data, period);
  body.innerHTML = regionalSummaryRowsHtml(data, period, year);
  applyPctOfNormalHeader(body, data);
  note.textContent = regionalSummaryNote(data);
}

function latestYearInData(data) {
  let maxYear = null;
  for (const code in data.regions) {
    const dates = data.regions[code].dates;
    if (!dates || !dates.length) continue;
    const y = parseInt(dates[dates.length - 1].slice(0, 4), 10);
    if (maxYear === null || y > maxYear) maxYear = y;
  }
  return maxYear;
}

async function updateInteractiveMapLayer() {
  const entry = currentResponseEntry();
  const titleEl = document.getElementById("ol-map-title");
  if (titleEl) {
    const modeLabel = olMapState.mode === "climatology" ? "Climatology" : olMapState.mode === "raw" ? "Raw units" : "Anomaly";
    const when = olMapState.mode === "climatology"
      ? periodLabel(olMapState.period)
      : `${periodLabel(olMapState.period)} ${olMapState.year}`;
    titleEl.textContent = `${mapPickerState.product} · ${responseDisplay(mapPickerState.response)} — ${when} (${modeLabel})`;
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
  olMapState.currentStyle = style; // for playableMonths() -- which months have a COG for this mode+year
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
    // previous range.
    document.querySelectorAll("#ol-mode-toggle button[data-mode]").forEach((btn) => {
      btn.disabled = true;
      btn.title = "No data for this selection.";
    });
    document.getElementById("ol-year-control-wrap").style.display = "none";
    return;
  }
  const slot = style.periods[olMapState.period];
  updateModeToggleAvailability(slot);
  updateYearControlForPeriod(slot);
  updatePeriodAvailability();
  // Re-render the title now that year/mode are reconciled to this product's
  // actual coverage: the two calls above can clamp the year to the product's
  // last available year or fall the mode back to an available one, and the
  // title set at the top of this function uses the pre-reconciliation values
  // -- without this it would mislabel the year/mode of the raster drawn below.
  if (titleEl) {
    const drawnModeLabel = olMapState.mode === "climatology" ? "Climatology" : olMapState.mode === "raw" ? "Raw units" : "Anomaly";
    const drawnWhen = olMapState.mode === "climatology"
      ? periodLabel(olMapState.period)
      : `${periodLabel(olMapState.period)} ${olMapState.year}`;
    titleEl.textContent = `${mapPickerState.product} · ${responseDisplay(mapPickerState.response)} — ${drawnWhen} (${drawnModeLabel})`;
  }
  const key = olMapState.mode === "climatology" ? "baseline" : `${olMapState.mode}_${olMapState.year}`;
  const fileEntry = slot[key];
  if (!fileEntry) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    document.getElementById("ol-legend").innerHTML = "";
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
    return;
  }

  olMapState.currentScale = fileEntry.scale;

  const legend = document.getElementById("ol-legend");
  const nativeUnits = entry.units || "";
  const units = canonicalUnit(nativeUnits);
  const unitFactor = canonicalUnitFactor(nativeUnits);
  const palette = currentPalette(style);
  // Continuous palettes render as a smooth ramp; a native-discrete palette
  // renders stepped at its own level count (there is no separate mode toggle).
  const discEntry = activeDiscreteEntry();
  const nBins = discEntry ? discEntry.colors.length : DISCRETE_BINS;
  const renderBinned = !!discEntry;
  syncColormapSelect(style); // reflect the active palette in the dropdown
  const unitSuffix = units ? ` [${units}]` : "";
  const pv = `${mapPickerState.product} · ${responseDisplay(mapPickerState.response)}`;
  const label = olMapState.mode === "climatology" ? `${pv} — climatology${unitSuffix}`
    : olMapState.mode === "raw" ? `${pv} — ${olMapState.year}${unitSuffix}`
    : `${pv} — ${olMapState.year} anomaly${unitSuffix}`;
  let boundaries = fileEntry.boundaries;
  let colorExpr = null;
  if (!boundaries) {
    // Native standardized indices (SPI/SPEI/EDDI/...): value IS the anomaly,
    // no boundaries computed yet -- show units only, no color scale.
    legend.innerHTML = `<div class="ol-legend-label">${units}</div>`;
  } else {
    // Over [vmin, vmax] (Climatology/Raw ship exactly that pair; Anomaly's
    // symmetric diverging boundaries give it as [first, last]). Continuous = a
    // smooth gradient with round-number axis ticks; Discrete = the palette as
    // hard-stop bins (11 for a continuous palette in discrete mode, or a
    // discrete table's own native level count) with ticks on the bin edges --
    // both in the same legend element, chosen by the one Color-theme dropdown.
    const vmin = boundaries[0];
    const vmax = boundaries[boundaries.length - 1];
    const span = vmax - vmin || 1;
    let gradient, tickValues;
    if (renderBinned) {
      // When the data carries its own BoundaryNorm breaks (anomaly ships the
      // full array), bins + ticks follow those EXACT breaks so the colorbar
      // matches the pipeline and every tick sits on a break, not mid-bin.
      // Raw/climatology ship only [vmin,vmax], so there fall back to even bins.
      const edges = boundaries.length > 2
        ? boundaries.slice()
        : Array.from({ length: nBins + 1 }, (_, i) => vmin + (i / nBins) * span);
      const bins = discreteBinColors(palette, edges.length - 1);
      const steps = [];
      for (let i = 0; i < bins.length; i++) {
        const p0 = ((edges[i] - vmin) / span) * 100, p1 = ((edges[i + 1] - vmin) / span) * 100;
        steps.push(`${bins[i]} ${p0.toFixed(2)}%`, `${bins[i]} ${p1.toFixed(2)}%`);
      }
      gradient = `linear-gradient(to right, ${steps.join(", ")})`;
      // A tick on every break, thinned so a high-level scale doesn't crowd the axis.
      tickValues = [];
      const tickStep = edges.length > 13 ? 2 : 1;
      for (let i = 0; i < edges.length; i += tickStep) tickValues.push(edges[i]);
      if (tickValues[tickValues.length - 1] !== edges[edges.length - 1]) tickValues.push(edges[edges.length - 1]);
      colorExpr = buildBoundaryColorExpression(edges, bins, fileEntry.scale);
    } else {
      // One round-number tick roughly every 70px of the bar's actual width, so
      // a wide desktop colorbar gets a full axis and a narrow phone one stays
      // legible (derived from rendered width, not a fixed count, Dylan 2026-10).
      const barWidth = document.getElementById("ol-map").clientWidth || 700;
      tickValues = niceTickValues(vmin, vmax, Math.max(5, Math.min(12, Math.round(barWidth / 70))));
      gradient = `linear-gradient(to right, ${palette.join(", ")})`;
      colorExpr = buildContinuousColorExpression(vmin, vmax, palette, fileEntry.scale);
    }
    // Tick POSITIONS stay on the native [vmin,vmax] scale; LABELS display in the
    // canonical unit (x unitFactor, e.g. kg m-2 -> mm) to match the title + hover.
    const canonicalTicks = tickValues.map((v) => v * unitFactor);
    const decimals = pickTickDecimals(canonicalTicks);
    const ticks = tickValues.map((v, k) =>
      `<span class="ol-legend-tick" style="left:${(((v - vmin) / span) * 100).toFixed(2)}%">${canonicalTicks[k].toFixed(decimals)}</span>`
    ).join("");
    legend.innerHTML = `<div class="ol-legend-label">${label}</div>` +
      `<div class="ol-legend-scale-wrap"><div class="ol-legend-gradient" style="background:${gradient}"></div>` +
      `<div class="ol-legend-ticks">${ticks}</div></div>`;
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
// Which calendar months each seasonal window spans, so selecting a season
// lights up its months on the strip below. Reuses common.js's SEASON_MONTHS
// (numeric months) -- a second top-level const of the same name here would
// redeclare it in map.html's shared script scope and crash the page; the
// month stops' data-period values are zero-padded, so pad on lookup.
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
  const inSeason = new Set((SEASON_MONTHS[olMapState.period] || []).map((m) => String(m).padStart(2, "0")));
  document.querySelectorAll("#ol-period-track .ol-period-stop").forEach((b) => {
    b.classList.toggle("active", b.dataset.period === olMapState.period);
    // Keep the two rows in sync: a selected seasonal window lights up the
    // months it spans on the strip below.
    if (b.classList.contains("ol-period-month")) {
      b.classList.toggle("in-season", inSeason.has(b.dataset.period));
    }
  });
}

// Dim the month stops that have no COG for the current mode + year, so it's
// clear which months are actually viewable (e.g. the current year ends mid-
// year). Seasons are left alone. No-op in Climatology mode (all months exist).
function updatePeriodAvailability() {
  const months = new Set(playableMonths());
  const dimInRaw = olMapState.mode !== "climatology";
  document.querySelectorAll("#ol-period-track .ol-period-month").forEach((b) => {
    b.classList.toggle("unavailable", dimInRaw && !months.has(b.dataset.period));
  });
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

// The month stops that actually have a COG for the current mode + year. In
// Climatology mode every month has a baseline COG; in Raw/Anomaly mode a month
// only counts if style.periods[month] carries this year's file -- otherwise
// playing a short year (e.g. 2026 ends July) would step onto Aug-Dec, find no
// file, and reset the year to the last fully-covered one (Dylan, 2026-10: "the
// loop goes from 2026 to 2025-august when the data runs out").
function playableMonths() {
  const allMonths = Array.from(document.querySelectorAll("#ol-period-track .ol-period-month"))
    .map((b) => b.dataset.period);
  const style = olMapState.currentStyle;
  if (!style || olMapState.mode === "climatology") return allMonths;
  const fileKey = `${olMapState.mode}_${olMapState.year}`;
  return allMonths.filter((m) => style.periods[m] && style.periods[m][fileKey]);
}

// Animate through the playable months only. Starting outside that set jumps to
// its first month; reaching the last loops back to the first.
function togglePeriodPlayback() {
  if (olMapState.playTimer) { stopPeriodPlayback(); return; }
  const months = playableMonths();
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
    setMapControlPanelsVisible(false);
    document.getElementById("ol-map-wrap").style.display = "none";
    document.getElementById("ol-map-empty").style.display = "block";
    document.getElementById("ol-map-empty").textContent = "No interactive map for this dataset yet.";
    document.getElementById("ol-region-table-wrap").style.display = "none";
    return;
  }
  document.getElementById("ol-region-table-wrap").style.display = "";
  setMapControlPanelsVisible(true);
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
  // The clipboard write is silent -- give the button brief visible feedback so
  // the user knows it worked.
  const btn = document.getElementById("ol-copy-view-btn");
  if (btn) {
    const original = btn.textContent;
    btn.textContent = "Link copied";
    setTimeout(() => { btn.textContent = original; }, 1500);
  }
}

async function init() {
  await loadManifest();
  initMapPicker();
}

init();

// Compare page: any two variables, side by side, each on its own panel in its
// own physical units, sharing one time axis. Pick a variable for panel A (top)
// and one for panel B (bottom); each is a raw-value monthly series read
// straight from the JSON exported by code/dashboard_export.py -- no
// standardization and no cross-variable statistic, so each keeps its real
// units. Deliberately limited to exactly two variables: the earlier
// category-checklist + add-series version grew cluttered (Dylan, 2026-10).

const compareState = {
  region: "ALL",
  startYear: null,
  series: "value", // "value" (raw, dual y-axis) | "sigma" (shared standardized axis)
  a: { category: null, product: null, response: null },
  b: { category: null, product: null, response: null },
};

// Two fixed, clearly-distinct line colors -- the series are overlaid on one
// plot now, so they can't be colored by category (two same-category variables
// would collide). Left axis + line A read blue, right axis + line B read orange.
const COMPARE_A_COLOR = "#1b6ca8";
const COMPARE_B_COLOR = "#e8702a";

// Opens on the modern era rather than the full 1990-2026 record, matching
// js/explore.js -- the whole record crams ~430 monthly points into a smear.
const COMPARE_DEFAULT_START_YEAR = 2000;

function nonEmptyCategories() {
  return manifest.category_order.filter((cat) => Object.keys(manifest.categories[cat]).length > 0);
}

const comparePickers = { a: null, b: null };
let compareReady = false;

// Each panel owns an independent pivot picker (the shared createProductPicker).
// persist is off: the shared last-selection memory is single-product, so writing
// both panels into it would clobber it. A panel's onChange mirrors its choice
// into compareState and redraws -- but only once BOTH pickers exist, since each
// picker fires its onChange during init (before the other panel is built) and
// renderCompare needs both slots populated.
function onSlotChanged(slot, entry, selection) {
  compareState[slot].category = selection.category;
  compareState[slot].product = selection.product;
  compareState[slot].response = selection.response;
  if (compareReady) renderCompare();
}

function setupSlots() {
  // A opens on climate / 2 m air temperature; B on the first variable of a
  // different category, so the page starts as a real cross-variable comparison
  // rather than two of the same.
  const cats = nonEmptyCategories();
  const bCategory = cats.find((c) => c !== DEFAULT_PICKER_VIEW.category) || cats[0];
  // Skip point-observation networks (multisite averages) -- the picker excludes
  // them, so the default overlay must not land on one either (POINT_NETWORK_PRODUCTS).
  const bProduct = Object.keys(manifest.categories[bCategory]).find((p) => !POINT_NETWORK_PRODUCTS.has(p))
    || Object.keys(manifest.categories[bCategory])[0];
  const bResponse = Object.keys(manifest.categories[bCategory][bProduct])[0];
  comparePickers.a = createProductPicker({
    ids: { pivot: "compare-a-pivot", product: "compare-a-product", response: "compare-a-response" },
    persist: false,
    defaultView: DEFAULT_PICKER_VIEW,
    onChange: (entry, sel) => onSlotChanged("a", entry, sel),
  });
  comparePickers.b = createProductPicker({
    ids: { pivot: "compare-b-pivot", product: "compare-b-product", response: "compare-b-response" },
    persist: false,
    defaultView: { category: bCategory, product: bProduct, response: bResponse },
    onChange: (entry, sel) => onSlotChanged("b", entry, sel),
  });
  comparePickers.a.init();
  comparePickers.b.init();
  compareReady = true;
}

function populateStartYearSelect() {
  const { minYear, maxYear } = fullRecordYearRange();
  const select = document.getElementById("compare-start-year-select");
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All years (from ${minYear})`;
  select.appendChild(allOption);
  for (let y = minYear; y <= maxYear; y++) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    select.appendChild(option);
  }
  compareState.startYear = Math.max(minYear, COMPARE_DEFAULT_START_YEAR);
  select.value = String(compareState.startYear);
}

function initCompareView() {
  const chart = document.getElementById("compare-chart");
  if (!chart) return;

  populateRegionSelect(document.getElementById("compare-region-select"), compareState.region);
  populateStartYearSelect();
  setupSlots();

  document.getElementById("compare-region-select").addEventListener("change", (event) => {
    compareState.region = event.target.value;
    renderCompare();
  });
  document.getElementById("compare-start-year-select").addEventListener("change", (event) => {
    compareState.startYear = event.target.value ? parseInt(event.target.value, 10) : null;
    renderCompare();
  });
  document.getElementById("compare-series-toggle").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-series]");
    if (!btn) return;
    compareState.series = btn.dataset.series;
    document.querySelectorAll("#compare-series-toggle button").forEach((x) => x.classList.toggle("active", x === btn));
    renderCompare();
  });

  renderCompare();
}

function slotSeries(slot, data) {
  const region = data.regions[compareState.region];
  if (!region) return null;
  const startYear = Math.max(DASHBOARD_MIN_YEAR, compareState.startYear || DASHBOARD_MIN_YEAR);
  const keep = region.dates.map((d) => parseInt(d.slice(0, 4), 10) >= startYear);
  const isSigma = compareState.series === "sigma";
  const raw = isSigma ? region.sigma : region.value;
  return {
    dates: region.dates.filter((_, i) => keep[i]),
    // Raw values display in the canonical unit (e.g. kg m-2 -> mm); σ is unitless.
    values: raw.filter((_, i) => keep[i]).map((v) => {
      if (v === null || v === undefined) return null;
      return isSigma ? v : toCanonicalValue(v, data.units);
    }),
    name: `${compareState[slot].product} · ${responseDisplay(data.response)}`,
    units: canonicalUnit(data.units),
  };
}

// Both variables share one time axis. In raw mode each keeps its own units on
// its own y-axis (A left/blue, B right/orange); in sigma mode both are
// standardized and share a single axis, so the lines sit on a common scale.
async function renderCompare() {
  const chart = document.getElementById("compare-chart");
  const [aData, bData] = await Promise.all([
    fetchTimeseriesJson(`${compareState.a.product}_${compareState.a.response}`),
    fetchTimeseriesJson(`${compareState.b.product}_${compareState.b.response}`),
  ]);
  const a = slotSeries("a", aData);
  const b = slotSeries("b", bData);
  const isSigma = compareState.series === "sigma";

  // Title + per-variable facts (units + baseline window) above the chart. In
  // sigma mode each series is standardized against its OWN baseline, so two
  // series whose baseline windows differ are not level-comparable -- surface
  // the baselines and warn when they disagree.
  const aEntry = findResponseEntry(compareState.a.product, compareState.a.response);
  const bEntry = findResponseEntry(compareState.b.product, compareState.b.response);
  const baselineText = (entry) => (entry && entry.baseline_start_year && entry.baseline_end_year)
    ? `${entry.baseline_start_year}–${entry.baseline_end_year}` : "n/a";
  const metaLine = (label, state, entry) => entry
    ? `${label}: ${state.product} ${responseDisplay(state.response)} · units ${canonicalUnit(entry.units) || "n/a"} · baseline ${baselineText(entry)}`
    : "";
  document.getElementById("compare-title").textContent =
    `${compareState.a.product} · ${responseDisplay(compareState.a.response)} vs ${compareState.b.product} · ${responseDisplay(compareState.b.response)} — ${regionLabelFor(compareState.region)}`;
  let metaHtml = `${metaLine("A", compareState.a, aEntry)}<br>${metaLine("B", compareState.b, bEntry)}`;
  if (isSigma) {
    metaHtml += "<br>σ is native-direction (positive = above that variable's own baseline, not necessarily stress).";
    const sigmaGlossary = (manifest.value_type_glossary || {}).sigma;
    if (sigmaGlossary) metaHtml += `<br>σ: ${sigmaGlossary}`;
    if (aEntry && bEntry && baselineText(aEntry) !== baselineText(bEntry)) {
      metaHtml += `<br><strong>Note:</strong> the two σ series use different baselines (A: ${baselineText(aEntry)}, B: ${baselineText(bEntry)}), so their levels are not directly comparable.`;
    }
  }
  document.getElementById("compare-meta").innerHTML = metaHtml;

  if (!a && !b) {
    chart.innerHTML = `<p class="chart-empty">No data for ${regionLabelFor(compareState.region)}.</p>`;
    return;
  }

  const traces = [];
  if (a) traces.push({
    x: a.dates, y: a.values, type: "scatter", mode: "lines", connectgaps: false,
    name: a.name, line: { color: COMPARE_A_COLOR, width: 2.5 }, yaxis: "y",
    hovertemplate: `%{x|%Y-%m}: %{y:.2f}<extra>${a.name}</extra>`,
  });
  if (b) traces.push({
    x: b.dates, y: b.values, type: "scatter", mode: "lines", connectgaps: false,
    name: b.name, line: { color: COMPARE_B_COLOR, width: 2.5 }, yaxis: isSigma ? "y" : "y2",
    hovertemplate: `%{x|%Y-%m}: %{y:.2f}<extra>${b.name}</extra>`,
  });

  const layout = {
    margin: { t: 10, r: isSigma ? 20 : 66, b: 45, l: 66 },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    legend: { orientation: "h", y: 1.1, x: 0, yanchor: "bottom", font: { size: 13 } },
    hovermode: "x unified",
    xaxis: { title: "Year", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
    shapes: isSigma ? [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }] : [],
  };
  if (isSigma) {
    layout.yaxis = { title: "Standardized anomaly (σ)", zeroline: true, ...PLOTLY_AXIS_LINE };
  } else {
    layout.yaxis = { title: { text: a ? a.units : "", font: { color: COMPARE_A_COLOR } }, color: COMPARE_A_COLOR, ...PLOTLY_AXIS_LINE };
    layout.yaxis2 = { title: { text: b ? b.units : "", font: { color: COMPARE_B_COLOR } }, color: COMPARE_B_COLOR, overlaying: "y", side: "right", showgrid: false, ...PLOTLY_AXIS_LINE };
  }
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

// ---------------------------------------------------------------------------
// Overlay panel: one variable, every dataset that measures it, on one shared
// axis. Unlike the A-vs-B panel above (two different variables, dual units),
// this holds the variable fixed and overlays all its datasets so they are
// level-comparable. The legend is a set of checkboxes rather than Plotly's
// click-to-toggle legend, so several datasets can be shown/hidden at will.
// Three views: raw value (shared units), the raw-unit anomaly, and the
// standardized sigma anomaly.

// Distinct line colors cycled by dataset. The first eight are the Okabe-Ito
// colorblind-safe set; a few more distinct hues follow for variables carried
// by many datasets (ET has nine).
const OVERLAY_COLORS = [
  "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00",
  "#56b4e9", "#000000", "#8b4513", "#6a3d9a", "#1b9e77",
  "#a6761d", "#e7298a",
];

const overlayState = {
  response: null,
  region: "ALL",
  startYear: null,
  series: "value", // value | anomaly | sigma
  datasets: [],    // products offering overlayState.response, sorted
  hidden: {},      // product -> true when its legend box is unchecked
};

let overlayIndex = null; // buildPickerIndexes(null): the full manifest index

function overlayColor(product) {
  return OVERLAY_COLORS[overlayState.datasets.indexOf(product) % OVERLAY_COLORS.length];
}

// Only variables carried by at least two datasets belong in this panel -- a
// one-dataset "overlay" is just the Time Series page. Default to SWE (the
// snow-drought headline variable, now carried by six datasets) when present,
// else the variable with the most datasets.
function overlayVariableOptions() {
  return overlayIndex.allVariables.filter((r) => overlayIndex.variableDatasets[r].length >= 2);
}

function pickDefaultOverlayVariable(options) {
  if (options.includes("SWE")) return "SWE";
  return options.reduce((best, r) =>
    (overlayIndex.variableDatasets[r].length > overlayIndex.variableDatasets[best].length ? r : best), options[0]);
}

function populateOverlayStartYear() {
  const { minYear, maxYear } = fullRecordYearRange();
  const select = document.getElementById("overlay-start-year-select");
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All years (from ${minYear})`;
  select.appendChild(allOption);
  for (let y = minYear; y <= maxYear; y++) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    select.appendChild(option);
  }
  overlayState.startYear = Math.max(minYear, COMPARE_DEFAULT_START_YEAR);
  select.value = String(overlayState.startYear);
}

function initOverlayPanel() {
  const chart = document.getElementById("overlay-chart");
  if (!chart) return;
  overlayIndex = buildPickerIndexes(null);

  const variableSelect = document.getElementById("overlay-variable-select");
  const options = overlayVariableOptions();
  fillVariableSelect(variableSelect, options, pickDefaultOverlayVariable(options), overlayIndex.variableCategory);
  overlayState.response = variableSelect.value;

  populateRegionSelect(document.getElementById("overlay-region-select"), overlayState.region);
  populateOverlayStartYear();

  variableSelect.addEventListener("change", (event) => {
    overlayState.response = event.target.value;
    overlayState.hidden = {}; // a new variable has its own datasets; start all-on
    renderOverlay();
  });
  document.getElementById("overlay-region-select").addEventListener("change", (event) => {
    overlayState.region = event.target.value;
    renderOverlay();
  });
  document.getElementById("overlay-start-year-select").addEventListener("change", (event) => {
    overlayState.startYear = event.target.value ? parseInt(event.target.value, 10) : null;
    renderOverlay();
  });
  document.getElementById("overlay-series-toggle").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-series]");
    if (!btn) return;
    overlayState.series = btn.dataset.series;
    document.querySelectorAll("#overlay-series-toggle button").forEach((x) => x.classList.toggle("active", x === btn));
    renderOverlay();
  });

  renderOverlay();
}

async function renderOverlay() {
  const chart = document.getElementById("overlay-chart");
  const response = overlayState.response;
  overlayState.datasets = (overlayIndex.variableDatasets[response] || []).slice().sort((a, b) => a.localeCompare(b));

  const jsons = await Promise.all(overlayState.datasets.map((product) => fetchTimeseriesJson(`${product}_${response}`)));
  const field = overlayState.series; // "value" | "anomaly" | "sigma"
  const isSigma = field === "sigma";
  const isAnomaly = field === "anomaly";
  const startYear = Math.max(DASHBOARD_MIN_YEAR, overlayState.startYear || DASHBOARD_MIN_YEAR);

  // One trace per dataset, in overlayState.datasets order (even when a dataset
  // has no data for this region -- an empty trace keeps trace index aligned
  // with the dataset order, so the legend checkboxes restyle the right line).
  const traces = [];
  const unitsSeen = new Set();
  let anyData = false;
  overlayState.datasets.forEach((product, i) => {
    const data = jsons[i];
    // Water-flux rates arrive in different time bases (GPCP & ERA5 mm/day,
    // PRISM mm/month). Harmonize mm-based rates to a monthly total (mm/month)
    // using each point's own month length so they overlay on one axis. Scoped
    // to mm so a per-day carbon flux (g C m-2 d-1) isn't mislabeled as mm.
    const mmPerDay = !isSigma && /mm/i.test(data.units || "") && /(\bd-1\b|day)/i.test(data.units || "");
    const mmRate = mmPerDay || (!isSigma && /mm/i.test(data.units || "") && /month/i.test(data.units || ""));
    if (!isSigma) unitsSeen.add(mmRate ? "mm month⁻¹" : canonicalUnit(data.units || ""));
    const region = data.regions[overlayState.region];
    let dates = [];
    let values = [];
    if (region) {
      const keep = region.dates.map((d) => parseInt(d.slice(0, 4), 10) >= startYear);
      dates = region.dates.filter((_, j) => keep[j]);
      // Scale into the canonical unit so datasets reporting the same quantity
      // under different unit strings (SWE kg m-2 vs mm, SIF per-µm vs per-nm)
      // overlay on one scale; mm/day rates additionally -> mm/month. σ unitless.
      values = region[field].filter((_, j) => keep[j]).map((v, j) => {
        if (v === null || v === undefined) return null;
        if (isSigma) return v;
        const cv = toCanonicalValue(v, data.units);
        if (!mmPerDay) return cv;
        const [y, m] = dates[j].split("-").map(Number);
        return cv * daysInMonth(y, m);
      });
      if (values.some((v) => v !== null)) anyData = true;
    }
    traces.push({
      x: dates, y: values, type: "scatter", mode: "lines", connectgaps: false,
      name: product, line: { color: overlayColor(product), width: 2 },
      visible: overlayState.hidden[product] ? "legendonly" : true,
      hovertemplate: `%{x|%Y-%m}: %{y:.2f}<extra>${product}</extra>`,
    });
  });

  const varName = responseDisplay(response);
  document.getElementById("overlay-title").textContent =
    `${varName} across datasets — ${regionLabelFor(overlayState.region)}`;

  const units = [...unitsSeen].filter(Boolean);
  let yTitle;
  if (isSigma) yTitle = "Standardized anomaly (σ)";
  else if (isAnomaly) yTitle = units.length === 1 ? `Anomaly (${units[0]})` : "Anomaly";
  else yTitle = units.length === 1 ? units[0] : "Mixed units";

  // In raw / anomaly views the lines only sit on one scale if the datasets
  // share units; warn (like the A-vs-B baseline note) when they don't. σ is
  // always comparable, but against each dataset's own baseline.
  let meta = "";
  if (isSigma) {
    meta = "σ is native-direction (positive = above each dataset's own baseline). Each dataset is standardized against its own record.";
    const sigmaGlossary = (manifest.value_type_glossary || {}).sigma;
    if (sigmaGlossary) meta += `<br>σ: ${sigmaGlossary}`;
  } else if (units.length > 1) {
    meta = `<strong>Note:</strong> the datasets report this variable in different units (${units.join(", ")}), so their raw values are not on one scale &mdash; switch to σ, or uncheck the datasets whose units differ.`;
  }
  document.getElementById("overlay-meta").innerHTML = meta;

  if (!anyData) {
    chart.innerHTML = `<p class="chart-empty">No data for ${regionLabelFor(overlayState.region)}.</p>`;
    renderOverlayLegend();
    return;
  }

  const layout = {
    margin: { t: 10, r: 20, b: 45, l: 66 },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    showlegend: false,
    hovermode: "x unified",
    xaxis: { title: "Year", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
    yaxis: { title: yTitle, zeroline: isSigma || isAnomaly, ...PLOTLY_AXIS_LINE },
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
  renderOverlayLegend();
}

// Checkbox legend: one toggle per dataset, color-swatched to its line. Hiding a
// box sets that trace to "legendonly" (kept in the figure, just not drawn) via
// restyle, so toggling never refetches or rebuilds the plot.
function renderOverlayLegend() {
  const legend = document.getElementById("overlay-legend");
  legend.innerHTML = "";
  overlayState.datasets.forEach((product, index) => {
    const item = document.createElement("label");
    item.className = "checkbox-legend-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !overlayState.hidden[product];
    box.addEventListener("change", () => {
      overlayState.hidden[product] = !box.checked;
      Plotly.restyle(document.getElementById("overlay-chart"), { visible: box.checked ? true : "legendonly" }, [index]);
    });
    const swatch = document.createElement("span");
    swatch.className = "checkbox-legend-swatch";
    swatch.style.background = overlayColor(product);
    const name = document.createElement("span");
    name.textContent = product;
    item.append(box, swatch, name);
    legend.appendChild(item);
  });
}

loadManifest().then(() => {
  initCompareView();
  initOverlayPanel();
});

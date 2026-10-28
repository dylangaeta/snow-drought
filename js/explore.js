// Time Series page: one product's raw value or standardized anomaly over
// its full monthly record. Picker (category/product/response/region) is
// shared with Seasonal Cycle (js/product-picker.js); every number here is
// read straight from the JSON exported by code/dashboard_export.py.

let timeseriesSeries = "value";
let timeseriesStartYear = null; // null = default recent window, see populateStartYearControl
let tsTableWindow = "DJFM"; // regional-summary-table window + year (feeds the shared table)
let tsTableYear = null;

// Default view starts at 2000, or the product's own first year if that's
// later -- the full 1990-2026 record crams ~430 monthly points into a solid
// black smear on any but a very wide screen, and short-record products (SMAP,
// SMOS, GRACE) shouldn't open on a long empty pre-record span. Full history
// stays one dropdown selection away, never removed, just not the default.
const DASHBOARD_DEFAULT_START_YEAR = 2000;

function populateStartYearControl(entry) {
  const recordStartYear = entry.record_start
    ? Math.max(DASHBOARD_MIN_YEAR, parseInt(entry.record_start.slice(0, 4), 10))
    : null;
  const recordEndYear = entry.record_end ? parseInt(entry.record_end.slice(0, 4), 10) : null;

  const select = document.getElementById("timeseries-start-year-select");
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All years (from ${DASHBOARD_MIN_YEAR})`;
  select.appendChild(allOption);
  let defaultStartYear = recordStartYear;
  if (recordStartYear !== null && recordEndYear !== null) {
    for (let y = recordStartYear; y <= recordEndYear; y++) {
      const option = document.createElement("option");
      option.value = String(y);
      option.textContent = String(y);
      select.appendChild(option);
    }
    defaultStartYear = Math.min(Math.max(recordStartYear, DASHBOARD_DEFAULT_START_YEAR), recordEndYear);
  }
  timeseriesStartYear = defaultStartYear;
  select.value = defaultStartYear !== null ? String(defaultStartYear) : "";
}

async function renderTimeseries() {
  const chart = document.getElementById("timeseries-chart");
  const data = await fetchTimeseriesJson(`${pickerState.product}_${pickerState.response}`);
  // Set before the no-data check, so the heading always names the region shown.
  document.getElementById("timeseries-title").textContent = `${pickerState.product} · ${responseDisplay(data.response)} — ${regionLabelFor(pickerState.region)}`;
  const region = data.regions[pickerState.region];
  if (!region) {
    chart.innerHTML = '<p class="chart-empty">No data for this region.</p>';
    return;
  }
  const isSigma = timeseriesSeries === "sigma";
  const isAnomaly = timeseriesSeries === "anomaly"; // physical-unit departure from baseline
  // Native-direction sigma here: +sigma = above-normal value, -sigma = below,
  // so SCA/SWE/precip depletion reads as NEGATIVE -- the intuitive direction
  // for a single-variable time series. The stress-direction sign flip
  // (positive = drought stress) stays on the cross-variable Heatmap and Map
  // views, where unifying every product's stress direction aids
  // comparison, but it misleads here (Dylan, 2026-10-02: SCA depletion was
  // showing as +sigma). Raw values are unaffected either way.
  // Raw value + raw-unit anomaly display in the canonical unit (e.g. kg m-2 -> mm).
  const unitFactor = canonicalUnitFactor(data.units);
  const dispUnits = canonicalUnit(data.units);
  const fullY = isSigma
    ? region.sigma.map((v) => (v === null || v === undefined ? null : v))
    : (isAnomaly ? region.anomaly : region.value).map((v) => (v === null || v === undefined ? null : v * unitFactor));
  // Native standardized indices (SPI/SPEI/EDDI/PDSI/ForDRI/ESI) are already
  // a standardized departure -- their sigma series is identical to raw, not
  // a re-standardization (see common/canonical.py::_load_drought_index).
  const sigmaLabel = data.native_standardized
    ? `${data.response} (native standardized index)`
    : "Standardized anomaly (σ)";
  const yTitle = isSigma ? sigmaLabel
    : isAnomaly ? `${data.response} anomaly (${dispUnits})`
    : `${data.response} (${dispUnits})`;
  const isDeparture = isSigma || isAnomaly;
  const startYear = Math.max(DASHBOARD_MIN_YEAR, timeseriesStartYear || DASHBOARD_MIN_YEAR);
  const dates = region.dates.filter((d) => parseInt(d.slice(0, 4), 10) >= startYear);
  const y = fullY.filter((_, i) => parseInt(region.dates[i].slice(0, 4), 10) >= startYear);
  const traces = [];
  // Formal one-sigma measurement uncertainty band, where the product publishes
  // it (GRACE mascon sigma, SMAP/SMOS retrieval error). It is in the value's own
  // units, so it is only meaningful on the raw-value view -- not anomaly/sigma.
  if (!isDeparture && region.uncertainty) {
    // Guard against a fill sentinel leaking through as a real uncertainty
    // (SMAP ships -9999 for every month): only a finite, non-negative value is
    // a valid ±1σ, otherwise the band would balloon to ±9999 and flatten the
    // real trace to an invisible line.
    const unc = region.uncertainty.filter((_, i) => parseInt(region.dates[i].slice(0, 4), 10) >= startYear)
      .map((v) => (v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : v * unitFactor));
    const upper = y.map((v, i) => (v === null || unc[i] === null || unc[i] === undefined ? null : v + unc[i]));
    const lower = y.map((v, i) => (v === null || unc[i] === null || unc[i] === undefined ? null : v - unc[i]));
    if (upper.some((v) => v !== null)) {
    traces.push({
      x: dates, y: upper, type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false,
    });
    traces.push({
      x: dates, y: lower, type: "scatter", mode: "lines",
      line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(27,27,27,0.15)",
      name: "±1σ measurement uncertainty", hoverinfo: "skip",
    });
    }
  }
  traces.push({
    x: dates, y, type: "scatter", mode: "lines",
    line: { color: "#1b1b1b", width: 1.4 },
    name: pickerState.product,
    hovertemplate: "%{x|%Y-%m}: %{y:.2f}<extra></extra>",
  });
  const sigmaNote = document.getElementById("timeseries-sigma-note");
  if (sigmaNote) {
    sigmaNote.textContent = (isSigma && !data.native_standardized && manifest.value_type_glossary)
      ? `σ: ${manifest.value_type_glossary.sigma || ""}`
      : "";
  }
  const layout = {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: yTitle, zeroline: false, ...PLOTLY_AXIS_LINE },
    xaxis: { title: "Year", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes: isDeparture ? [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }] : [],
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

// Regional summary table (shared design with the Map + Seasonal pages): every
// region's raw value / anomaly / sigma / rank for the selected window + year.
async function renderTimeseriesRegionTable() {
  const body = document.getElementById("timeseries-region-table-body");
  if (!body) return;
  const data = await fetchTimeseriesJson(`${pickerState.product}_${pickerState.response}`);
  document.getElementById("timeseries-region-table-heading").textContent =
    `Regional values — ${pickerState.product} · ${responseDisplay(data.response)}, ${periodLabel(tsTableWindow)} ${tsTableYear}`;
  const rawHeader = document.getElementById("timeseries-region-rawval-th");
  if (rawHeader) rawHeader.textContent = rawValueHeaderLabel(data, tsTableWindow);
  const note = document.getElementById("timeseries-region-table-note");
  if (!data.aggregation) {
    body.innerHTML = "";
    note.textContent = "No established window-aggregation rule for this variable.";
    return;
  }
  body.innerHTML = regionalSummaryRowsHtml(data, tsTableWindow, tsTableYear);
  applyPctOfNormalHeader(body, data);
  note.textContent = regionalSummaryNote(data);
}

function onTimeseriesSelectionChanged(entry) {
  // A new product/response has its own record span -- last product's start
  // year may not even exist in this one, so reset rather than carry it over.
  populateStartYearControl(entry);
  // Point the regional-summary table at this product's latest available year.
  const recordEndYear = entry.record_end ? parseInt(entry.record_end.slice(0, 4), 10) : null;
  const { maxYear } = fullRecordYearRange();
  tsTableYear = Math.min(recordEndYear || maxYear, maxYear);
  const yearSel = document.getElementById("timeseries-table-year-select");
  if (yearSel) yearSel.value = String(tsTableYear);
  renderTimeseries();
  renderTimeseriesRegionTable();
}

function wireTimeseriesControls() {
  document.getElementById("timeseries-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-series]");
    if (!button) return;
    timeseriesSeries = button.dataset.series;
    document.querySelectorAll("#timeseries-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderTimeseries();
  });
  document.getElementById("timeseries-start-year-select").addEventListener("change", (event) => {
    timeseriesStartYear = event.target.value ? parseInt(event.target.value, 10) : null;
    renderTimeseries();
  });
  // Regional summary table window + year pickers (shared populators + table).
  populateWindowSelect(document.getElementById("timeseries-table-window-select"), tsTableWindow);
  populateYearSelect(document.getElementById("timeseries-table-year-select"), fullRecordYearRange().maxYear);
  document.getElementById("timeseries-table-window-select").addEventListener("change", (event) => {
    tsTableWindow = event.target.value;
    renderTimeseriesRegionTable();
  });
  document.getElementById("timeseries-table-year-select").addEventListener("change", (event) => {
    tsTableYear = parseInt(event.target.value, 10);
    renderTimeseriesRegionTable();
  });
}

async function init() {
  await loadManifest();
  wireTimeseriesControls();
  initProductPicker(onTimeseriesSelectionChanged);
}

init();

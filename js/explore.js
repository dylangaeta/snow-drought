// Time Series page: one product's raw value or standardized anomaly over
// its full monthly record. Picker (category/product/response/region) is
// shared with Seasonal Cycle (js/product-picker.js); every number here is
// read straight from the JSON exported by code/dashboard_export.py.

let timeseriesSeries = "value";
let timeseriesStartYear = null; // null = default recent window, see populateStartYearControl

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
  // (positive = drought stress) stays on the cross-variable views (Compare,
  // Heatmap, Map), where unifying every product's stress direction aids
  // comparison, but it misleads here (Dylan, 2026-10-02: SCA depletion was
  // showing as +sigma). Raw values are unaffected either way.
  const fullY = isSigma
    ? region.sigma.map((v) => (v === null || v === undefined ? null : v))
    : isAnomaly ? region.anomaly : region.value;
  // Native standardized indices (SPI/SPEI/EDDI/PDSI/ForDRI/ESI) are already
  // a standardized departure -- their sigma series is identical to raw, not
  // a re-standardization (see common/canonical.py::_load_drought_index).
  const sigmaLabel = data.native_standardized
    ? `${data.response} (native standardized index)`
    : "Standardized anomaly (σ)";
  const yTitle = isSigma ? sigmaLabel
    : isAnomaly ? `${data.response} anomaly (${data.units})`
    : `${data.response} (${data.units})`;
  const isDeparture = isSigma || isAnomaly;
  const startYear = Math.max(DASHBOARD_MIN_YEAR, timeseriesStartYear || DASHBOARD_MIN_YEAR);
  const dates = region.dates.filter((d) => parseInt(d.slice(0, 4), 10) >= startYear);
  const y = fullY.filter((_, i) => parseInt(region.dates[i].slice(0, 4), 10) >= startYear);
  const traces = [{
    x: dates, y, type: "scatter", mode: "lines",
    line: { color: "#1b1b1b", width: 1.4 },
    name: yTitle,
    hovertemplate: "%{x|%Y-%m}: %{y:.2f}<extra></extra>",
  }];
  document.getElementById("timeseries-title").textContent = `${pickerState.product} · ${data.response} — ${regionLabelFor(pickerState.region)}`;
  const layout = {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: yTitle, zeroline: isDeparture, ...PLOTLY_AXIS_LINE },
    xaxis: { title: "Year", showgrid: false, ...PLOTLY_AXIS_LINE, ...PLOTLY_YEARLY_MINOR_TICKS },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes: isDeparture ? [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }] : [],
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

function onTimeseriesSelectionChanged(entry) {
  // A new product/response has its own record span -- last product's start
  // year may not even exist in this one, so reset rather than carry it over.
  populateStartYearControl(entry);
  renderTimeseries();
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
}

async function init() {
  await loadManifest();
  wireTimeseriesControls();
  initProductPicker(onTimeseriesSelectionChanged);
}

init();

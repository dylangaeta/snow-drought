// Seasonal Cycle page: one product's water-year cycle (climatology + a few
// highlight years + any user-added ones). Picker (category/product/
// response/region) is shared with Time Series (js/product-picker.js).

let seasonalSeries = "raw";
let seasonalSelectedYears = [];   // winter years currently checked (shown on the chart)
let seasonalAvailableYears = [];  // every selectable winter year for this product, newest first
let seasonalYearColor = {};       // year -> stable hex color for this product
let seasonalTableWindow = "DJFM"; // regional-summary-table window + year (feeds the shared table)
let seasonalTableYear = null;

// Distinct from manifest.seasonal_highlight_year_colors (an orange/red
// family) and from the teal climatology-mean line, so non-highlight years
// never blend into either.
const EXTRA_YEAR_COLORS = ["#3182bd", "#756bb1", "#31a354", "#e7298a", "#636363", "#1b9e77"];

// "2025-2026" not "Water year 2026" -- matches the format the pre-defined
// highlight years already use (manifest.seasonal_highlight_years' own
// curve.label), so a user-added year reads the same way, not a different
// naming convention for what's otherwise an identical kind of series.
function waterYearLabel(year) {
  return `${year - 1}-${year}`;
}

// Water-year-ordered {raw, anomaly} for an arbitrary year, built client-side
// from the already-complete monthly timeseries data (region.dates/.value/
// .anomaly cover the full record) -- the same shape manifest.seasonal_
// highlight_years' precomputed curves already use, so it overlays exactly
// like one of the default highlight years. null where a whole year's data
// isn't available (e.g. year not fully in the record) rather than plotting
// a broken partial curve.
function computeWaterYearCurve(region, year) {
  const months = [
    [10, year - 1], [11, year - 1], [12, year - 1],
    [1, year], [2, year], [3, year], [4, year], [5, year],
    [6, year], [7, year], [8, year], [9, year],
  ];
  const raw = [];
  const anomaly = [];
  for (const [month, y] of months) {
    const dateStr = `${y}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    raw.push(idx === -1 ? null : region.value[idx]);
    anomaly.push(idx === -1 ? null : region.anomaly[idx]);
  }
  return raw.every((v) => v === null) ? null : { raw, anomaly };
}

// Every selectable winter year for this product (newest first), each with a
// stable color, plus the default-checked set (the manifest highlight years
// that exist in this product's record). A water year runs Oct(Y-1)-Sep(Y), so
// the earliest selectable one needs a full prior October already in the
// record -- starts one year after the record's own first calendar year.
function buildSeasonalYears(entry) {
  const recordStartYear = entry.record_start
    ? Math.max(DASHBOARD_MIN_YEAR, parseInt(entry.record_start.slice(0, 4), 10))
    : null;
  const recordEndYear = entry.record_end ? parseInt(entry.record_end.slice(0, 4), 10) : null;
  seasonalAvailableYears = [];
  if (recordStartYear !== null && recordEndYear !== null) {
    for (let y = recordEndYear; y >= recordStartYear + 1; y--) seasonalAvailableYears.push(y);
  }
  // Highlight years keep their fixed manifest color; every other year cycles
  // the distinct extra-year palette, assigned by descending year so a given
  // year's color never shifts as other years are toggled on and off.
  seasonalYearColor = {};
  let extraIdx = 0;
  seasonalAvailableYears.forEach((y) => {
    const highlightColor = manifest.seasonal_highlight_year_colors[String(y)];
    if (manifest.seasonal_highlight_years.includes(y) && highlightColor) {
      seasonalYearColor[y] = highlightColor;
    } else {
      seasonalYearColor[y] = EXTRA_YEAR_COLORS[extraIdx % EXTRA_YEAR_COLORS.length];
      extraIdx++;
    }
  });
  seasonalSelectedYears = manifest.seasonal_highlight_years.filter((y) => seasonalAvailableYears.includes(y));
}

async function renderSeasonal() {
  const chart = document.getElementById("seasonal-chart");
  const data = await fetchSeasonalJson(`${pickerState.product}_${pickerState.response}`);
  const region = data.regions[pickerState.region];
  if (!region) {
    chart.innerHTML = '<p class="chart-empty">No data for this region.</p>';
    return;
  }
  const x = manifest.water_year_month_names;
  // Two-row tick labels (month above, calendar year below) using the most
  // recent highlight year as the reference water year -- Oct/Nov/Dec are
  // that water year's own prior calendar year, Jan-Sep are its own. Every
  // overlaid curve is still its OWN real water year underneath (the x
  // values themselves stay plain month names); this only makes the
  // shared axis concretely dated instead of a bare, ambiguous "Oct...Sep".
  const isNarrow = window.innerWidth < 820;
  const referenceYear = Math.max(...manifest.seasonal_highlight_years);
  // On a phone the two-line month+year ticks collide into garbled text, so show
  // just the month there and drop the dated-year second line.
  const tickText = isNarrow ? x : x.map((month, i) => `${month}<br>${i < 3 ? referenceYear - 1 : referenceYear}`);
  const isAnomaly = seasonalSeries === "anomaly";
  const teal = manifest.climatology_color;
  // Raw value / climatology band / anomaly display in the canonical unit (e.g. kg m-2 -> mm).
  const unitFactor = canonicalUnitFactor(data.units);
  const dispUnits = canonicalUnit(data.units);
  const scaleUnit = (arr) => (arr || []).map((v) => (v === null || v === undefined ? null : v * unitFactor));
  const upper = scaleUnit(isAnomaly ? region.anomaly_upper : region.climatology_upper);
  const lower = scaleUnit(isAnomaly ? region.anomaly_lower : region.climatology_lower);
  const mean = isAnomaly ? upper.map(() => 0) : scaleUnit(region.climatology_mean);

  const traces = [
    { x, y: lower, type: "scatter", mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    {
      x, y: upper, type: "scatter", mode: "lines", line: { width: 0 }, fill: "tonexty",
      fillcolor: hexToRgba(teal, 0.25), name: "Climatology ±2σ", showlegend: false, hoverinfo: "skip",
    },
    {
      x, y: mean, type: "scatter", mode: "lines+markers", line: { color: teal, width: 3 },
      marker: { color: teal, size: 6 }, name: "Climatological mean", showlegend: false,
    },
  ];
  // Any selected year that isn't a precomputed highlight year is built
  // client-side from the already-complete monthly timeseries (cached), so an
  // arbitrary year overlays exactly like a highlight year without a new export.
  const needsTimeseries = seasonalSelectedYears.some((year) => !region.highlight_years[String(year)]);
  let tsRegion = null;
  if (needsTimeseries) {
    const tsData = await fetchTimeseriesJson(`${pickerState.product}_${pickerState.response}`);
    tsRegion = tsData.regions[pickerState.region];
  }
  seasonalAvailableYears
    .filter((year) => seasonalSelectedYears.includes(year))
    .forEach((year) => {
      const highlightCurve = region.highlight_years[String(year)];
      const curve = highlightCurve || (tsRegion && computeWaterYearCurve(tsRegion, year));
      if (!curve) return;
      traces.push({
        x, y: scaleUnit(isAnomaly ? curve.anomaly : curve.raw), type: "scatter", mode: "lines",
        line: { color: seasonalYearColor[year], width: 2, dash: highlightCurve ? undefined : "dot" },
        name: waterYearLabel(year), showlegend: false,
      });
    });
  // Plotly's default legend sits to the right of the plot -- fine on a wide
  // screen, but on mobile it squeezed the actual chart into less than half
  // the viewport width with illegible, crammed two-line month/year tick
  // labels (confirmed live, 375px). Below the chart, horizontal, instead --
  // same breakpoint map.html's own side-panel-to-stacked layout already uses.
  document.getElementById("seasonal-title").textContent = `${pickerState.product} · ${responseDisplay(data.response)} — ${regionLabelFor(pickerState.region)}`;
  const layout = {
    margin: { t: 20, r: 20, b: isNarrow ? 90 : 55, l: 60 },
    yaxis: { title: isAnomaly ? `${data.response} anomaly (${dispUnits})` : `${data.response} (${dispUnits})`, zeroline: isAnomaly, ...PLOTLY_AXIS_LINE },
    xaxis: { type: "category", tickvals: x, ticktext: tickText, showgrid: false, ...PLOTLY_AXIS_LINE },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    showlegend: false, // the HTML checkbox legend below the chart replaces Plotly's
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
  renderSeasonalLegend();
}

// Checkbox legend below the chart: static climatology references, then one
// checkbox per available winter year (newest first), the highlight years
// checked by default. Checking a year overlays it; unchecking removes it.
function renderSeasonalLegend() {
  const legend = document.getElementById("seasonal-legend");
  if (!legend) return;
  legend.innerHTML = "";
  const teal = manifest.climatology_color;
  [
    { label: "Climatological mean", color: teal },
    { label: "Climatology ±2σ", color: hexToRgba(teal, 0.35) },
  ].forEach(({ label, color }) => {
    const item = document.createElement("span");
    item.className = "checkbox-legend-item is-static";
    const swatch = document.createElement("span");
    swatch.className = "checkbox-legend-swatch";
    swatch.style.background = color;
    const name = document.createElement("span");
    name.textContent = label;
    item.append(swatch, name);
    legend.appendChild(item);
  });
  seasonalAvailableYears.forEach((year) => {
    const item = document.createElement("label");
    item.className = "checkbox-legend-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = seasonalSelectedYears.includes(year);
    box.addEventListener("change", () => {
      if (box.checked) {
        if (!seasonalSelectedYears.includes(year)) seasonalSelectedYears.push(year);
      } else {
        seasonalSelectedYears = seasonalSelectedYears.filter((y) => y !== year);
      }
      renderSeasonal();
    });
    const swatch = document.createElement("span");
    swatch.className = "checkbox-legend-swatch";
    swatch.style.background = seasonalYearColor[year];
    const name = document.createElement("span");
    name.textContent = waterYearLabel(year);
    item.append(box, swatch, name);
    legend.appendChild(item);
  });
}

// Regional summary table (shared design with the Map + Time Series pages):
// every region's raw value / anomaly / sigma / rank for the selected window+year.
async function renderSeasonalRegionTable() {
  const body = document.getElementById("seasonal-region-table-body");
  if (!body) return;
  const data = await fetchTimeseriesJson(`${pickerState.product}_${pickerState.response}`);
  document.getElementById("seasonal-region-table-heading").textContent =
    `Regional values — ${pickerState.product} · ${responseDisplay(data.response)}, ${periodLabel(seasonalTableWindow)} ${seasonalTableYear}`;
  const rawHeader = document.getElementById("seasonal-region-rawval-th");
  if (rawHeader) rawHeader.textContent = rawValueHeaderLabel(data, seasonalTableWindow);
  const note = document.getElementById("seasonal-region-table-note");
  if (!data.aggregation) {
    body.innerHTML = "";
    note.textContent = "No established window-aggregation rule for this variable.";
    return;
  }
  body.innerHTML = regionalSummaryRowsHtml(data, seasonalTableWindow, seasonalTableYear);
  applyPctOfNormalHeader(body, data);
  note.textContent = regionalSummaryNote(data);
}

function onSeasonalSelectionChanged(entry) {
  // A new product/response has its own record span and its own highlight-year
  // default, so rebuild the selectable years rather than carry the old set over.
  buildSeasonalYears(entry);
  const recordEndYear = entry.record_end ? parseInt(entry.record_end.slice(0, 4), 10) : null;
  const { maxYear } = fullRecordYearRange();
  seasonalTableYear = Math.min(recordEndYear || maxYear, maxYear);
  const yearSel = document.getElementById("seasonal-table-year-select");
  if (yearSel) yearSel.value = String(seasonalTableYear);
  renderSeasonal();
  renderSeasonalRegionTable();
}

function wireSeasonalControls() {
  document.getElementById("seasonal-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-series]");
    if (!button) return;
    seasonalSeries = button.dataset.series;
    document.querySelectorAll("#seasonal-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderSeasonal();
  });
  // Regional summary table window + year pickers (shared populators + table).
  populateWindowSelect(document.getElementById("seasonal-table-window-select"), seasonalTableWindow);
  populateYearSelect(document.getElementById("seasonal-table-year-select"), fullRecordYearRange().maxYear);
  document.getElementById("seasonal-table-window-select").addEventListener("change", (event) => {
    seasonalTableWindow = event.target.value;
    renderSeasonalRegionTable();
  });
  document.getElementById("seasonal-table-year-select").addEventListener("change", (event) => {
    seasonalTableYear = parseInt(event.target.value, 10);
    renderSeasonalRegionTable();
  });
}

async function init() {
  await loadManifest();
  wireSeasonalControls();
  initProductPicker(onSeasonalSelectionChanged);
}

init();

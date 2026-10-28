// Overview page. No static images anywhere -- every figure here is
// computed live from the same JSON every other page uses. The pipeline's
// cross-product combined-overlay and monthly-anomaly-heatmap questions
// (formerly static PNGs) are answered by the *same* dynamic components
// already built elsewhere (explore.html's Compare variables, data.html's
// Heatmaps), not reimplemented a second time here -- one implementation, no
// risk of the two views drifting apart. This page only holds visualizations
// that don't already live elsewhere: the snow-drought quadrant
// classification, below. (The observational-coverage timeline used to live
// here too -- moved to about.html, since it's a dataset/reference fact, not
// a finding.)

// Snow-drought quadrant classification -- mirrors
// code/94_context_SnowDroughtQuadrants_analyze.py's VARIABLES/REGIMES/
// classify() exactly (do not diverge). The regime itself always comes from
// the pipeline's own precomputed classification (data/
// snow_drought_classification.json's "regime" field), never recomputed here.
// Labels are dataset-qualified, matching 94_context_SnowDroughtQuadrants_
// analyze.py's own VARIABLES dict (its "label" field). Each variable carries
// its own temporal window (t2m/precip over Oct-Apr, SWE at the annual peak,
// everything else DJFM) in a `window` field so two otherwise-parallel options
// (e.g. PRISM precip Oct-Apr vs ERA5-Land precip DJFM) are distinguishable;
// the window + unit are shown in the axis/colorbar titles.
// Expanded 2026-10-01 (Dylan: "we should be able to plot more temp/vpd/
// precip/snow variables") with 5 more ERA5-Land/PRISM drivers already in the
// same pipeline file, no new reducer needed.
const QUADRANT_VARIABLES = {
  t_anom: { label: "ERA5-Land Temperature", window: "Oct–Apr", unit: "°C", stress_high: true, stress: "warm", benign: "cold" },
  ppt_anom: { label: "PRISM Precipitation", window: "Oct–Apr", unit: "mm", stress_high: false, stress: "dry", benign: "wet" },
  swe_anom: { label: "SNOTEL Peak SWE", window: "", unit: "mm", stress_high: false, stress: "low snow", benign: "high snow" },
  vpd_anom: { label: "PRISM Max VPD", window: "DJFM", unit: "hPa", stress_high: true, stress: "high VPD", benign: "low VPD" },
  vpdmin_anom: { label: "PRISM Min VPD", window: "DJFM", unit: "hPa", stress_high: true, stress: "high VPD", benign: "low VPD" },
  sca_terra_anom: { label: "MODIS-Terra Snow Cover", window: "DJFM", unit: "%", stress_high: false, stress: "low snow cover", benign: "high snow cover" },
  sca_aqua_anom: { label: "MODIS-Aqua Snow Cover", window: "DJFM", unit: "%", stress_high: false, stress: "low snow cover", benign: "high snow cover" },
  era5_vpd_anom: { label: "ERA5-Land VPD", window: "DJFM", unit: "hPa", stress_high: true, stress: "high VPD", benign: "low VPD" },
  era5_ppt_anom: { label: "ERA5-Land Precipitation", window: "DJFM", unit: "mm", stress_high: false, stress: "dry", benign: "wet" },
  era5_swe_anom: { label: "ERA5-Land SWE", window: "DJFM", unit: "mm", stress_high: false, stress: "low snow", benign: "high snow" },
  era5_sca_anom: { label: "ERA5-Land Snow Cover", window: "DJFM", unit: "%", stress_high: false, stress: "low snow cover", benign: "high snow cover" },
};
// Exactly three snow-drought types plus "none" (peak SWE at/above its mean, so
// not a drought) -- no "other" regime (mirrors 94_context_SnowDroughtQuadrants_
// analyze.py's REGIMES).
const REGIME_COLORS = { dry: "#dfc27d", warm_dry: "#d6604d", warm: "#f4a582", none: "#92c5de" };
// Darker, higher-contrast versions for the corner-label TEXT on the white
// panel -- the pale marker tints above fail WCAG contrast as text.
const REGIME_TEXT_COLORS = { dry: "#8a6d1b", warm_dry: "#a50f15", warm: "#c0392b", none: "#2166ac" };
// A second (shape) channel per regime so the scatter isn't color-only.
const REGIME_SYMBOLS = { dry: "diamond", warm_dry: "square", warm: "triangle-up", none: "circle" };
const REGIME_LABELS = {
  dry: "Dry snow drought", warm_dry: "Warm & dry snow drought",
  warm: "Warm snow drought", none: "No snow drought",
};
// Short legend labels so the horizontal legend stays on a single row (the full
// labels wrap and overlap the plot); hover text and the table keep REGIME_LABELS.
const REGIME_LEGEND_LABELS = {
  dry: "Dry", warm_dry: "Warm & dry", warm: "Warm", none: "No drought",
};
// Driver-anomaly coloring: a continuous NCL ramp as a Plotly colorscale, with
// pure white at the midpoint (the MPL_ tables are off-white there, and zero
// anomaly is meaningful). Thermal/demand drivers (stress_high) read red = warm
// on MPL_RdBu reversed; moisture/snow drivers read brown = low on MPL_BrBG.
function driverColorscale(stressHigh) {
  const colors = NCL_COLORMAPS.diverging[stressHigh ? "MPL_RdBu" : "MPL_BrBG"].colors.slice();
  if (stressHigh) colors.reverse();
  if (colors.length % 2 === 0) throw new Error("driverColorscale needs an odd number of stops to center white");
  colors[(colors.length - 1) / 2] = "#ffffff";
  return colors.map((color, i) => [i / (colors.length - 1), color]);
}

const quadrantState = { region: "ALL", x: "t_anom", y: "swe_anom", color: "ppt_anom", rows: [] };

async function initQuadrantView() {
  const xSelect = document.getElementById("quadrant-x-select");
  if (!xSelect) return;
  const res = await fetch(assetUrl("data/snow_drought_classification.json"));
  if (!res.ok) {
    document.getElementById("snow-drought-classification").style.display = "none";
    return;
  }
  quadrantState.rows = await res.json();

  // This classification is computed over PILOT_REGIONS specifically (see
  // 94_context_SnowDroughtQuadrants_analyze.py), a narrower set than the
  // dashboard's general manifest.region_labels -- so the region options
  // here come from whichever regions actually appear in this file's own
  // data, not the full region list. manifest.region_labels only supplies
  // the display label for whatever region codes are actually present.
  const regionSelect = document.getElementById("quadrant-region-select");
  const regionCodes = [...new Set(quadrantState.rows.map((r) => r.region))];
  regionSelect.innerHTML = "";
  regionCodes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = regionLabelFor(code);
    if (code === quadrantState.region) option.selected = true;
    regionSelect.appendChild(option);
  });

  const ySelect = document.getElementById("quadrant-y-select");
  Object.entries(QUADRANT_VARIABLES).forEach(([key, meta]) => {
    [xSelect, ySelect].forEach((select) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = meta.label;
      select.appendChild(option);
    });
  });
  xSelect.value = quadrantState.x;
  ySelect.value = quadrantState.y;

  const colorSelect = document.getElementById("quadrant-color-select");
  const colorOptions = [["year", "Winter year"],
    ...Object.entries(QUADRANT_VARIABLES).map(([key, meta]) => [key, meta.label]),
    ["regime", "Classification regime"]];
  colorOptions.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    colorSelect.appendChild(option);
  });
  colorSelect.value = quadrantState.color;

  xSelect.addEventListener("change", (e) => { quadrantState.x = e.target.value; renderQuadrantChart(); });
  ySelect.addEventListener("change", (e) => { quadrantState.y = e.target.value; renderQuadrantChart(); });
  colorSelect.addEventListener("change", (e) => { quadrantState.color = e.target.value; renderQuadrantChart(); });
  regionSelect.addEventListener("change", (e) => {
    quadrantState.region = e.target.value;
    renderQuadrantChart();
    renderQuadrantTable();
  });

  renderQuadrantChart();
  renderQuadrantTable();
}

function renderQuadrantChart() {
  const chart = document.getElementById("quadrant-chart");
  const { region, x, y, rows } = quadrantState;
  const xMeta = QUADRANT_VARIABLES[x];
  const yMeta = QUADRANT_VARIABLES[y];
  const points = rows.filter((r) => r.region === region && r[x] !== null && r[y] !== null);
  if (points.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No data for this axis pair/region.</p>';
    return;
  }

  const xmax = Math.max(...points.map((p) => Math.abs(p[x]))) * 1.12;
  const ymax = Math.max(...points.map((p) => Math.abs(p[y]))) * 1.12;
  const shapes = [];
  const annotations = [];
  // Quadrant corner labels (no background shading -- the panels stay white). On
  // the Dierauer default pair (x = precipitation, y = temperature) the three
  // snow-drought TYPES partition the plane exactly as classify() keys them on
  // precipitation: adequate precip (right half) = warm; a precip deficit splits
  // by temperature into warm & dry (upper left) and dry (lower left). The
  // below-mean-peak-SWE gate (SWE on neither axis) decides whether a winter is a
  // drought at all, so it is shown per point via color-by-regime + hover -- the
  // corner label only names the type a drought winter's precip/temperature would
  // imply, never which winters are droughts. Any other axis pair has no such
  // partition, so fall back to labeling the fully-stressed / fully-benign
  // corners by axis position.
  const dierauerPair = x === "ppt_anom" && y === "t_anom";
  if (dierauerPair) {
    const corners = {
      warm: [xmax, ymax, "right", "top"],
      warm_dry: [-xmax, ymax, "left", "top"],
      dry: [-xmax, -ymax, "left", "bottom"],
    };
    Object.entries(corners).forEach(([regime, [cx, cy, xa, ya]]) => {
      annotations.push({
        x: cx * 0.96, y: cy * 0.96, text: REGIME_LABELS[regime], showarrow: false,
        font: { size: 12, color: REGIME_TEXT_COLORS[regime], weight: 700 },
        xanchor: xa, yanchor: ya,
      });
    });
  } else {
    const sx = xMeta.stress_high ? 1 : -1;
    const sy = yMeta.stress_high ? 1 : -1;
    const sxp = sx > 0 ? xmax : -xmax;
    const syp = sy > 0 ? ymax : -ymax;
    annotations.push({
      x: sxp * 0.96, y: syp * 0.96, text: `${yMeta.stress} + ${xMeta.stress}`, showarrow: false,
      font: { size: 12, color: "#955910", weight: 700 },
      xanchor: sx > 0 ? "right" : "left", yanchor: sy > 0 ? "top" : "bottom",
    });
    annotations.push({
      x: -sxp * 0.96, y: -syp * 0.96, text: `${yMeta.benign} + ${xMeta.benign}`, showarrow: false,
      font: { size: 12, color: "#0570b0", weight: 700 },
      xanchor: sx > 0 ? "left" : "right", yanchor: sy > 0 ? "bottom" : "top",
    });
  }

  // Year labels on every point with a short leader line, matching the static
  // classification figures (Dylan, #3); 2026 is bold and larger. On a phone the
  // 36 labels collide into an unreadable mass, so there show only 2026.
  const isNarrow = typeof window !== "undefined" && window.innerWidth < 600;
  const sizes = points.map((p) => (p.winter_year === 2026 ? 16 : 9));
  points.forEach((p) => {
    if (isNarrow && p.winter_year !== 2026) return;
    annotations.push({
      x: p[x], y: p[y], text: String(p.winter_year),
      showarrow: true, arrowhead: 0, arrowwidth: 0.7, arrowcolor: "#bbb", ax: 10, ay: -11,
      font: {
        size: p.winter_year === 2026 ? 14 : 12,
        color: p.winter_year === 2026 ? "#111" : "#555",
        weight: p.winter_year === 2026 ? 700 : 400,
      },
    });
  });

  // Color encoding (3rd axis): by regime (default; categorical, so one trace
  // per regime to get a real legend -- a discrete field has no colorbar), by
  // winter year (sequential), or by any driver variable's anomaly (diverging,
  // centered at 0).
  const colorBy = quadrantState.color;
  let traces;
  if (colorBy === "regime") {
    traces = Object.keys(REGIME_COLORS)
      .filter((regime) => points.some((p) => p.regime === regime))
      .map((regime) => {
        const pr = points.filter((p) => p.regime === regime);
        return {
          x: pr.map((p) => p[x]), y: pr.map((p) => p[y]),
          mode: "markers", type: "scatter", name: REGIME_LEGEND_LABELS[regime],
          marker: {
            size: pr.map((p) => (p.winter_year === 2026 ? 16 : 9)),
            color: REGIME_COLORS[regime], symbol: REGIME_SYMBOLS[regime], line: { color: "#333", width: 0.8 },
          },
          hovertext: pr.map((p) => `${p.winter_year}: ${REGIME_LABELS[p.regime]}`),
          hoverinfo: "text",
        };
      });
  } else {
    let marker;
    if (colorBy === "year") {
      marker = {
        size: sizes, color: points.map((p) => p.winter_year), colorscale: "Viridis",
        colorbar: { title: { text: "Winter year", side: "right" }, thickness: 14 },
        line: { color: "#333", width: 0.8 },
      };
    } else {
      const cMeta = QUADRANT_VARIABLES[colorBy];
      const values = points.map((p) => p[colorBy]).filter((v) => v !== null);
      const limit = Math.max(...values.map((v) => Math.abs(v)));
      marker = {
        size: sizes, color: points.map((p) => p[colorBy]),
        colorscale: driverColorscale(cMeta.stress_high), cmin: -limit, cmax: limit,
        colorbar: { title: { text: `${cMeta.label}${cMeta.window ? " " + cMeta.window : ""} anomaly (${cMeta.unit})`, side: "right" }, thickness: 14 },
        line: { color: "#333", width: 0.8 },
      };
    }
    traces = [{
      x: points.map((p) => p[x]), y: points.map((p) => p[y]),
      mode: "markers", type: "scatter", marker,
      hovertext: points.map((p) => `${p.winter_year}: ${REGIME_LABELS[p.regime]}`),
      hoverinfo: "text",
    }];
  }

  const layout = {
    margin: { t: colorBy === "regime" ? 70 : 20, r: isNarrow ? 58 : 80, b: 55, l: isNarrow ? 48 : 65 },
    xaxis: { ...PLOTLY_AXIS_LINE, title: `${xMeta.label}${xMeta.window ? " " + xMeta.window : ""} anomaly (${xMeta.unit})`, range: [-xmax, xmax], zeroline: true, zerolinecolor: "#555" },
    yaxis: { ...PLOTLY_AXIS_LINE, title: `${yMeta.label}${yMeta.window ? " " + yMeta.window : ""} anomaly (${yMeta.unit})`, range: [-ymax, ymax], zeroline: true, zerolinecolor: "#555" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes, annotations,
    showlegend: colorBy === "regime",
    legend: { orientation: "h", y: 1.05, yanchor: "bottom", x: 0.5, xanchor: "center", font: { size: 12 } },
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

// Tabulated classification results for the selected region: every DJFM winter
// with its regime and the three driver anomalies, loaded on page load alongside
// the scatter so the actual values are inspectable, not just plotted.
function renderQuadrantTable() {
  const body = document.getElementById("quadrant-table-body");
  if (!body) return;
  const region = quadrantState.region;
  const heading = document.getElementById("quadrant-table-heading");
  if (heading) heading.textContent = `Classification by winter — ${regionLabelFor(region)}`;
  const fmt = (v, d) => (v === null || v === undefined ? "&mdash;" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
  const rows = quadrantState.rows
    .filter((r) => r.region === region)
    .sort((a, b) => a.winter_year - b.winter_year);
  body.innerHTML = rows.map((r) => {
    const color = REGIME_COLORS[r.regime] || "#ccc";
    const swatch = `<span style="display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:7px;vertical-align:-1px;background:${color}"></span>`;
    return `<tr><td>${r.winter_year}</td><td>${swatch}${REGIME_LABELS[r.regime] || r.regime}</td>`
      + `<td>${fmt(r.t_anom, 2)}</td><td>${fmt(r.ppt_anom, 1)}</td><td>${fmt(r.swe_anom, 1)}</td></tr>`;
  }).join("");
}

loadManifest().then(() => {
  initQuadrantView();
});

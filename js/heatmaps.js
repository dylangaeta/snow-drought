// Heatmap page (heatmaps.html). Product x time standardized-anomaly matrix,
// computed dynamically from the same data every other chart on this
// dashboard uses -- not a static image. The "wy_<year>" families are a fixed
// special case (direct per-month sigma across one water year, Oct-Sep, for
// comparing products along one shared recent timeline). Every other family is
// "this window, by year" -- the same season/month windows and the same
// computeWindowValue() aggregation the interactive map's period select and the
// summary table already use, so a heatmap row and the matching map/table value
// are always computed the same way.

// Water-year monthly families, newest first, back to this floor -- a per-month
// heatmap older than ~15 years is rarely the question on a current-conditions
// dashboard, and the list stays scannable.
const HEATMAP_WATER_YEAR_FLOOR = 2010;
const HEATMAP_FAMILIES = {};
for (let wy = currentWaterYear(); wy >= HEATMAP_WATER_YEAR_FLOOR; wy--) {
  HEATMAP_FAMILIES[`wy_${wy}`] = { label: `WY${wy} (Oct ${wy - 1} – Sep ${wy})`, waterYear: wy };
}
SEASON_ORDER.forEach((key) => {
  HEATMAP_FAMILIES[`window_${key}`] = { label: `${key} (${SEASON_LABELS[key]}), by year`, window: key };
});
MONTH_NAMES.forEach((name, i) => {
  const key = String(i + 1).padStart(2, "0");
  HEATMAP_FAMILIES[`window_${key}`] = { label: `${name}, by year`, window: key };
});

// null = full record (every "by year" heatmap already scrolls horizontally
// for a wide column count -- see .heatmap-chart-scroll -- so unlike Time
// Series' single continuous line, there's no "solid smear" problem with
// defaulting to the full history here). Only meaningful for the "by year"
// families; the "wy_<year>" water-year families are always a fixed Oct-Sep
// window, so the start-year control doesn't apply to them. Default to the
// current water year.
const heatmapState = { family: `wy_${currentWaterYear()}`, category: "all", region: "ALL", startYear: null };

function initHeatmapStartYearControl() {
  const select = document.getElementById("heatmap-start-year-select");
  if (!select) return;
  const { minYear, maxYear } = fullRecordYearRange();
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
  select.value = heatmapState.startYear !== null ? String(heatmapState.startYear) : "";
  select.addEventListener("change", (event) => {
    heatmapState.startYear = event.target.value ? parseInt(event.target.value, 10) : null;
    renderHeatmap();
  });
}

// The water-year families are a fixed Oct-Sep window -- startYear has no
// effect on them, so disable the control rather than leave it silently inert
// (picking a year and seeing nothing change reads as broken).
function updateStartYearAvailability() {
  const select = document.getElementById("heatmap-start-year-select");
  if (!select) return;
  select.disabled = heatmapState.family.startsWith("wy_");
}

function initHeatmaps() {
  const familySelect = document.getElementById("heatmap-family-select");
  if (!familySelect) return;
  populateRegionSelect(document.getElementById("heatmap-region-select"), heatmapState.region);
  Object.entries(HEATMAP_FAMILIES).forEach(([key, family]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = family.label;
    familySelect.appendChild(option);
  });
  familySelect.value = heatmapState.family;
  updateStartYearAvailability();
  familySelect.addEventListener("change", (event) => {
    heatmapState.family = event.target.value;
    updateStartYearAvailability();
    renderHeatmap();
  });

  document.getElementById("heatmap-region-select").addEventListener("change", (event) => {
    heatmapState.region = event.target.value;
    renderHeatmap();
  });
  initHeatmapStartYearControl();

  // Default to the first category (Snow), not the full "all products" matrix.
  heatmapState.category = manifest.category_order[0];
  renderHeatmapCategoryTabs();
  renderHeatmap();
}

function renderHeatmapCategoryTabs() {
  const nav = document.getElementById("heatmap-category-tabs");
  nav.innerHTML = "";
  manifest.category_order.forEach((category) => {
    const button = document.createElement("button");
    button.className = "category-tab";
    if (category === heatmapState.category) button.classList.add("active");
    button.textContent = categoryLabelWithIcon(category);
    button.style.setProperty("--cat", manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectHeatmapCategory(category));
    nav.appendChild(button);
  });
  // "All products" (the full cross-category super-heatmap) is an explicit
  // opt-in at the bottom of the list, not the default -- one category loads first.
  const allButton = document.createElement("button");
  allButton.className = "category-tab";
  if (heatmapState.category === "all") allButton.classList.add("active");
  allButton.textContent = "All products";
  allButton.dataset.category = "all";
  allButton.addEventListener("click", () => selectHeatmapCategory("all"));
  nav.appendChild(allButton);
}

function selectHeatmapCategory(category) {
  heatmapState.category = category;
  document.querySelectorAll("#heatmap-category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  renderHeatmap();
}

async function fetchHeatmapSeries(key) {
  return fetchTimeseriesJson(key);
}

function heatmapPairs(category, family) {
  const pairs = [];
  const cats = category === "all" ? manifest.category_order : [category];
  cats.forEach((cat) => {
    const products = manifest.categories[cat] || {};
    for (const [product, responses] of Object.entries(products)) {
      // Point-observation networks are multisite point averages, not gridded
      // area means -- never a heatmap row (see POINT_NETWORK_PRODUCTS, common.js).
      if (POINT_NETWORK_PRODUCTS.has(product)) continue;
      for (const [response, entry] of Object.entries(responses)) {
        // The water-year families read each stored per-month sigma directly --
        // no aggregation involved, so they're fine even for products (e.g. NEON
        // NEE) with no established multi-month aggregation rule. Every other
        // family aggregates across a season/month window via
        // computeWindowValue(), same as js/summary.js -- exclude those
        // products here too, for the same reason summary.js does (see its
        // own "no established aggregation rule" comment).
        if (!family.startsWith("wy_") && !entry.aggregation) continue;
        pairs.push({ product, response, category: cat });
      }
    }
  });
  return pairs;
}

async function renderHeatmap() {
  const chart = document.getElementById("heatmap-chart");
  const titleEl = document.getElementById("heatmap-title");
  if (titleEl) {
    const cat = heatmapState.category === "all" ? "All products" : categoryLabelWithIcon(heatmapState.category);
    const fam = HEATMAP_FAMILIES[heatmapState.family];
    const when = fam ? ` — ${fam.label}` : "";
    titleEl.textContent = `${cat}${when} — ${regionLabelFor(heatmapState.region)}`;
  }
  const pairs = heatmapPairs(heatmapState.category, heatmapState.family);
  if (pairs.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No products in this category.</p>';
    return;
  }
  chart.innerHTML = '<p class="chart-empty">Computing…</p>';
  try {
    await renderHeatmapUnsafe(chart, pairs);
  } catch (err) {
    chart.innerHTML = '<p class="chart-empty">Could not render this heatmap. Try a different selection.</p>';
    console.error("renderHeatmap failed:", err);
  }
}

async function renderHeatmapUnsafe(chart, pairs) {
  // Fetch every product's JSON concurrently instead of one at a time --
  // "All products" is ~100 items, and awaiting each fetch in turn meant a
  // full re-render waited on ~100 sequential network round-trips
  // (fetchHeatmapSeries' own cache still applies per key either way).
  const dataList = await Promise.all(
    pairs.map(({ product, response }) => fetchHeatmapSeries(`${product}_${response}`))
  );

  let xLabels, computeRow;
  if (heatmapState.family.startsWith("wy_")) {
    const wy = HEATMAP_FAMILIES[heatmapState.family].waterYear;
    // One water year: Oct (wy-1) through Sep (wy).
    const months = [];
    for (let m = WATER_YEAR_START_MONTH; m <= 12; m++) months.push({ year: wy - 1, month: m });
    for (let m = 1; m < WATER_YEAR_START_MONTH; m++) months.push({ year: wy, month: m });
    // Two-row tick label (month above, year below) instead of one rotated
    // "Jan 2026" string -- easier to read at the narrow per-column width a
    // 12-column heatmap has, and each column here really is its own
    // distinct real month/year (unlike the seasonal chart's shared axis).
    xLabels = months.map(({ year, month }) => `${MONTH_NAMES[month - 1].slice(0, 3)}<br>${year}`);
    computeRow = (data) => {
      const region = data.regions[heatmapState.region];
      if (!region) return { z: months.map(() => null), hasData: false };
      // Flip sign so red always means "more stress" and blue always means
      // "less stress" on every row, regardless of each variable's own raw
      // sign convention (a positive temperature anomaly IS the stress
      // direction, but a positive snowpack anomaly is less stress, the opposite)
      // -- same drier_is_high-driven flip the Summary table applies; the Compare
      // view instead keeps σ native-direction (positive = above that variable's
      // own baseline, not necessarily stress), see about.html.
      const sign = data.drier_is_high ? 1 : -1;
      let hasData = false;
      const z = months.map(({ year, month }) => {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
        const idx = region.dates.indexOf(dateStr);
        if (idx === -1) return null;
        hasData = true; // the product has a value this month even if sigma is floored out
        const s = monthlyStressSigma(data, region, idx);
        return s === null ? null : sign * s;
      });
      return { z, hasData };
    };
  } else {
    const windowKey = HEATMAP_FAMILIES[heatmapState.family].window;
    const { minYear, maxYear } = fullRecordYearRange(); // already floored at DASHBOARD_MIN_YEAR
    const startYear = Math.max(minYear, heatmapState.startYear || minYear);
    const years = [];
    for (let y = startYear; y <= maxYear; y++) years.push(y);
    xLabels = years.map(String);
    computeRow = (data) => {
      const region = data.regions[heatmapState.region];
      if (!region) return { z: years.map(() => null), hasData: false };
      // Same stress-direction sign flip as the "monthly" branch above.
      const sign = data.drier_is_high ? 1 : -1;
      let hasData = false;
      const z = years.map((year) => {
        const result = computeWindowValue(data, region, windowKey, year);
        if (!result) return null;
        hasData = true; // the window has data even if its sigma is floored out
        return result.sigma === null ? null : sign * result.sigma;
      });
      return { z, hasData };
    };
  }

  const yLabels = [];
  const z = [];
  const rowCategories = [];
  // Plotly's categorical y-axis renders array index 0 at the BOTTOM, so
  // pushing category_order's own top-to-bottom sequence (snow/climate first,
  // drought last) unreversed put drought at the top and snow at the bottom
  // -- backwards. Reverse once here, same fix already used by the About
  // page's coverage chart for the same reason.
  [...pairs].reverse().forEach((pair, i) => {
    const data = dataList[pairs.length - 1 - i];
    const { z: row, hasData } = computeRow(data);
    // Keep a product that has data in the window but whose sigma is entirely
    // floored out (e.g. a <8-year record like TROPOMI, below MIN_BASELINE_
    // YEARS_SIGMA) -- render it as a gray no-sigma row rather than letting it
    // silently vanish. Drop only products genuinely absent from the selection.
    if (!hasData) return;
    yLabels.push(`${pair.product} ${pair.response}`);
    z.push(row);
    rowCategories.push(pair.category);
  });
  if (z.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No data for this selection.</p>';
    return;
  }

  // Fixed symmetric diverging range (not auto-scaled to the matrix max): a
  // cell's color then means the same z-score on every heatmap, and one genuine
  // extreme -- a real fire or soil-moisture record can run past +/-10 -- no
  // longer stretches the scale and washes every other cell to white. Values
  // beyond the bound saturate the end color; the true z is in the hover. (A
  // dormant/degenerate cell is no-data, not a spike -- see
  // common.js::DORMANT_SD_FRACTION.)
  const zAbs = 4;

  // In the combined "all products" view, separate the stacked category groups
  // with a black rule and label each section (rotated) on the right.
  const sepShapes = [];
  const catLabels = [];
  if (heatmapState.category === "all") {
    let runStart = 0;
    for (let i = 1; i <= rowCategories.length; i++) {
      if (i === rowCategories.length || rowCategories[i] !== rowCategories[runStart]) {
        catLabels.push({
          xref: "paper", x: 1.015, xanchor: "left", yref: "y", y: (runStart + i - 1) / 2, yanchor: "middle",
          text: categoryLabelWithIcon(rowCategories[runStart]), textangle: -90, showarrow: false,
          font: { size: 12, color: "#333", weight: 700 },
        });
        if (i < rowCategories.length) {
          sepShapes.push({
            type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: i - 0.5, y1: i - 0.5,
            line: { color: "#1b1b1b", width: 1.5 },
          });
        }
        runStart = i;
      }
    }
  }

  const trace = {
    x: xLabels, y: yLabels, z, type: "heatmap",
    // NCL MPL_BrBG reversed: teal (less stress) low -> brown (more stress) high,
    // with pure white pinned at zero (the MPL_ table is off-white there). Cells
    // past +/-zAbs take the end colors, so the end ticks read "<=" / ">=".
    colorscale: heatmapColorscale(),
    zmin: -zAbs, zmax: zAbs, zmid: 0,
    // Horizontal colorbar ABOVE the heatmap (the matrix can be tall, and a
    // right-side vertical bar forced scrolling to see its low end).
    colorbar: {
      orientation: "h",
      x: 0.5, xanchor: "center",
      y: 1.04, yanchor: "bottom",
      len: 0.55, thickness: 16,
      tickmode: "array",
      tickvals: sigmaTicks(zAbs),
      ticktext: sigmaTicks(zAbs).map((v) => (v === -zAbs ? `≤−${zAbs}` : v === zAbs ? `≥+${zAbs}`
        : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")),
      tickfont: { size: 12 },
      title: { text: "← Less stress · Standardized anomaly (σ) · More stress →", side: "top", font: { size: 13 } },
    },
    hoverongaps: false,
  };
  const layout = {
    margin: { t: 90, r: heatmapState.category === "all" ? 48 : 20, b: 60, l: 180 },
    // Gray fills the plot behind the cells, so a missing (null) cell reads as
    // gray "no data" instead of falling through to white -- which the diverging
    // scale also uses for a neutral sigma=0, a dangerous look-alike on a drought
    // heatmap. hoverongaps:false keeps gaps non-interactive.
    plot_bgcolor: "#c8c8c8",
    xaxis: { side: "bottom", tickangle: 0 },
    yaxis: { automargin: true },
    font: { family: "Source Sans Pro, sans-serif", size: 12 },
    height: Math.max(430, yLabels.length * 22 + 170),
    shapes: sepShapes,
    annotations: catLabels,
  };
  // Column count ranges from 12 (monthly) to 35+ (a full-record yearly
  // window) -- Plotly's own responsive:true would otherwise shrink every
  // column down to fit whatever narrow viewport it's given, squeezing a
  // wide heatmap illegible on mobile. Force a real per-column width and let
  // .heatmap-chart-scroll (css/style.css) handle the horizontal scroll
  // instead, same as the Summary Table's own too-wide-for-mobile table.
  // On phones let the heatmap fit the viewport so its colorbar stays on-screen,
  // rather than forcing a wide horizontal scroll that pushes the sigma scale off
  // the right edge (it reappears as a stray navy sliver otherwise).
  const isNarrow = typeof window !== "undefined" && window.innerWidth < 600;
  chart.style.minWidth = isNarrow ? "0" : `${Math.max(600, xLabels.length * 45 + 220)}px`;
  // Plotly.newPlot() appends its own plot div into `chart` but doesn't touch
  // pre-existing sibling elements -- the "Computing..." <p> set above the
  // fetch would otherwise sit there forever, untouched, next to the finished
  // chart. Clear it explicitly first.
  chart.innerHTML = "";
  Plotly.newPlot(chart, [trace], layout, { responsive: true, displaylogo: false });
}

loadManifest().then(initHeatmaps);

// Heatmap colorscale: NCL MPL_BrBG reversed (teal low = less stress, brown high
// = more stress) with pure white at the midpoint.
function heatmapColorscale() {
  const colors = NCL_COLORMAPS.diverging.MPL_BrBG.colors.slice().reverse();
  if (colors.length % 2 === 0) throw new Error("heatmapColorscale needs an odd number of stops to center white");
  colors[(colors.length - 1) / 2] = "#ffffff";
  return colors.map((color, i) => [i / (colors.length - 1), color]);
}

// One colorbar tick per whole sigma across the fixed symmetric range.
function sigmaTicks(zAbs) {
  const ticks = [];
  for (let v = -zAbs; v <= zAbs; v++) ticks.push(v);
  return ticks;
}

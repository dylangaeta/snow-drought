// Summary Table page (data.html). Computed entirely client-side from the
// same monthly mean-centered anomaly arrays the Time Series page uses -- no
// new statistics invented here. Each response's multi-month aggregation
// rule (sum / mean / day_weighted_mean / native_index) comes from
// code/dashboard_export.py's AGGREGATION_RULE, audited against each
// product's actual reducer/analyzer code, not guessed. "More vs less stress"
// coloring uses drier_is_high, straight from config.py's own
// response_drier_is_high() -- the same function the canonical multi-product
// heatmap uses -- not a locally invented sign convention.

const summaryState = {
  window: "DJFM", year: 2026, valueType: "sigma", regionGroup: "summary",
};
let summaryRegionColumns = []; // [{code, label}], rebuilt whenever regionGroup changes

async function fetchSummaryData(product, response) {
  return fetchTimeseriesJson(`${product}_${response}`);
}

function regionColumnsForGroup(group) {
  if (group === "states") return manifest.western_states.map((code) => ({ code, label: code }));
  if (group === "huc2") return manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] }));
  return regionEntries(); // "Regions": Western US, CO-UT-WY, and whatever else manifest.region_labels has
}

function rebuildRegionColumns() {
  summaryRegionColumns = regionColumnsForGroup(summaryState.regionGroup);
  const headerRow = document.getElementById("summary-table-header");
  while (headerRow.children.length > 2) headerRow.removeChild(headerRow.lastChild); // keep Variable/Product
  summaryRegionColumns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
}

// fullRecordYearRange() now lives in js/common.js -- shared with heatmaps.js.

function initSummaryTable() {
  const windowSelect = document.getElementById("summary-window-select");
  if (!windowSelect) return;
  SEASON_ORDER.forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${key} (${SEASON_LABELS[key]})`;
    windowSelect.appendChild(option);
  });
  MONTH_NAMES.forEach((name, i) => {
    const option = document.createElement("option");
    option.value = String(i + 1).padStart(2, "0");
    option.textContent = name;
    windowSelect.appendChild(option);
  });
  windowSelect.value = summaryState.window;

  windowSelect.addEventListener("change", (event) => {
    summaryState.window = event.target.value;
    renderSummaryTable();
  });

  const yearSelect = document.getElementById("summary-year-select");
  const { minYear, maxYear } = fullRecordYearRange();
  for (let year = maxYear; year >= minYear; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }
  // Default to the latest year present rather than a hardcoded one, so the
  // view doesn't go stale as the record advances.
  summaryState.year = maxYear;
  yearSelect.value = String(summaryState.year);
  yearSelect.addEventListener("change", (event) => {
    summaryState.year = parseInt(event.target.value, 10);
    renderSummaryTable();
  });

  const valueSelect = document.getElementById("summary-value-select");
  const localGlossary = {
    anomaly_raw: "The departure from the baseline mean in the variable's own physical units (not standardized) -- the window value minus its baseline-mean normal.",
  };
  const updateValueGlossary = () => {
    // The table's σ is the window σ (computeWindowValue), not the stored chart σ.
    const glossaryKey = valueSelect.value === "sigma" ? "sigma_window" : valueSelect.value;
    document.getElementById("summary-value-glossary").textContent =
      (manifest.value_type_glossary || {})[glossaryKey] || localGlossary[valueSelect.value] || "";
  };
  valueSelect.addEventListener("change", (event) => {
    summaryState.valueType = event.target.value;
    updateValueGlossary();
    renderSummaryTable();
  });
  updateValueGlossary();

  document.getElementById("summary-region-group-select").addEventListener("change", (event) => {
    summaryState.regionGroup = event.target.value;
    rebuildRegionColumns();
    renderSummaryTable();
  });
  rebuildRegionColumns();

  renderSummaryTable();
}

function formatSummaryValue(result, units, valueType, data) {
  const sign = result.sigma >= 0 ? "+" : "";
  // Raw value + raw-unit anomaly display in the canonical unit (e.g. kg m-2 -> mm).
  const factor = canonicalUnitFactor(units);
  const dispUnits = windowUnits(data, summaryState.window);
  if (valueType === "raw") return `${(result.rawValue * factor).toFixed(2)} ${dispUnits}`;
  if (valueType === "anomaly_raw") {
    if (result.anomaly === null || result.isNativeIndex) return "&mdash;";
    const anom = result.anomaly * factor;
    return `${anom >= 0 ? "+" : ""}${anom.toFixed(2)} ${dispUnits}`;
  }
  if (valueType === "percentile") {
    const percentile = result.isNativeIndex ? nativeIndexPercentile(result.sigma) : result.percentile;
    return sigmaToPercentileLabel(percentile);
  }
  if (valueType === "percent_of_normal") {
    // Gated by the pipeline's pct_of_normal_ok flag (a non-negative physical
    // amount, not a thermal/interval-scale quantity or a native standardized
    // index), same as the shared regional tables in common.js.
    if (!data.pct_of_normal_ok || result.percentOfNormal === null) return "&mdash;";
    return `${result.percentOfNormal.toFixed(0)}%`;
  }
  if (valueType === "rank") {
    if (result.stressRank === null || result.nRecord === null) return "&mdash;";
    return `${Math.round(result.stressRank)}/${result.nRecord}`;
  }
  if (result.sigma === null) return "&mdash;"; // short-record product: baseline too short for a sigma (see MIN_BASELINE_YEARS_SIGMA)
  return `${sign}${result.sigma.toFixed(1)}`; // "sigma" default
}

async function renderSummaryTable() {
  const body = document.getElementById("summary-table-body");
  const colCount = 2 + summaryRegionColumns.length;
  body.innerHTML = `<tr><td colspan="${colCount}">Computing&hellip;</td></tr>`;

  // Fetch every product's JSON concurrently instead of one at a time -- the
  // full table is ~100 products, and awaiting each fetch in turn meant the
  // table waited on ~100 sequential network round-trips before rendering
  // anything (fetchSummaryData's own cache still applies per key, so a
  // repeat render of the same window/year is unaffected either way).
  const toFetch = [];
  for (const category of manifest.category_order) {
    const products = manifest.categories[category];
    for (const [product, responses] of Object.entries(products)) {
      // Point-observation networks are multisite point averages, not gridded
      // area means -- excluded from the regional summary table (see
      // POINT_NETWORK_PRODUCTS, common.js); they live on the Sites/SNOTEL pages.
      if (POINT_NETWORK_PRODUCTS.has(product)) continue;
      for (const [response, entry] of Object.entries(responses)) {
        if (!entry.aggregation) continue; // no established aggregation rule (e.g. NEON NEE) -- excluded, not guessed
        toFetch.push({ category, product, response, entry });
      }
    }
  }
  const dataList = await Promise.all(toFetch.map((item) => fetchSummaryData(item.product, item.response)));

  const rowsByCategory = {};
  toFetch.forEach((item, i) => {
    const data = dataList[i];
    const cells = summaryRegionColumns.map((col) => {
      const region = data.regions[col.code];
      if (!region) return null;
      return computeWindowValue(data, region, summaryState.window, summaryState.year);
    });
    if (cells.every((cell) => cell === null)) return;
    (rowsByCategory[item.category] = rowsByCategory[item.category] || []).push({
      product: item.product, response: item.response, cells, data,
    });
  });

  body.innerHTML = "";
  let anyRows = false;
  manifest.category_order.forEach((category) => {
    const rows = rowsByCategory[category];
    if (!rows || rows.length === 0) return;
    anyRows = true;
    const groupRow = document.createElement("tr");
    groupRow.className = "group-row";
    groupRow.innerHTML = `<td colspan="${colCount}">${categoryLabelWithIcon(category)}</td>`;
    body.appendChild(groupRow);
    rows.forEach((row) => {
      const data = row.data;
      let note = "";
      if (row.cells.some((cell) => cell && cell.isNativeIndex)) {
        if (SEASON_MONTHS[summaryState.window]) {
          const lastMonth = SEASON_MONTHS[summaryState.window].slice(-1)[0];
          note = ` (native index, as of ${MONTH_NAMES[lastMonth - 1]})`;
        } else {
          note = " (native index)";
        }
      }
      const cellsHtml = row.cells.map((result) => {
        if (!result) return "<td>&mdash;</td>";
        // Short-record products carry sigma === null (baseline < MIN_BASELINE_YEARS_SIGMA);
        // leave those cells uncolored rather than defaulting them to the low-stress hue.
        const cls = result.sigma === null ? ""
          : (data.drier_is_high ? result.sigma > 0 : result.sigma < 0) ? "stress" : "relief";
        const text = formatSummaryValue(result, data.units, summaryState.valueType, data);
        return `<td class="${cls}">${text}</td>`;
      }).join("");
      const tr = document.createElement("tr");
      const responseCell = data.glossary
        ? `<td title="${data.glossary.replace(/"/g, "&quot;")}">${responseDisplay(row.response)}${note}</td>`
        : `<td>${responseDisplay(row.response)}${note}</td>`;
      tr.innerHTML = `${responseCell}<td>${row.product}</td>${cellsHtml}`;
      body.appendChild(tr);
    });
  });
  if (!anyRows) {
    body.innerHTML = `<tr><td class="no-data-cell" colspan="${colCount}">No data for this window/year.</td></tr>`;
  }
}

loadManifest().then(initSummaryTable);

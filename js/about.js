// About page. Value-type glossary list and the observational-coverage
// timeline both come straight from manifest.json -- no new data needed.

// Friendly display labels for the value-type keys -- the manifest carries
// snake_case codes (percent_of_normal, anomaly_raw, ...) that should not be
// shown raw to a reader. Unmapped keys fall back to a de-underscored form.
const VALUE_TYPE_LABELS = {
  sigma: "Standardized anomaly (σ), charts", sigma_window: "Standardized anomaly (σ), tables and heatmaps",
  anomaly_raw: "Raw-unit anomaly",
  percent_of_normal: "Percent of mean", percentile: "Percentile",
  rank: "Driest/wettest rank", raw: "Raw value",
};

function renderValueTypeGlossary() {
  const list = document.getElementById("value-type-list");
  // Merge in representations the Summary Table adds client-side but the
  // manifest glossary doesn't carry yet (keeps this list in sync with the
  // actual Summary Table dropdown). anomaly_raw wording mirrors js/summary.js.
  const glossary = {
    ...(manifest.value_type_glossary || {}),
    anomaly_raw: "The departure from the baseline mean in the variable's own physical units (not standardized) -- the window value minus its baseline-mean normal.",
  };
  Object.entries(glossary).forEach(([key, text]) => {
    const li = document.createElement("li");
    const label = VALUE_TYPE_LABELS[key] || key.replace(/_/g, " ");
    li.innerHTML = `<strong>${label}</strong>: ${text}`;
    list.appendChild(li);
  });
}

// Observational coverage timeline -- built entirely from manifest.json's
// own record_start/record_end/status fields, no new data needed.
function renderCoverageChart() {
  const chart = document.getElementById("coverage-chart");
  if (!chart) return;

  const rows = [];
  manifest.category_order.forEach((category) => {
    const products = manifest.categories[category] || {};
    for (const [product, responses] of Object.entries(products)) {
      for (const [response, entry] of Object.entries(responses)) {
        if (!entry.record_start || !entry.record_end) continue;
        rows.push({ category, product, response, start: entry.record_start, end: entry.record_end, status: entry.status });
      }
    }
  });
  // Category order top-to-bottom on a Plotly categorical y-axis renders
  // bottom-to-top, so reverse once here rather than fighting axis options.
  rows.reverse();

  const traces = manifest.category_order.map((category) => {
    const catRows = rows.filter((r) => r.category === category);
    return {
      type: "bar", orientation: "h", name: categoryLabelWithIcon(category),
      y: catRows.map((r) => `${r.product} ${r.response}`),
      base: catRows.map((r) => r.start),
      x: catRows.map((r) => {
        const start = new Date(r.start).getTime();
        const end = new Date(r.end).getTime();
        return end - start;
      }),
      marker: { color: manifest.category_colors[category] },
      hovertext: catRows.map((r) => `${r.product} ${r.response}: ${r.start} to ${r.end} (${STATUS_LABELS[r.status] || r.status})`),
      hoverinfo: "text",
    };
  });

  // A couple of products (SPI/SPEI, nClimGrid-based) have a genuinely real
  // record back to 1895 -- accurate, not a bug -- but auto-scaling the
  // shared axis to fit them compresses every other product's actual
  // modern-era coverage into a sliver. Floor the visible window at 1990,
  // matching this site's own baseline-period start (see Methodology
  // above); the true earlier start is still correct in each bar's own data
  // and in its hover text, just off the left edge of the default view
  // rather than distorting the axis. Plotly silently ignores a range array
  // with a null endpoint, so the upper bound has to be a real value too --
  // computed from the data's own latest end date, not a hardcoded year.
  const latestEnd = rows.reduce((max, r) => (r.end > max ? r.end : max), rows[0].end);
  const layout = {
    margin: { t: 55, r: 20, b: 45, l: 180 },
    barmode: "stack",
    xaxis: { ...PLOTLY_AXIS_LINE, type: "date", title: "Record coverage", range: [`${DASHBOARD_MIN_YEAR}-01-01`, latestEnd] },
    yaxis: { ...PLOTLY_AXIS_LINE, automargin: true },
    font: { family: "Source Sans Pro, sans-serif", size: 12 },
    height: Math.max(400, rows.length * 16 + 100),
    // Anchor the legend flush above the plot top; a fractional y (e.g. 1.08)
    // floats it ~140px up on this very tall chart, leaving a big empty band.
    legend: { orientation: "h", y: 1, yanchor: "bottom" },
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

loadManifest().then(() => {
  renderValueTypeGlossary();
  renderCoverageChart();
});

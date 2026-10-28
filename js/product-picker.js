// Shared dataset/variable picker. Two linked dropdowns, Dataset and Variable,
// with a pivot toggle:
//   "By dataset"  -- the Dataset list is every dataset; the Variable list is the
//                    selected dataset's variables.
//   "By variable" -- the Variable list is every variable; the Dataset list is the
//                    datasets that offer the selected variable.
// Physical-domain categories are not a user-facing control here (they remain only
// on the summary heatmaps); they are kept internally solely to index into
// manifest.categories[category][product][response].
//
// createProductPicker(opts) builds ONE independent instance -- its own state,
// its own DOM elements, its own manifest index (optionally filtered). Pages that
// show a single product (Time Series, Seasonal Cycle, Gallery) use the
// initProductPicker wrapper below; Map builds an instance with a spatial-map-only
// filter and no region toggle; Compare builds two instances (panels A/B).
//
// opts:
//   ids: { pivot, product, response, meta?, region?, search?, searchResults? }
//        -- element ids this instance owns (pivot/product/response required).
//   filter(category, product, response) -> bool   -- default: keep all.
//   persist: bool        -- read/write the shared last-selection in localStorage.
//   seedFromUrl: bool    -- seed the initial selection from the URL hash.
//   defaultView: { category, product, response }  -- first-visit fallback.
//   onChange(entry, selection)  -- selection = { category, product, response, region }.

// Shared current selection for the single-product pages (Time Series, Seasonal
// Cycle, Gallery) that read it directly as `pickerState.{product,response,region}`.
// The initProductPicker wrapper keeps this in sync with its one instance;
// Map/Compare build their own createProductPicker instances and do not use it.
const pickerState = { pivot: "dataset", category: null, product: null, response: null, region: "ALL" };

// The manifest entry for the shared pickerState selection. Used by the pages
// that read pickerState directly (Gallery reads its figures off this).
function currentPickerEntry() {
  return manifest.categories[pickerState.category][pickerState.product][pickerState.response];
}

// Build the manifest-derived indexes, keeping only (category, product, response)
// triples the filter accepts. category_order's first-seen order is preserved.
function buildPickerIndexes(filter) {
  const datasetVariables = {};   // product  -> [response, ...]
  const variableDatasets = {};   // response -> [product, ...]
  const entryCategoryByPair = {}; // `${product} ${response}` -> category
  const variableCategory = {};    // response -> primary category (first in category_order)
  manifest.category_order.forEach((category) => {
    const products = manifest.categories[category] || {};
    Object.keys(products).forEach((product) => {
      // Point-observation networks are multisite point averages, not gridded
      // area means -- excluded from every picker-driven view (they live on the
      // Sites / SNOTEL pages instead). See POINT_NETWORK_PRODUCTS in common.js.
      if (POINT_NETWORK_PRODUCTS.has(product)) return;
      Object.keys(products[product]).forEach((response) => {
        if (filter && !filter(category, product, response)) return;
        (datasetVariables[product] = datasetVariables[product] || []).push(response);
        (variableDatasets[response] = variableDatasets[response] || []).push(product);
        entryCategoryByPair[product + " " + response] = category;
        if (!(response in variableCategory)) variableCategory[response] = category;
      });
    });
  });
  // A product/response can appear under several categories' blocks (e.g.
  // ERA5-Land has climate, soil-moisture and snow responses); de-duplicate
  // while keeping category_order's first-seen order.
  Object.keys(datasetVariables).forEach((p) => { datasetVariables[p] = Array.from(new Set(datasetVariables[p])); });
  Object.keys(variableDatasets).forEach((r) => { variableDatasets[r] = Array.from(new Set(variableDatasets[r])); });
  const allDatasets = Object.keys(datasetVariables).sort((a, b) => a.localeCompare(b));
  const allVariables = Object.keys(variableDatasets).sort((a, b) => a.localeCompare(b));
  return { datasetVariables, variableDatasets, entryCategoryByPair, variableCategory, allDatasets, allVariables };
}

function parseSharedPickerViewFromUrl() {
  if (!window.location.hash || window.location.hash.length < 2) return null;
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const view = Object.fromEntries(params.entries());
    return view.product && view.response ? view : null;
  } catch (err) {
    return null;
  }
}

function fillPickerSelect(select, options, value, displayFn) {
  select.innerHTML = "";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = displayFn ? displayFn(opt) : opt;
    select.appendChild(option);
  });
  select.value = value;
}

// Fill the Variable dropdown grouped into <optgroup>s by physical-domain
// category (snow, climate, ...), in manifest.category_order, each alphabetical
// within. The long "By variable" list is otherwise a flat alphabetical wall;
// grouping makes it scannable. Option values stay the bare response code.
function fillVariableSelect(select, options, value, variableCategory) {
  select.innerHTML = "";
  const order = manifest.category_order || [];
  const labels = manifest.category_labels || {};
  const byCat = {};
  options.forEach((code) => {
    const cat = variableCategory[code] || "other";
    (byCat[cat] = byCat[cat] || []).push(code);
  });
  const cats = [
    ...order.filter((cat) => byCat[cat]),
    ...Object.keys(byCat).filter((cat) => !order.includes(cat)),
  ];
  cats.forEach((cat) => {
    const group = document.createElement("optgroup");
    group.label = labels[cat] || cat;
    byCat[cat].sort((a, b) => a.localeCompare(b)).forEach((code) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = responseDisplay(code);
      group.appendChild(option);
    });
    select.appendChild(group);
  });
  select.value = value;
}

function createProductPicker(opts) {
  const ids = opts.ids;
  const datasetSelect = document.getElementById(ids.product);
  const variableSelect = document.getElementById(ids.response);
  if (!datasetSelect || !variableSelect) return null;
  const pivotEl = ids.pivot ? document.getElementById(ids.pivot) : null;
  const metaEl = ids.meta ? document.getElementById(ids.meta) : null;
  const regionEl = ids.region ? document.getElementById(ids.region) : null;

  const index = buildPickerIndexes(opts.filter);
  const { datasetVariables, variableDatasets, entryCategoryByPair, variableCategory, allDatasets, allVariables } = index;
  const state = { pivot: "dataset", category: null, product: null, response: null, region: "ALL" };

  function currentEntry() {
    const category = entryCategoryByPair[state.product + " " + state.response];
    return manifest.categories[category][state.product][state.response];
  }

  function renderSelects() {
    if (state.pivot === "dataset") {
      fillPickerSelect(datasetSelect, allDatasets, state.product);
      fillVariableSelect(variableSelect, datasetVariables[state.product], state.response, variableCategory);
    } else {
      fillVariableSelect(variableSelect, allVariables, state.response, variableCategory);
      fillPickerSelect(datasetSelect, variableDatasets[state.response], state.product);
    }
  }

  function settle() {
    state.category = entryCategoryByPair[state.product + " " + state.response];
    const entry = currentEntry();
    if (metaEl) metaEl.innerHTML = productMetaHtml(entry);
    if (opts.persist) saveLastSelection(state.category, state.product, state.response);
    opts.onChange(entry, { category: state.category, product: state.product, response: state.response, region: state.region });
  }

  function renderPivot() {
    if (!pivotEl) return;
    pivotEl.innerHTML = "";
    [["dataset", "Dataset"], ["variable", "Variable"]].forEach(([mode, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-pivot-btn";
      button.textContent = label;
      button.dataset.pivot = mode;
      button.classList.toggle("active", mode === state.pivot);
      button.addEventListener("click", () => {
        if (state.pivot === mode) return;
        state.pivot = mode;
        pivotEl.querySelectorAll(".picker-pivot-btn").forEach((b) => b.classList.toggle("active", b.dataset.pivot === mode));
        renderSelects();
        settle();
      });
      pivotEl.appendChild(button);
    });
  }

  function wire() {
    datasetSelect.addEventListener("change", (event) => {
      state.product = event.target.value;
      // By dataset, the variable list changes with the dataset -- keep the current
      // variable if the new dataset offers it, else fall back to its first. By
      // variable, the dataset list was already filtered to datasets offering the
      // current variable, so the variable stays valid.
      if (state.pivot === "dataset") {
        const vars = datasetVariables[state.product];
        if (!vars.includes(state.response)) state.response = vars[0];
      }
      renderSelects();
      settle();
    });
    variableSelect.addEventListener("change", (event) => {
      state.response = event.target.value;
      if (state.pivot === "variable") {
        const datasets = variableDatasets[state.response];
        if (!datasets.includes(state.product)) state.product = datasets[0];
      }
      renderSelects();
      settle();
    });
    if (regionEl) {
      regionEl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-region]");
        if (!button) return;
        state.region = button.dataset.region;
        regionEl.querySelectorAll("button[data-region]").forEach((btn) => btn.classList.toggle("active", btn === button));
        opts.onChange(currentEntry(), { category: state.category, product: state.product, response: state.response, region: state.region });
      });
    }
    if (ids.search) {
      wireProductSearch(ids.search, ids.searchResults, (category, product, response) => {
        // The search index can yield a triple this instance's filter excludes
        // (e.g. a site product on the Map); ignore those rather than crash.
        if (!datasetVariables[product] || !datasetVariables[product].includes(response)) return;
        state.product = product;
        state.response = response;
        renderSelects();
        settle();
      });
    }
  }

  function seedSelection() {
    const urlView = opts.seedFromUrl ? parseSharedPickerViewFromUrl() : null;
    const remembered = opts.persist && !urlView ? loadLastSelection() : null;
    const seed = urlView || remembered || opts.defaultView || {};
    state.product = allDatasets.includes(seed.product) ? seed.product : allDatasets[0];
    const vars = datasetVariables[state.product];
    state.response = vars.includes(seed.response) ? seed.response : vars[0];
    if (seed.region) state.region = seed.region;
  }

  function init() {
    if (regionEl) populateRegionToggle(regionEl, state.region);
    seedSelection();
    renderPivot();
    renderSelects();
    wire();
    if (regionEl) activateRegionButton(regionEl, state.region);
    settle();
  }

  // Drive the selection programmatically (e.g. Map re-applying a shared-view
  // URL hash on hashchange, or a page syncing one panel to another). Ignores a
  // product this instance's filter excludes; snaps the variable to one the
  // product offers. Runs onChange via settle(), exactly like a user click.
  function select(product, response) {
    if (!datasetVariables[product]) return;
    state.product = product;
    if (response && datasetVariables[product].includes(response)) state.response = response;
    else if (!datasetVariables[product].includes(state.response)) state.response = datasetVariables[product][0];
    renderSelects();
    settle();
  }

  return {
    init, select,
    getSelection: () => ({ category: state.category, product: state.product, response: state.response, region: state.region, entry: currentEntry() }),
  };
}

// First-ever visit (no shared-view hash, no remembered selection) opens on 2 m
// air temperature -- the most immediately legible variable, matching the Map
// page's own default -- rather than whatever dataset happens to sort first.
const DEFAULT_PICKER_VIEW = { category: "climate", product: "ERA5-Land", response: "T2m" };

// Thin single-instance wrapper for the one-product-at-a-time pages (Time Series,
// Seasonal Cycle, Gallery): all datasets, region toggle, metadata, search, the
// shared last-selection memory, and URL-hash seeding.
function initProductPicker(onSelectionChanged) {
  const picker = createProductPicker({
    ids: {
      pivot: "picker-pivot", product: "product-select", response: "response-select",
      meta: "product-meta", region: "region-toggle",
      search: "product-search", searchResults: "product-search-results",
    },
    persist: true,
    seedFromUrl: true,
    defaultView: DEFAULT_PICKER_VIEW,
    onChange: (entry, selection) => {
      // Keep the shared pickerState in sync for the pages that read it directly.
      pickerState.category = selection.category;
      pickerState.product = selection.product;
      pickerState.response = selection.response;
      pickerState.region = selection.region;
      onSelectionChanged(entry);
    },
  });
  if (picker) picker.init();
  return picker;
}

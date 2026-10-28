// Figure Gallery page: browse/download the pipeline's own pre-rendered
// static PNGs (code/dashboard_export.py's figures/maps/ and figures/
// heatmaps/), not the client-computed interactive charts every other page
// uses. Every path comes straight from the manifest -- entry.maps[period]
// for static maps, manifest.heatmaps for static heatmaps -- nothing is
// guessed or hardcoded.

// Every static figure image on this page can be clicked to fill the screen
// -- same Fullscreen API map.html's own "Full screen" button already uses,
// just triggered directly on the image instead of a separate button (Dylan,
// 2026-09-29: "the user should be able to click on any figure and have it
// magnify to full screen").
const GALLERY_IMAGE_IDS = ["gallery-map-img", "gallery-timeseries-img", "gallery-seasonal-img", "gallery-heatmap-img"];
function wireGalleryImageFullscreen() {
  GALLERY_IMAGE_IDS.forEach((id) => {
    const img = document.getElementById(id);
    img.classList.add("gallery-figure-zoomable");
    img.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        img.requestFullscreen();
      }
    });
  });
}

function galleryFigureLabel(key) {
  if (key === "baseline") return "Climatology";
  const match = key.match(/^(raw|anomaly)_(\d{4})$/);
  if (match) return `${match[1] === "raw" ? "Raw value" : "Anomaly"}, ${match[2]}`;
  return key;
}

// Rebuilding a <select>'s options (e.g. switching product) always reset it
// back to the first option, even when the previously-chosen value was still
// one of the new options -- confirmed live: pick DJFM, pick Anomaly 2026,
// pick a different season, and both the region AND figure choice silently
// jumped back to their defaults. Preserve the current value across a
// rebuild whenever it's still a valid option; only fall back to the first
// one when it genuinely isn't (e.g. that year doesn't exist for this
// product). `entries` is an array of [value, label] pairs.
function repopulateGallerySelect(select, entries) {
  const previous = select.value;
  select.innerHTML = "";
  entries.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  if (entries.some(([value]) => value === previous)) {
    select.value = previous;
  }
  return select.value;
}

function populateGalleryPeriodSelect(entry) {
  const select = document.getElementById("gallery-period-select");
  const periods = sortedPeriods(Object.keys(entry.maps || {}));
  repopulateGallerySelect(select, periods.map((p) => [p, periodLabel(p)]));
  return periods;
}

function populateGalleryFigureSelect(entry, period) {
  const select = document.getElementById("gallery-figure-select");
  const slot = (entry.maps || {})[period] || {};
  // baseline first, then raw/anomaly years oldest to newest -- reads as a
  // natural progression, not the arbitrary key-insertion order of the JSON.
  const keys = Object.keys(slot).sort((a, b) => {
    if (a === "baseline") return -1;
    if (b === "baseline") return 1;
    return a.localeCompare(b);
  });
  repopulateGallerySelect(select, keys.map((k) => [k, galleryFigureLabel(k)]));
  return { slot, keys };
}

function renderGalleryMap(entry) {
  const wrap = document.getElementById("gallery-map-wrap");
  const empty = document.getElementById("gallery-map-empty");
  const period = document.getElementById("gallery-period-select").value;
  const figureKey = document.getElementById("gallery-figure-select").value;
  const slot = (entry.maps || {})[period] || {};
  const relPath = slot[figureKey];
  if (!relPath) {
    wrap.style.display = "none";
    empty.style.display = "block";
    return;
  }
  wrap.style.display = "";
  empty.style.display = "none";
  const url = assetUrl(`figures/maps/${relPath}`);
  const img = document.getElementById("gallery-map-img");
  // A manifested figure can still 404 on R2; fall back to the empty state
  // rather than leaving a broken-image icon.
  img.onerror = () => { wrap.style.display = "none"; empty.style.display = "block"; };
  img.src = url;
  img.alt = `${pickerState.product} ${pickerState.response}, ${galleryFigureLabel(figureKey)}, ${document.getElementById("gallery-period-select").selectedOptions[0].textContent}`;
  const download = document.getElementById("gallery-map-download");
  download.href = url;
  download.setAttribute("download", relPath.split("/").pop());
}

function onGallerySelectionChanged(entry) {
  const periods = populateGalleryPeriodSelect(entry);
  if (periods.length === 0) {
    document.getElementById("gallery-map-wrap").style.display = "none";
    document.getElementById("gallery-map-empty").style.display = "block";
    document.getElementById("gallery-figure-select").innerHTML = "";
  } else {
    const currentPeriod = document.getElementById("gallery-period-select").value;
    populateGalleryFigureSelect(entry, currentPeriod);
    renderGalleryMap(entry);
  }
  onGalleryRegionFiguresChanged(entry.timeseries_figures || {}, TIMESERIES_GALLERY_IDS);
  onGalleryRegionFiguresChanged(entry.seasonal_figures || {}, SEASONAL_GALLERY_IDS);
}

function wireGalleryMapControls() {
  document.getElementById("gallery-period-select").addEventListener("change", (event) => {
    const entry = currentPickerEntry();
    populateGalleryFigureSelect(entry, event.target.value);
    renderGalleryMap(entry);
  });
  document.getElementById("gallery-figure-select").addEventListener("change", () => {
    renderGalleryMap(currentPickerEntry());
  });
}

// ------------------------------------------------ Time series / seasonal
// Same shape for both: a PNG per region (WesternUS/COUTWY), classified into
// raw/anomaly (+ year for seasonal) -- entry.timeseries_figures/
// seasonal_figures come straight from 14_dashboard_export.py's
// _curate_timeseries_figures/_curate_seasonal_figures, nothing guessed here.

const TIMESERIES_GALLERY_IDS = {
  regionSelect: "gallery-timeseries-region-select", figureSelect: "gallery-timeseries-figure-select",
  wrap: "gallery-timeseries-wrap", empty: "gallery-timeseries-empty",
  img: "gallery-timeseries-img", download: "gallery-timeseries-download",
  figuresKey: "timeseries_figures", figDir: "timeseries",
};
const SEASONAL_GALLERY_IDS = {
  regionSelect: "gallery-seasonal-region-select", figureSelect: "gallery-seasonal-figure-select",
  wrap: "gallery-seasonal-wrap", empty: "gallery-seasonal-empty",
  img: "gallery-seasonal-img", download: "gallery-seasonal-download",
  figuresKey: "seasonal_figures", figDir: "seasonal",
};

function galleryRegionFigureLabel(key) {
  const match = key.match(/^(raw|anomaly)(?:_(\d{4}))?$/);
  if (!match) return key;
  const prefix = match[1] === "raw" ? "Raw value" : "Anomaly";
  return match[2] ? `${prefix}, ${match[2]}` : prefix;
}

function populateGalleryRegionSelect(ids, figuresByRegion) {
  const select = document.getElementById(ids.regionSelect);
  // "ALL" (Western US) first, matching every other region picker on this
  // site, then whatever else exists (only ALL/CO_UT_WY today) alphabetically.
  const regions = Object.keys(figuresByRegion).sort((a, b) => {
    if (a === "ALL") return -1;
    if (b === "ALL") return 1;
    return a.localeCompare(b);
  });
  repopulateGallerySelect(select, regions.map((code) => [code, manifest.region_labels[code] || code]));
  return regions;
}

function populateGalleryRegionFigureSelect(ids, slot) {
  const select = document.getElementById(ids.figureSelect);
  // Raw before anomaly, undated before dated, then chronological.
  const keys = Object.keys(slot).sort((a, b) => {
    const rank = (k) => (k.startsWith("raw") ? 0 : 1);
    return rank(a) !== rank(b) ? rank(a) - rank(b) : a.localeCompare(b);
  });
  repopulateGallerySelect(select, keys.map((k) => [k, galleryRegionFigureLabel(k)]));
  return keys;
}

function renderGalleryRegionFigure(ids, figuresByRegion) {
  const wrap = document.getElementById(ids.wrap);
  const empty = document.getElementById(ids.empty);
  const region = document.getElementById(ids.regionSelect).value;
  const figureKey = document.getElementById(ids.figureSelect).value;
  const relPath = (figuresByRegion[region] || {})[figureKey];
  if (!relPath) {
    wrap.style.display = "none";
    empty.style.display = "block";
    return;
  }
  wrap.style.display = "";
  empty.style.display = "none";
  const url = assetUrl(`figures/${ids.figDir}/${relPath}`);
  const img = document.getElementById(ids.img);
  img.onerror = () => { wrap.style.display = "none"; empty.style.display = "block"; };
  img.src = url;
  img.alt = `${pickerState.product} ${pickerState.response}, ${galleryRegionFigureLabel(figureKey)}, ${manifest.region_labels[region] || region}`;
  const download = document.getElementById(ids.download);
  download.href = url;
  download.setAttribute("download", relPath.split("/").pop());
}

function onGalleryRegionFiguresChanged(figuresByRegion, ids) {
  const regions = populateGalleryRegionSelect(ids, figuresByRegion);
  if (regions.length === 0) {
    document.getElementById(ids.wrap).style.display = "none";
    document.getElementById(ids.empty).style.display = "block";
    document.getElementById(ids.figureSelect).innerHTML = "";
    return;
  }
  const currentRegion = document.getElementById(ids.regionSelect).value;
  populateGalleryRegionFigureSelect(ids, figuresByRegion[currentRegion] || {});
  renderGalleryRegionFigure(ids, figuresByRegion);
}

function wireGalleryRegionFigureControls(ids) {
  const getFigures = () => currentPickerEntry()[ids.figuresKey] || {};
  document.getElementById(ids.regionSelect).addEventListener("change", () => {
    const figuresByRegion = getFigures();
    populateGalleryRegionFigureSelect(ids, figuresByRegion[document.getElementById(ids.regionSelect).value] || {});
    renderGalleryRegionFigure(ids, figuresByRegion);
  });
  document.getElementById(ids.figureSelect).addEventListener("change", () => {
    renderGalleryRegionFigure(ids, getFigures());
  });
}

// ------------------------------------------------------------- Heatmaps

function initGalleryHeatmaps() {
  const familySelect = document.getElementById("gallery-heatmap-family-select");
  Object.entries(manifest.heatmaps).forEach(([key, family]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = family.label;
    familySelect.appendChild(option);
  });
  familySelect.addEventListener("change", () => {
    populateGalleryHeatmapCategorySelect();
    renderGalleryHeatmap();
  });
  document.getElementById("gallery-heatmap-category-select").addEventListener("change", renderGalleryHeatmap);
  populateGalleryHeatmapCategorySelect();
  renderGalleryHeatmap();
}

function populateGalleryHeatmapCategorySelect() {
  const family = manifest.heatmaps[document.getElementById("gallery-heatmap-family-select").value];
  const select = document.getElementById("gallery-heatmap-category-select");
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All products";
  select.appendChild(allOption);
  manifest.category_order.forEach((category) => {
    if (!(category in family.categories)) return;
    const option = document.createElement("option");
    option.value = category;
    option.textContent = categoryLabelWithIcon(category);
    select.appendChild(option);
  });
}

function renderGalleryHeatmap() {
  const family = manifest.heatmaps[document.getElementById("gallery-heatmap-family-select").value];
  const category = document.getElementById("gallery-heatmap-category-select").value;
  const wrap = document.getElementById("gallery-heatmap-wrap");
  const empty = document.getElementById("gallery-heatmap-empty");
  const filename = (family.categories[category] || {}).all;
  if (!filename) {
    wrap.style.display = "none";
    empty.style.display = "block";
    return;
  }
  wrap.style.display = "";
  empty.style.display = "none";
  const url = assetUrl(`figures/heatmaps/${filename}`);
  const img = document.getElementById("gallery-heatmap-img");
  img.onerror = () => { wrap.style.display = "none"; empty.style.display = "block"; };
  img.src = url;
  img.alt = `${family.label}, ${category === "all" ? "all products" : manifest.category_labels[category]}`;
  const download = document.getElementById("gallery-heatmap-download");
  download.href = url;
  download.setAttribute("download", filename);
}

async function init() {
  await loadManifest();
  wireGalleryMapControls();
  wireGalleryRegionFigureControls(TIMESERIES_GALLERY_IDS);
  wireGalleryRegionFigureControls(SEASONAL_GALLERY_IDS);
  wireGalleryImageFullscreen();
  initProductPicker(onGallerySelectionChanged);
  initGalleryHeatmaps();
}

init();

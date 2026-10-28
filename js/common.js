// Shared across every page (index.html, map.html, explore.html, seasonal.html,
// compare.html, data.html, heatmaps.html, classification.html, about.html): the
// manifest fetch and the small set of constants/helpers every page needs.
// No page-specific state lives here.

// The two-tier nav (primary + secondary rows) collapses into one stacked
// toggled dropdown below 900px (see .nav-toggle/.site-nav.open in style.css)
// -- wires the hamburger button every page's header includes. A no-op if a
// page has no #nav-toggle.
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
});

// Full name for an abbreviated variable code, shown in parentheses after the
// code in the variable dropdowns and chart/map titles, e.g. "Et (transpiration)"
// -- disambiguates look-alikes like GLEAM's Et (transpiration) vs ET
// (evapotranspiration). Keyed by response code; codes absent here (notably the
// drought indices EDDI/SPI/SPEI/PDSI/ESI/ForDRI/VegDRI/USDM, which read fine
// abbreviated) render as the bare code. Names are product-agnostic per code.
const VARIABLE_FULL_NAME = {
  // snow / cryosphere
  SWE: "snow water equivalent", swe: "snow water equivalent", MONTHLY_SWE: "snow water equivalent",
  SNOW_DEPTH: "snow depth", MONTHLY_SNOW_DEPTH: "snow depth",
  SCA: "snow-covered area", SNOW_COVER: "snow cover", SNOWFALL: "snowfall", SNOWMELT: "snowmelt",
  CLEAR_FRACTION: "clear-sky fraction", CLOUD_FRACTION: "cloud fraction",
  // climate / temperature / evaporative demand
  E: "actual evaporation", ET: "evapotranspiration", Eb: "bare-soil evaporation",
  Ei: "interception loss", Ep: "potential evaporation", Es: "snow sublimation",
  Et: "transpiration", Ew: "open-water evaporation", TRANSP: "transpiration", S: "evaporative stress",
  T2m: "2 m air temperature", TAIR: "air temperature", TD2m: "2 m dewpoint", TDMEAN: "mean dewpoint",
  TMAX: "maximum temperature", TMEAN: "mean temperature", TMIN: "minimum temperature",
  VPD: "vapor pressure deficit", VPDMAX: "maximum vapor pressure deficit", VPDMIN: "minimum vapor pressure deficit",
  SURFACE_TEMP: "surface temperature",
  LST_DAY: "daytime land-surface temperature", LST_NIGHT: "nighttime land-surface temperature",
  LST_DAY_TERRA: "daytime land-surface temperature", LST_NIGHT_TERRA: "nighttime land-surface temperature",
  LST_DAY_AQUA: "daytime land-surface temperature", LST_NIGHT_AQUA: "nighttime land-surface temperature",
  SOIL_TEMP_L1: "soil temperature, layer 1", SOIL_TEMP_L2: "soil temperature, layer 2",
  SOIL_TEMP_L3: "soil temperature, layer 3", SOIL_TEMP_L4: "soil temperature, layer 4",
  // precipitation / runoff
  PPT: "precipitation", RAINFALL: "rainfall", RUNOFF: "runoff",
  SURFACE_RUNOFF: "surface runoff", SUBSURFACE_RUNOFF: "subsurface runoff",
  // soil moisture / water storage
  SM: "soil moisture",
  SMrz: "root-zone soil moisture", SMs: "surface soil moisture",
  ROOT_SM: "root-zone soil moisture", SURFACE_SM: "surface soil moisture",
  RTZSM: "root-zone soil moisture percentile", SFSM: "surface soil moisture percentile", GWS: "groundwater storage percentile",
  SOIL_MOISTURE: "column soil moisture", SOIL_MOISTURE_0_100: "soil moisture, 0-100 cm",
  SOIL_WATER: "soil water", CANOPY_WATER: "canopy water", TWSA: "terrestrial water storage anomaly",
  LSWI: "land-surface water index",
  // vegetation / carbon
  NDVI: "normalized difference vegetation index", EVI: "enhanced vegetation index",
  LAI: "leaf area index", GCC: "green chromatic coordinate", SIF: "solar-induced fluorescence",
  GPP: "gross primary productivity", NPP: "net primary productivity", NEE: "net ecosystem exchange",
  RECO: "ecosystem respiration", RH: "heterotrophic respiration",
  LAND_CARBON_EXCHANGE: "NBE incl. fire",
  VOD: "vegetation optical depth",
  // fire
  BI: "burning index", ERC: "energy release component", FM100: "100-hour fuel moisture",
  FM1000: "1000-hour fuel moisture", BURNED_AREA: "burned area", CARBON_EMISSIONS: "fire carbon emissions",
  FIRE: "fire carbon emissions",
};

// "CODE (full name)" for a response code, or the bare code when it has no mapped
// name (drought indices, or codes that are already a full word).
function responseDisplay(code) {
  const name = VARIABLE_FULL_NAME[code];
  return name ? `${code} (${name})` : code;
}

// Solid black axis border on every Plotly chart (Compare, Time Series,
// Seasonal Cycle) -- Plotly's own default draws no axis line at all, just
// gridlines, which read as an unstyled/default chart (Dylan, 2026-09-30:
// "this looks like an old Microsoft Excel plot"). mirror: true draws the
// matching line on the opposite (top/right) side too, so the plot area
// reads as a clean closed box, not just two bare edges.
const PLOTLY_AXIS_LINE = {
  showline: true, linecolor: "#1b1b1b", linewidth: 1, mirror: true,
  ticks: "outside", tickcolor: "#1b1b1b",
};

// A minor TICK MARK (not a gridline) at every calendar year, on top of
// whatever major ticks Plotly's own autotick picks for the labeled years
// (Dylan, 2026-09-30: "minor breaks are absolutely every calendar year",
// then "this is how it should look" against a reference matplotlib figure
// with no vertical gridlines at all, just a tick at every year) -- spread
// into any continuous (non-category) date xaxis alongside showgrid: false
// and PLOTLY_AXIS_LINE.
const PLOTLY_YEARLY_MINOR_TICKS = { minor: { dtick: "M12", ticks: "outside", ticklen: 4, showgrid: false } };

// One glyph per category, everywhere a category label renders (category
// tabs, category selects, table group rows, search results) -- Dylan,
// 2026-09: "text icons for each of the variable groups, like a leaf for
// photosynthesis." Keyed by manifest.category_order's own category ids, not
// guessed from the display label text.
// Written as \u{...} code point escapes, not literal characters -- some of
// these are outside the Basic Multilingual Plane (surrogate-pair territory)
// and got silently mangled as literal bytes through one editing pass.
const CATEGORY_ICONS = {
  snow: "\u{2744}", // snowflake
  climate: "\u{1F321}", // thermometer
  precipitation: "\u{1F327}", // cloud with rain
  soil_moisture: "\u{1F4A7}", // droplet
  vegetation: "\u{1F33F}", // herb (leaf)
  fire: "\u{1F525}", // fire
  drought: "\u{1F3DC}", // desert
};

function categoryLabelWithIcon(category) {
  const icon = CATEGORY_ICONS[category];
  return icon ? `${icon} ${manifest.category_labels[category]}` : manifest.category_labels[category];
}

// Hard floor across every page (Dylan, 2026-09): a handful of products
// (SPI/SPEI/PRISM-based) have a real record back to 1895, which compresses
// this whole dashboard's actual 1990-2026 baseline era into a sliver
// whenever a chart shares one axis/dropdown across many products. This mirrors
// the pipeline's EXTENDED_BASELINE_START_YEAR (1990, the anomaly-baseline
// start); it floors only the narrower DISPLAY window, applied on top of the
// already-exported data -- whose own export floor is the earlier
// SATELLITE_ERA_START_YEAR (1979), applied in dashboard_export.py. Not a bug if
// they diverge; would be a bug if this one ever floored BELOW 1979 (data that
// doesn't exist).
// A window whose baseline spread is below this fraction of the series' overall
// anomaly spread is climatologically dormant/absent (e.g. summer snow) and
// reads as no-data for z-score, matching the pipeline
// (common/detrend.py::DORMANT_SD_FRACTION). Genuine extremes against a
// real-variance baseline are untouched and keep their full, uncapped z.
const DORMANT_SD_FRACTION = 0.02;
// Off-season dormancy floor: a window whose baseline anomaly spread is below
// this fraction of the variable's seasonal amplitude (the spread of its 12
// climatological monthly raw means) is off-season/dormant for that quantity
// (e.g. summer snowpack, winter photosynthesis) and reads as no-data, matching
// the pipeline (common/detrend.py::SEASONAL_DORMANT_FRACTION). A spread-vs-
// spread ratio, so temperature (K or C) is never flagged.
const SEASONAL_DORMANT_FRACTION = 0.03;
const DASHBOARD_MIN_YEAR = 1990;

// Canonical display units. Physically-equivalent units reported by different
// products under different strings are normalized to one scale so a variable's
// datasets read on a common axis (and overlay correctly). Keyed on the native
// unit string, since the conversion is a property of the unit, not the product:
//  - water mass/depth -> mm water-equivalent depth (1 kg m-2 of water = 1 mm;
//    1 cm = 10 mm; 1 m (snow DEPTH length) = 1000 mm). Chosen over kg per Dylan.
//  - SIF spectral radiance per-micrometre -> per-nanometre (x1e-3), so OCO-2 /
//    GOSIF (per-µm) sit on the same scale as TROPOMI (per-nm).
// Deliberately NOT converted (no single physically-meaningful common scale was
// adopted): volumetric soil moisture (m3 m-3) stays its own group; ET energy
// flux (W m-2) is not latent-heat-converted to the water-flux products; and
// standardized/unitless quantities (sigma, percentile, %, index) are untouched.
// SiB4 SIF is now correctly labelled mW m-2 sr-1 nm-1 (was a watt-magnitude
// mislabel), so it lands in the per-nm SIF bucket alongside TROPOMI directly.
const UNIT_CONVERSIONS = {
  "kg m-2": { unit: "mm", factor: 1 },
  "cm": { unit: "mm", factor: 10 },
  "m": { unit: "mm", factor: 1000 },
  "mW m-2 sr-1 µm-1": { unit: "mW m-2 sr-1 nm-1", factor: 0.001 },
};
function canonicalUnit(unit) {
  const conversion = UNIT_CONVERSIONS[unit];
  return conversion ? conversion.unit : (unit || "");
}
function canonicalUnitFactor(unit) {
  const conversion = UNIT_CONVERSIONS[unit];
  return conversion ? conversion.factor : 1;
}
// Scale a raw value (or raw-unit anomaly) from its native unit into the
// canonical unit; null/undefined/non-finite pass through unchanged.
function toCanonicalValue(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  return value * canonicalUnitFactor(unit);
}

// Western US water year: Oct 1 - Sep 30, named for the calendar year it ends
// in (WY2026 = Oct 2025 - Sep 2026). One definition for the whole dashboard so
// every page frames "the water year" the same way.
const WATER_YEAR_START_MONTH = 10;
function waterYearOf(year, month) {
  return month >= WATER_YEAR_START_MONTH ? year + 1 : year;
}
// The most recent COMPLETE water year, anchored on the last complete calendar
// month -- today rounded back to the end of the previous month -- so a
// brand-new month that nothing has reported into yet never defines it.
function currentWaterYear() {
  const now = new Date();
  const lastCompleteMonth = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
  return waterYearOf(lastCompleteMonth.getFullYear(), lastCompleteMonth.getMonth() + 1);
}

// The year range spanning every product's actual record_start/record_end,
// floored at DASHBOARD_MIN_YEAR -- a handful of products (e.g. PRISM back to
// 1895) would otherwise push the range's start back nearly a century for a
// dropdown that's really about this dashboard's 1990-2026 baseline era. A
// product with a shorter record than that still just produces "--" rows/cells
// for years outside its own coverage. Shared across any page needing a
// dashboard-wide year range (Summary Table, Heatmap), not page-specific.
function fullRecordYearRange() {
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const products of Object.values(manifest.categories)) {
    for (const responses of Object.values(products)) {
      for (const entry of Object.values(responses)) {
        if (entry.record_start) minYear = Math.min(minYear, parseInt(entry.record_start.slice(0, 4), 10));
        if (entry.record_end) maxYear = Math.max(maxYear, parseInt(entry.record_end.slice(0, 4), 10));
      }
    }
  }
  return { minYear: Math.max(DASHBOARD_MIN_YEAR, minYear), maxYear };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SEASON_LABELS = {
  MAM: "Mar–May", JJA: "Jun–Aug", SON: "Sep–Nov",
  DJF: "Dec–Feb", NDJF: "Nov–Feb",
  DJFM: "Dec–Mar", AMJJ: "Apr–Jul",
  MAMJJAS: "Mar–Sep", ANNUAL: "Jan–Dec",
};
const SEASON_ORDER = ["NDJF", "DJFM", "DJF", "MAM", "AMJJ", "MAMJJAS", "JJA", "SON", "ANNUAL"];
// Mirrors config.py's MAP_SEASONAL_PERIODS -- do not diverge for any window
// also used by the interactive map's period select (built server-side from
// that same dict, see code/17_dashboard_cog_export.py's SEASON_MONTHS).
// MAMJJAS/ANNUAL are dashboard-only additions with no COG coverage yet --
// they work everywhere else (summary table, heatmaps, compare) because
// those are computed live from monthly timeseries JSON, not pre-rendered maps.
const SEASON_MONTHS = {
  MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11],
  DJF: [12, 1, 2], NDJF: [11, 12, 1, 2], DJFM: [12, 1, 2, 3], AMJJ: [4, 5, 6, 7],
  MAMJJAS: [3, 4, 5, 6, 7, 8, 9], ANNUAL: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

// Mirrors config.py's PRODUCT_OBSERVATION_KIND exactly -- do not diverge.
// Re-synced 2026-10-01 after this copy drifted from the Python source: 6
// real observation products (GBBEPx, SNOTEL, MODIS-Terra,
// MODIS-Aqua, VIIRS, AmeriFlux) were missing entirely, which made
// their Compare-view lines render dashed/"model" by default (a bare-object
// lookup miss is undefined, not "observation") -- confirmed live,
// 2026-09-30/10-01: "a whole bunch of these are not labeled right." Also
// dropped a stale "VHP" entry that isn't a real product in either dict.
// Drives solid (observation) vs dashed (model) line styling in the
// category-grouped overlay view, same convention as
// 11_combined_GroupOverlays_analyze.py's line_style().
const PRODUCT_OBSERVATION_KIND = {
  "ERA5-Land": "model", "GFED5": "observation", "GBBEPx": "observation",
  "GPCP": "observation", "GRACE-JPL-L3": "observation", "NLDAS-Mosaic": "model",
  "NLDAS-Noah": "model", "NLDAS-VIC": "model", "PRISM": "observation",
  "SiB4": "model", "UA-SWE-Monthly": "observation", "NSIDC-IMS": "observation",
  "SNOTEL": "observation", "SMAP": "observation", "SNODAS": "model",
  "gridMET-Fire": "model", "OCO-2": "observation", "PhenoCam": "observation",
  "SMOS": "observation", "CAMS": "model", "CarbonTracker": "model",
  "FluxSat": "model", "GOSIF": "model", "MiCASA": "model",
  "MODIS-Terra": "observation", "MODIS-Aqua": "observation",
  "TROPOMI": "observation", "SPI": "observation", "SPEI": "observation",
  "EDDI": "model", "PDSI": "model", "ForDRI": "model", "ESI": "observation",
  "VegDRI": "observation", "USDM": "observation", "VIIRS": "observation",
  "GRACE-L4": "model",
  "NEON": "observation", "AmeriFlux": "observation",
  "GLEAM": "model", "USDM-Extent": "observation",
};

// Point-observation networks (stations / eddy-covariance towers / cameras):
// their regional series is a MULTISITE AVERAGE of sparse point sites, NOT a
// spatially-gridded area mean, so they are excluded from every gridded-mean
// comparison view -- Time Series, Seasonal, Compare, Gallery, the cross-product
// Heatmap, and the Summary table (Dylan, 2026-10: "only spatially gridded means
// summed over area should be included"). They remain on their own point-network
// pages (Sites, SNOTEL), which read data/sites + data/snotel directly, not
// manifest.categories. Authoritative set = dashboard_export.py's SITE_NETWORKS
// (AmeriFlux/NEON/PhenoCam) plus SNOTEL (its own page); USDM-Extent is NOT here
// -- its D0-D4 are areal drought-extent fractions, a real area statistic.
const POINT_NETWORK_PRODUCTS = new Set(["SNOTEL", "AmeriFlux", "NEON", "PhenoCam"]);

// Mirrors config.py's COMBINED_GROWING_SEASON_MIN_AMPLITUDE_FRACTION. In the
// pipeline a calendar month is kept in the vegetation group overlay only where
// its baseline mean clears this fraction of the seasonal amplitude above the
// dormant trough -- otherwise a tiny winter absolute anomaly divided by a
// near-zero dormant-season spread explodes the standardized value. Kept for
// reference only: this dashboard's z-score window statistics guard the
// near-zero-SD case directly (return 0/blank) rather than an amplitude mask, so
// nothing client-side reads this constant today.
const COMBINED_GROWING_SEASON_MIN_AMPLITUDE_FRACTION = 0.15;

// ---------------------------------------------------------- Window statistics
//
// Shared season-window aggregation + non-parametric standardization, used by
// both the Summary Statistics page (js/summary.js, on data.html) and the
// anomaly heatmaps (js/heatmaps.js) -- one implementation so the two views
// can never drift against each other.

// Days in calendar month (year, month) -- used both by day_weighted_mean
// weighting below and by the Compare overlay's mm/day -> mm/month conversion.
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Inverse standard normal CDF (probit) via Peter Acklam's rational
// approximation (accurate to ~1.15e-9) -- mirrors scipy.stats.norm.ppf, used
// so the season-window statistic below matches code/common/detrend.py's
// normal_score_transform (the pipeline's canonical, non-parametric
// standardization) instead of a from-scratch parametric z-score.
function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function sigmaToPercentileLabel(percentile) {
  if (percentile >= 99.95) return ">99.9%";
  if (percentile <= 0.05) return "<0.1%";
  return `${Math.round(percentile)}%`;
}

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
// (max error ~1.5e-7) -- only used for native standardized indices
// (SPI/SPEI/EDDI/...), whose own value is already an approximately
// standard-normal quantity by construction, so a forward CDF is the correct
// (not the rank-based) way to read its percentile.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function nativeIndexPercentile(sigma) {
  return 50 * (1 + erf(sigma / Math.SQRT2));
}

// Mirrors common/detrend.py's MIN_BASELINE_YEARS -- must stay in sync.
const MIN_BASELINE_YEARS = 3;
// The pipeline retired its old arbitrary 8-baseline-year floor on sigma: it now
// standardizes against ONE pooled interannual SD (common/detrend.py), stable even
// for a short record, so a z-score no longer needs 8 baseline years to be
// trustworthy -- a short satellite record (TROPOMI SIF) gets a real sigma. The
// client mirrors that by gating sigma only on MIN_BASELINE_YEARS (enough for any
// statistic) plus the dormancy floors below, not an arbitrary year count.

function windowMonthYearPairs(windowKey, targetYear) {
  const months = SEASON_MONTHS[windowKey] || [parseInt(windowKey, 10)];
  // A window spanning all 12 months (ANNUAL) always has both January and
  // October-December present, but it's a single calendar year, not a
  // Dec->Jan wrap -- the length check disambiguates it from a genuine
  // winter window like NDJF/DJF/DJFM.
  const crossesNewYear = months.length < 12 && months.includes(1) && months.some((m) => m >= 10);
  return months.map((month) => ({
    month,
    year: crossesNewYear && month >= 10 ? targetYear - 1 : targetYear,
  }));
}

function aggregateWindow(region, windowKey, targetYear, rule, field) {
  const pairs = windowMonthYearPairs(windowKey, targetYear);
  const values = [];
  const weights = [];
  for (const { month, year } of pairs) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    if (idx === -1 || region[field][idx] === null) return null;
    values.push(region[field][idx]);
    weights.push(rule === "day_weighted_mean" ? daysInMonth(year, month) : 1);
  }
  if (rule === "sum") return values.reduce((a, b) => a + b, 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

// Largest year-to-year coefficient of variation (baseline SD / baseline mean) at
// which "percent of mean" is shown: above 1 the spread exceeds the mean itself,
// so the mean does not describe a typical year.
const PERCENT_OF_MEAN_MAX_CV = 1;

function meanStd(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

// Per-calendar-month stress σ for the monthly heatmap. The stored region.sigma
// is already a σ for every product EXCEPT the non-σ native indices (USDM 0-5
// severity, PDSI/VegDRI "Index"): those keep their native value in region.sigma
// so the Time Series page can show it, so here they are standardized against
// that same calendar month's own baseline instead (Dylan, 2026-10), the per-
// month analog of computeWindowValue's non-σ-native branch. SPI/SPEI/EDDI/ESI/
// ForDRI (units "σ") and all non-native products pass their stored σ through.
function monthlyStressSigma(data, region, idx) {
  const nonSigmaNative = data.native_standardized
    && !(typeof data.units === "string" && data.units.trim() === "σ");
  if (!nonSigmaNative) return region.sigma[idx];
  const v = region.value[idx];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const month = parseInt(region.dates[idx].slice(5, 7), 10);
  const sample = [];
  for (let i = 0; i < region.dates.length; i++) {
    const y = parseInt(region.dates[i].slice(0, 4), 10);
    const mo = parseInt(region.dates[i].slice(5, 7), 10);
    const val = region.value[i];
    if (mo === month && y >= region.baseline_start_year && y <= region.baseline_end_year
        && val !== null && Number.isFinite(val)) sample.push(val);
  }
  if (sample.length < MIN_BASELINE_YEARS) return null;
  const { mean, std } = meanStd(sample);
  return std <= 0 ? null : (v - mean) / std;
}

// Returns { sigma, percentile, rawValue, percentOfNormal, isNativeIndex,
// stressRank, n } for one product/response/region/window/year.
// sigma is a classic z-score of the window-aggregated anomaly against the
// baseline years' own aggregated-anomaly mean/SD, matching the pipeline's
// per-month z-score (common/detrend.py::normal_score_transform). It uses the
// SAME anomaly basis the pipeline exports (an OLS trend residual where a real
// secular trend exists, else mean-centered by calendar month -- see
// common/detrend.py), not a separate "raw" value. This window z-score can
// differ slightly from the stored per-month Time Series sigma because it
// aggregates the anomaly across the season window first. percentile stays an
// empirical percentile of the target among the baseline years (a percentile is
// inherently a rank), reported alongside the z-score.
// percentOfNormal is null wherever the window's normal is not positive, or for
// native standardized indices (already a departure statistic, not a physical
// quantity with a "normal").
// stressRank/n: this target year's rank among the n baseline years, counted
// from the most stressful end (1 = the single most drought-stressed
// baseline year for this response's own drier_is_high direction) -- the
// same baseline sample sigma/percentile already rank against, just reported
// as a plain ordinal instead of a standardized score.
function computeWindowValue(data, region, windowKey, targetYear) {
  // Detect native standardized indices by the authoritative native_standardized
  // flag, NOT by aggregation === "native_index": USDM is native_standardized but
  // carries aggregation "mean", and keying off the aggregation alone sent it
  // through the non-native branch below, where it was wrongly re-standardized
  // (z-scored) and relabelled instead of shown as its own 0-5 severity.
  if (data.native_standardized) {
    // A fixed-timescale index (SPI-03 etc., aggregation "native_index") already
    // reflects its trailing months, so a season window reads its last month
    // (DJFM -> March). USDM carries a real window rule ("mean"), so its window
    // combines the months by that rule.
    const aggregateNative = (year) => {
      if (data.aggregation === "native_index") {
        const pairs = windowMonthYearPairs(windowKey, year);
        const { month, year: yr } = pairs[pairs.length - 1];
        const idx = region.dates.indexOf(`${yr}-${String(month).padStart(2, "0")}-01`);
        return idx === -1 ? null : region.value[idx];
      }
      return aggregateWindow(region, windowKey, year, data.aggregation, "value");
    };
    const v = aggregateNative(targetYear);
    if (v === null || v === undefined) return null;
    // SPI/SPEI/EDDI/ESI/ForDRI publish in σ units: the value already IS a
    // standardized departure, so it passes through unchanged -- never
    // re-standardized or relabelled.
    const sigmaNative = typeof data.units === "string" && data.units.trim() === "σ";
    if (sigmaNative) {
      return {
        sigma: v, percentile: null, rawValue: v, anomaly: null, percentOfNormal: null,
        isNativeIndex: true, stressRank: null, n: null, nRecord: null,
      };
    }
    // A non-σ native index (USDM 0-5 severity, PDSI/VegDRI "Index") is NOT on a
    // z scale: running its raw value through the stress-heatmap color and the
    // normal-CDF percentile put an average USDM month at ~95th-percentile stress
    // and "no drought" at the 50th. For the cross-product σ heatmap + percentile
    // it is standardized against its OWN baseline years instead (Dylan, 2026-10);
    // its native value is still what the Time Series / Map pages read (from the
    // stored region.sigma, untouched). percentOfNormal stays null -- a drought
    // index has no physical "normal" to take a percent of. isNativeIndex is
    // false so the summary uses this empirical percentile, not the normal CDF.
    const baseline = [];
    for (let y = region.baseline_start_year; y <= region.baseline_end_year; y++) {
      const b = aggregateNative(y);
      if (b !== null) baseline.push(b);
    }
    if (baseline.length < MIN_BASELINE_YEARS) return null;
    baseline.sort((a, b) => a - b);
    const nB = baseline.length;
    const belowB = baseline.filter((b) => b < v).length;
    const atOrBelowB = baseline.filter((b) => b <= v).length;
    const rankB = 0.5 * (belowB + atOrBelowB);
    const percentileNative = ((rankB + 0.5) / (nB + 1)) * 100;
    const { mean: meanB, std: stdB } = meanStd(baseline);
    const sigmaNonSigma = (nB < MIN_BASELINE_YEARS || stdB <= 0) ? null : (v - meanB) / stdB;
    const recordN = [];
    const firstY = parseInt(region.dates[0].slice(0, 4), 10);
    const lastY = parseInt(region.dates[region.dates.length - 1].slice(0, 4), 10);
    for (let y = firstY; y <= lastY; y++) {
      const b = aggregateNative(y);
      if (b !== null) recordN.push(b);
    }
    recordN.sort((a, b) => a - b);
    const nRecordNative = recordN.length;
    const ltN = recordN.filter((b) => b < v).length;
    const leN = recordN.filter((b) => b <= v).length;
    const rankRecordNative = 0.5 * (ltN + leN) + 0.5;
    const stressRankNative = data.drier_is_high ? nRecordNative - rankRecordNative + 1 : rankRecordNative;
    return {
      sigma: sigmaNonSigma, percentile: percentileNative, rawValue: v, anomaly: null,
      percentOfNormal: null, isNativeIndex: false, stressRank: stressRankNative,
      n: nB, nRecord: nRecordNative,
    };
  }
  const targetAnomaly = aggregateWindow(region, windowKey, targetYear, data.aggregation, "anomaly");
  const targetRaw = aggregateWindow(region, windowKey, targetYear, data.aggregation, "value");
  if (targetAnomaly === null || targetRaw === null) return null;

  const baselineAnomalies = [];
  for (let y = region.baseline_start_year; y <= region.baseline_end_year; y++) {
    const a = aggregateWindow(region, windowKey, y, data.aggregation, "anomaly");
    if (a !== null) baselineAnomalies.push(a);
  }
  if (baselineAnomalies.length < MIN_BASELINE_YEARS) return null;
  baselineAnomalies.sort((a, b) => a - b);
  const n = baselineAnomalies.length;
  // Mid-rank tie handling, matching common/detrend.py::normal_score_transform
  // exactly: a value tied with k baseline years counts as k/2 below it, not
  // all k. below = searchsorted(side="left"), atOrBelow = side="right"; the two
  // agree for tie-free data, but mid-rank stops a degenerate all-tied baseline
  // (e.g. a desert cell with SCA = 0 every year) from reading a merely-average
  // target as an all-time record extreme.
  const below = baselineAnomalies.filter((a) => a < targetAnomaly).length;
  const atOrBelow = baselineAnomalies.filter((a) => a <= targetAnomaly).length;
  const rank = 0.5 * (below + atOrBelow);
  const percentile = ((rank + 0.5) / (n + 1)) * 100;
  // Classic z-score: the window anomaly in units of the baseline years' own
  // window-anomaly standard deviation, matching the pipeline's per-month z-score
  // (common/detrend.py). A degenerate baseline (SD ~ 0, e.g. a desert cell with
  // SCA = 0 every year) can't be put in SD units, so a matching target reads 0
  // and a departing one is left out (null).
  const { mean: meanAnom, std: stdAnom } = meanStd(baselineAnomalies);
  // Dormant/absent window -- baseline spread negligible vs the series' overall
  // anomaly spread (e.g. summer snow) -- has no climatology to standardize
  // against, so it reads as no-data, matching the pipeline
  // (common/detrend.py::DORMANT_SD_FRACTION). A genuine extreme against a
  // real-variance baseline keeps its full, uncapped z.
  // Overall baseline spread: SD of the raw value over the baseline years -- the
  // same reference the pipeline's dormant floor uses (detrend.py standardizes
  // column='value', sd_floor = fraction * std of baseline values), NOT the
  // deseasonalized anomaly over the whole record, so the client floors the same
  // months the stored per-month σ / monthly heatmap do.
  const baselineVals = [];
  for (let i = 0; i < region.dates.length; i++) {
    const y = parseInt(region.dates[i].slice(0, 4), 10);
    const v = region.value[i];
    if (y >= region.baseline_start_year && y <= region.baseline_end_year
        && v !== null && Number.isFinite(v)) baselineVals.push(v);
  }
  const overallBaselineStd = baselineVals.length > 1 ? meanStd(baselineVals).std : 0;
  // Seasonal amplitude = spread of the 12 climatological monthly raw means; a
  // window whose baseline anomaly spread is a tiny fraction of it is
  // off-season/dormant (common/detrend.py::SEASONAL_DORMANT_FRACTION).
  const monthlyMeans = [];
  for (let m = 1; m <= 12; m++) {
    const monthVals = [];
    for (let i = 0; i < region.dates.length; i++) {
      const y = parseInt(region.dates[i].slice(0, 4), 10);
      const mo = parseInt(region.dates[i].slice(5, 7), 10);
      const v = region.value[i];
      if (mo === m && y >= region.baseline_start_year && y <= region.baseline_end_year
          && v !== null && Number.isFinite(v)) monthVals.push(v);
    }
    if (monthVals.length) monthlyMeans.push(meanStd(monthVals).mean);
  }
  const seasonalScale = monthlyMeans.length > 1 ? meanStd(monthlyMeans).std : 0;
  const seasonalFloor = SEASONAL_DORMANT_FRACTION * seasonalScale;
  const sigma = (baselineAnomalies.length < MIN_BASELINE_YEARS
                 || stdAnom <= DORMANT_SD_FRACTION * overallBaselineStd
                 || (seasonalFloor > 0 && stdAnom < seasonalFloor))
    ? null
    : (targetAnomaly - meanAnom) / stdAnom;

  // The displayed "rank on record" badge is a separate statistic from sigma:
  // sigma/percentile stay anchored to the fixed baseline_start_year..
  // baseline_end_year climatology (unchanged above, matching the Python
  // pipeline's own baseline-relative standardization everywhere else). The
  // rank badge instead compares the target year against every year with
  // valid data in the record, not just the frozen baseline slice -- ranking
  // only against the baseline meant a post-baseline year that set a new
  // record (e.g. 2026) could never be distinguished from the baseline's own
  // most extreme year (e.g. 2015): both simply "beat all baseline years" and
  // saturated at the same rank, even though their actual anomalies differed
  // by more than 2x (confirmed live, 2026-09-29, ERA5-Land T2m DJFM).
  const recordAnomalies = [];
  const firstRecordYear = parseInt(region.dates[0].slice(0, 4), 10);
  const lastRecordYear = parseInt(region.dates[region.dates.length - 1].slice(0, 4), 10);
  for (let y = firstRecordYear; y <= lastRecordYear; y++) {
    const a = aggregateWindow(region, windowKey, y, data.aggregation, "anomaly");
    if (a !== null) recordAnomalies.push(a);
  }
  recordAnomalies.sort((a, b) => a - b);
  const nRecord = recordAnomalies.length;
  // Mid-rank tie handling, same as the percentile above: a value tied with a
  // block of years takes the block's MIDDLE rank, not its extreme end. A
  // one-sided <= count collapses a large tie group of zero-event off-season
  // years (e.g. a winter with no fire) each onto the same extreme rank, so they
  // all read as a near-record-extreme badge when they are really the unremarkable
  // middle of the record.
  const ltRecord = recordAnomalies.filter((a) => a < targetAnomaly).length;
  const leRecord = recordAnomalies.filter((a) => a <= targetAnomaly).length;
  // 1-based mid-rank: the target year is itself in recordAnomalies, so the
  // record minimum scores (0 + 1)/2 + 0.5 = 1, not 0.5 -- without the +0.5 a
  // record-setting year on the drier_is_high end came out 1.5 and displayed as 2.
  const rankRecord = 0.5 * (ltRecord + leRecord) + 0.5;
  // rank counts from the driest/coolest (lowest-anomaly) end; drier_is_high
  // determines which end is actually the stressed one for this response.
  // Fractional (mid-rank) -- rounded only where displayed as a badge.
  const stressRank = data.drier_is_high ? nRecord - rankRecord + 1 : rankRecord;

  // Percent of mean against the same "Baseline mean" the regional tables show
  // (raw - anomaly: the window's baseline mean on the per-cell / per-site anomaly
  // basis), so every page reads one number. Whether the ratio means anything for
  // this response at all is the pipeline's pct_of_normal_ok flag, checked by
  // the callers. Here it is also left out where the window's year-to-year spread
  // exceeds its baseline mean (coefficient of variation above
  // PERCENT_OF_MEAN_MAX_CV): the mean is then not a typical year, and the ratio
  // runs to thousands of percent off a near-zero mean (off-season snow, winter SIF).
  const normal = targetRaw - targetAnomaly;
  const percentOfNormal = (normal > 0 && stdAnom <= PERCENT_OF_MEAN_MAX_CV * normal)
    ? (targetRaw / normal) * 100 : null;
  // The rank badge is "stressRank of nRecord": stressRank is ranked against
  // the FULL record (recordAnomalies / nRecord above), so its denominator must
  // be nRecord, NOT the smaller baseline sample n -- pairing them gave
  // impossible badges like "36/34" (rank out of a 37-year record over a
  // 34-year baseline count) (Dylan, 2026-10). `n` stays for sigma/percentile,
  // which ARE baseline-relative.
  return {
    sigma, percentile, rawValue: targetRaw, anomaly: targetAnomaly, percentOfNormal,
    isNativeIndex: false, stressRank, n, nRecord,
  };
}

let manifest = null;

async function loadManifest() {
  const response = await fetch(assetUrl("data/manifest.json"));
  manifest = await response.json();
  return manifest;
}

// Shared across every consumer of data/timeseries/*.json -- js/summary.js
// (data.html) and js/heatmaps.js (heatmaps.html, its own separate page) each
// fetch this independently, and explore.html's own single-product Explorer
// view and Compare view fetch the same product's file whenever the product
// checked in Compare is also the one selected in the Explorer picker. Each
// of those used to keep its own separate cache for the exact same URLs.
// Caches the in-flight PROMISE, not
// just the resolved value: two features' initial renders can call this for
// the same key before either fetch has resolved, so caching only the
// resolved value still let that first race double-fetch (confirmed 2026-09).
const _timeseriesCache = {};
function fetchTimeseriesJson(key) {
  if (!_timeseriesCache[key]) {
    _timeseriesCache[key] = fetch(assetUrl(`data/timeseries/${key}.json`)).then((res) => res.json());
  }
  return _timeseriesCache[key];
}

// Like fetchTimeseriesJson above, for data/seasonal/*.json -- read by the
// Seasonal Cycle page (js/seasonal.js). Caches the in-flight promise and
// resolves to null on a non-ok response rather than rejecting, so a caller can
// just check for a falsy result instead of wrapping it in a try/catch.
const _seasonalCache = {};
function fetchSeasonalJson(key) {
  if (!_seasonalCache[key]) {
    _seasonalCache[key] = fetch(assetUrl(`data/seasonal/${key}.json`)).then((res) => (res.ok ? res.json() : null));
  }
  return _seasonalCache[key];
}

// Every top-level region (Western US, CO-UT-WY, and whatever else the
// pipeline adds -- e.g. NOAA climate regions) comes from manifest.region_labels,
// never hardcoded here, so a new region shows up everywhere the moment the
// pipeline export includes it -- no dashboard code change needed. Kept
// separate from allRegionEntries() below: js/summary.js's "Regions" tab uses
// this narrower list on purpose, as one of three distinct tabs (Regions/
// States/HUC2) -- widening it here would duplicate every state and HUC2
// basin into that tab too.
function regionEntries() {
  return Object.entries(manifest.region_labels).map(([code, label]) => ({ code, label }));
}

// Every region code the pipeline actually exports data for: the 6 named
// regions plus all 11 states and 5 HUC2 basins, which every per-product
// timeseries JSON already carries. Used by the single flat region
// pickers (Explorer, Compare, Heatmaps) so they expose the same data
// js/summary.js's grouped Regions/States/HUC2 tabs already do -- confirmed
// 2026-09-25 those pickers were silently capped at the 6 named regions via
// regionEntries(), hiding 16 of 22 regions' worth of processed data.
function allRegionEntries() {
  const named = regionEntries();
  const states = manifest.western_states.map((code) => ({ code, label: manifest.state_labels[code] }));
  const huc2 = manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] }));
  return [...named, ...states, ...huc2];
}

// Display label for any region code, across the three region sets (named
// multi-state regions, states, HUC2 basins). Used in dynamic figure titles.
function regionLabelFor(code) {
  return manifest.region_labels[code] || manifest.state_labels[code] || manifest.huc2_labels[code] || code;
}

function populateRegionSelect(select, defaultCode = "ALL") {
  select.innerHTML = "";
  allRegionEntries().forEach(({ code, label }) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    if (code === defaultCode) option.selected = true;
    select.appendChild(option);
  });
}

// Region picker as a "region type" segmented control (Multi-state / States /
// HUC basins) that swaps which region buttons show -- the three groups map
// exactly to the manifest's own region_labels / western_states / huc2_regions
// sets, so the flat 22-button wall becomes ~6-11 buttons at a time, and the
// two "California" entries (state vs HUC basin) land in separate tabs.
function populateRegionToggle(container, defaultCode = "ALL") {
  container.innerHTML = "";
  const groups = [
    { key: "multistate", label: "Multi-state", entries: regionEntries() },
    { key: "states", label: "States", entries: manifest.western_states.map((c) => ({ code: c, label: manifest.state_labels[c] })) },
    { key: "huc", label: "HUC basins", entries: manifest.huc2_regions.map((c) => ({ code: c, label: manifest.huc2_labels[c] })) },
  ];
  const activeType = (groups.find((g) => g.entries.some((e) => e.code === defaultCode)) || groups[0]).key;

  const typeTabs = document.createElement("div");
  typeTabs.className = "region-type-tabs";
  groups.forEach((g) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "region-type-tab" + (g.key === activeType ? " active" : "");
    tab.textContent = g.label;
    tab.dataset.regionType = g.key;
    tab.addEventListener("click", () => {
      container.querySelectorAll(".region-type-tab").forEach((t) => t.classList.toggle("active", t === tab));
      container.querySelectorAll(".region-buttons").forEach((bg) => { bg.style.display = bg.dataset.regionType === g.key ? "" : "none"; });
    });
    typeTabs.appendChild(tab);
  });
  container.appendChild(typeTabs);

  groups.forEach((g) => {
    const bg = document.createElement("div");
    bg.className = "region-buttons";
    bg.dataset.regionType = g.key;
    bg.style.display = g.key === activeType ? "" : "none";
    g.entries.forEach(({ code, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.region = code;
      button.textContent = label;
      if (code === defaultCode) button.classList.add("active");
      bg.appendChild(button);
    });
    container.appendChild(bg);
  });
}

// Highlight a region button by code and reveal the type group it belongs to
// (used when a URL-restored view selects a region in a non-default group).
function activateRegionButton(container, code) {
  const btn = container.querySelector(`.region-buttons button[data-region="${code}"]`);
  if (!btn) return;
  container.querySelectorAll(".region-buttons button[data-region]").forEach((b) => b.classList.toggle("active", b === btn));
  const type = btn.closest(".region-buttons").dataset.regionType;
  container.querySelectorAll(".region-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.regionType === type));
  container.querySelectorAll(".region-buttons").forEach((g) => { g.style.display = g.dataset.regionType === type ? "" : "none"; });
}

// COGs (cogs/) and the data/ JSON are large/binary assets served from
// external object storage (the Cloudflare R2 bucket wus-snowdrought), not
// committed to this repo. They're exposed through a custom domain on
// Cloudflare (data.snowdrought.org) rather than the bucket's raw
// pub-*.r2.dev URL: enterprise/government DNS filters -- NOAA's included --
// sinkhole the entire r2.dev domain as an abused free-bucket host, which
// blackholed the live dashboard for every NOAA machine. A custom domain
// rides Cloudflare's normal CDN hostnames, which those filters don't block.
// On localhost, fall back to the local relative data/ and cogs/ paths so
// local dev/testing doesn't depend on the R2 bucket being populated.
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const R2_BASE_URL = IS_LOCALHOST ? "" : "https://data.snowdrought.org";

function assetUrl(relativePath) {
  return R2_BASE_URL ? `${R2_BASE_URL.replace(/\/$/, "")}/${relativePath}` : relativePath;
}

function periodLabel(period) {
  return SEASON_LABELS[period] || MONTH_NAMES[parseInt(period, 10) - 1];
}

// ---------------------------------------------- Shared regional summary table
//
// The region x value table (one row per named region, state, and HUC2 basin,
// with raw value / raw anomaly / standardized sigma / rank on record for a
// product at one window+year) is shown identically on the Map, Time Series, and
// Seasonal pages. These pure helpers are the single source of that table's
// design; each page just drops the rows/note/header into its own markup, so the
// four data columns, number formats, stress-direction coloring, and glossary never
// drift between pages.

// "Raw value" header: a single month is that month's value; a multi-month window
// is a day-weighted MEAN (mean-type variables) or a SUM (accumulations).
// Display unit of a window aggregate: a multi-month SUM of monthly totals is a
// total over the window, so a per-month unit ("mm month-1") drops its
// "month-1" (a DJFM precipitation total is mm, not mm per month).
function windowUnits(data, windowKey) {
  const units = canonicalUnit(data.units);
  return (data.aggregation === "sum" && !/^\d{2}$/.test(windowKey)) ? units.replace(/\s*month-1$/, "") : units;
}

function rawValueHeaderLabel(data, windowKey) {
  return /^\d{2}$/.test(windowKey) ? "Raw value"
    : data.aggregation === "sum" ? "Raw value (window total)" : "Raw value (window mean)";
}

function regionalSummaryNote(data) {
  const nativeNote = data.native_standardized
    ? " Native standardized index -- rank on record not computed for these (the reading is already a standardized departure)."
    : "";
  return `Rows are shaded by standing on record, not by the climatological mean (which is not a drought threshold): the driest third of years in this variable's own stress direction (${data.drier_is_high ? "higher" : "lower"} = more stress) read gold = more stress, the wettest third blue = less stress, the middle third is left uncolored. The σ sign stays native (+ above / − below the mean). Rank 1 = the most drought-stressed year of record; higher ranks are progressively less stressed.${nativeNote}`;
}

// Show or hide the "% of mean" header of the table holding bodyEl, matching
// the cells regionalSummaryRowsHtml writes for this response.
function applyPctOfNormalHeader(bodyEl, data) {
  bodyEl.closest("table").querySelectorAll(".pct-normal-th").forEach((th) => {
    th.hidden = !data.pct_of_normal_ok;
  });
}

function regionalSummaryRowsHtml(data, windowKey, year) {
  // Raw value / normal / raw-unit anomaly display in the canonical unit
  // (e.g. kg m-2 -> mm); % of mean stays a native ratio below.
  const unitFactor = canonicalUnitFactor(data.units);
  const dispUnits = windowUnits(data, windowKey);
  // % of mean only means something for a physical amount (precipitation, SWE,
  // soil moisture, evaporation...): data.pct_of_normal_ok from the pipeline
  // excludes temperature-like quantities, native indices, and quantities that
  // change sign or are not amounts (net carbon exchange, TWS anomaly, LSWI,
  // percentiles). Where it doesn't apply the column is dropped, not dashed.
  const showPct = Boolean(data.pct_of_normal_ok);
  const nColumns = showPct ? 7 : 6;
  const regionGroups = [
    { label: "Regions", entries: regionEntries() },
    { label: "States", entries: manifest.western_states.map((code) => ({ code, label: manifest.state_labels[code] })) },
    { label: "HUC2 basins", entries: manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] })) },
  ];
  return regionGroups.flatMap(({ label: groupLabel, entries }) => {
    const groupRow = `<tr class="group-row"><td colspan="${nColumns}">${groupLabel}</td></tr>`;
    const dataRows = entries.map(({ code, label }) => {
      const region = data.regions[code];
      const result = region ? computeWindowValue(data, region, windowKey, year) : null;
      if (!result) return `<tr><td>${label}</td>${"<td>&mdash;</td>".repeat(nColumns - 1)}</tr>`;
      // Color reflects standing ON RECORD (rank), not which side of the
      // climatological mean a value falls -- the mean is not the line between
      // drought and no-drought. Driest third of years on record read stress,
      // wettest third least stress, the middle third is left uncolored.
      let cls = "";
      if (result.stressRank !== null && result.nRecord) {
        const frac = result.stressRank / result.nRecord; // rank 1 = most drought-stressed
        cls = frac <= 1 / 3 ? "stress" : frac > 2 / 3 ? "relief" : "";
      }
      const rawText = `${(result.rawValue * unitFactor).toFixed(2)} ${dispUnits}`;
      // Normal = this window's baseline (climatology) mean in native units; since
      // the anomaly is the mean-centered departure, mean = raw - anomaly. Not
      // defined for native standardized indices (the value already is a departure).
      const hasNormal = result.anomaly !== null && !result.isNativeIndex;
      const normal = hasNormal ? result.rawValue - result.anomaly : null; // native units
      const normalText = normal === null ? "&mdash;" : `${(normal * unitFactor).toFixed(2)} ${dispUnits}`;
      const pctCell = !showPct ? ""
        : `<td>${result.percentOfNormal === null ? "&mdash;" : `${result.percentOfNormal.toFixed(0)}%`}</td>`;
      const rawAnomText = (result.anomaly === null || result.isNativeIndex)
        ? "&mdash;" : `${result.anomaly >= 0 ? "+" : ""}${(result.anomaly * unitFactor).toFixed(2)} ${dispUnits}`;
      const sigmaText = result.sigma === null ? "&mdash;" : `${result.sigma >= 0 ? "+" : ""}${result.sigma.toFixed(1)}`;
      const rankText = (result.stressRank === null || result.nRecord === null) ? "&mdash;"
        : `<span class="rank-badge ${cls === "stress" || cls === "relief" ? cls : ""}">${Math.round(result.stressRank)}/${result.nRecord}</span>`;
      return `<tr><td>${label}</td><td>${rawText}</td><td>${normalText}</td>${pctCell}<td class="${cls}">${rawAnomText}</td><td class="${cls}">${sigmaText}</td><td>${rankText}</td></tr>`;
    });
    return [groupRow, ...dataRows];
  }).join("");
}

// Shared window (season/month) and year <select> population, so the pages that
// carry the summary table offer identical window+year pickers feeding it.
function populateWindowSelect(select, defaultKey) {
  select.innerHTML = "";
  SEASON_ORDER.forEach((key) => {
    const o = document.createElement("option");
    o.value = key; o.textContent = `${key} (${SEASON_LABELS[key]})`;
    if (key === defaultKey) o.selected = true;
    select.appendChild(o);
  });
  MONTH_NAMES.forEach((name, i) => {
    const o = document.createElement("option");
    o.value = String(i + 1).padStart(2, "0"); o.textContent = name;
    if (o.value === defaultKey) o.selected = true;
    select.appendChild(o);
  });
}

function populateYearSelect(select, defaultYear) {
  select.innerHTML = "";
  const { minYear, maxYear } = fullRecordYearRange();
  for (let y = maxYear; y >= minYear; y--) {
    const o = document.createElement("option");
    o.value = String(y); o.textContent = String(y);
    if (y === defaultYear) o.selected = true;
    select.appendChild(o);
  }
}

function sortedPeriods(periodKeys) {
  return periodKeys.slice().sort((a, b) => {
    const aSeason = SEASON_ORDER.indexOf(a);
    const bSeason = SEASON_ORDER.indexOf(b);
    if (aSeason !== -1 || bSeason !== -1) {
      if (aSeason === -1) return 1;
      if (bSeason === -1) return -1;
      return aSeason - bSeason;
    }
    return parseInt(a, 10) - parseInt(b, 10);
  });
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Looks up a response's manifest entry without needing to already know its
// category -- category is only known up front where a page's own picker
// state tracks it (js/explore.js's explorerState, js/map-viewer.js's
// mapPickerState); chart code building traces across many products at once
// (Compare variables, Heatmaps) only has product+response.
function findResponseEntry(product, response) {
  for (const products of Object.values(manifest.categories)) {
    if (products[product] && products[product][response]) return products[product][response];
  }
  return null;
}

// Shared by explore.js and map-viewer.js's product-meta line -- a short
// plain-language definition plus the same units/record/baseline facts
// already in the exported JSON, never any interpretive claim about current
// conditions.
// Readable labels for the pipeline's internal record-status enum, so the raw
// snake_case value (e.g. "partial_target_record") never shows in the UI.
const STATUS_LABELS = {
  complete_target_record: "complete record",
  partial_target_record: "current period provisional",
  no_target_observations: "no current-period data",
};

function productMetaHtml(entry) {
  const recordRange = entry.record_start && entry.record_end
    ? `${entry.record_start.slice(0, 7)} – ${entry.record_end.slice(0, 7)}`
    : "unknown record range";
  const baseline = (entry.baseline_start_year && entry.baseline_end_year)
    ? `${entry.baseline_start_year}–${entry.baseline_end_year}`
    : "n/a";
  const glossaryLine = entry.glossary ? `<p class="product-glossary">${entry.glossary}</p>` : "";
  return `${glossaryLine}<p class="product-facts">Units: ${entry.units || "n/a"} · Baseline: ${baseline} · Record: ${recordRange} · Status: ${STATUS_LABELS[entry.status] || entry.status}</p>`;
}

// Cross-page continuity for the Explore <-> Maps product picker: the last
// category/product/response chosen on either page becomes the default on
// the other, so switching pages doesn't reset the view. Only a fallback --
// an incoming URL-hash shared view (js/explore.js's parseSharedViewFromUrl,
// js/map-viewer.js's parseSharedMapViewFromUrl) always takes priority, and
// writing here never touches the URL.
const LAST_SELECTION_KEY = "snowdroughtWUS.lastSelection";

function saveLastSelection(category, product, response) {
  try {
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ category, product, response }));
  } catch (err) {
    // Private browsing / storage disabled -- selection just won't persist.
  }
}

function loadLastSelection() {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// Flat (category, product, response) index for the product search box,
// shared by explore.js and map-viewer.js. Matches against the product/
// response codes and each response's own glossary text, so a search for a
// physical quantity ("snow water equivalent") finds it even without
// knowing the acronym.
function buildSearchIndex() {
  const index = [];
  for (const category of manifest.category_order) {
    for (const [product, responses] of Object.entries(manifest.categories[category])) {
      for (const [response, entry] of Object.entries(responses)) {
        index.push({ category, product, response, glossary: entry.glossary || "" });
      }
    }
  }
  return index;
}

function searchProductIndex(index, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.filter((item) =>
    item.product.toLowerCase().includes(q) ||
    item.response.toLowerCase().includes(q) ||
    item.glossary.toLowerCase().includes(q)
  ).slice(0, 12);
}

// Wires a search <input> + results <div> pair (matching IDs on both Explore
// and Maps pages) to buildSearchIndex/searchProductIndex, calling
// onSelect(category, product, response) when a result is clicked.
function wireProductSearch(inputId, resultsId, onSelect) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;
  const index = buildSearchIndex();
  input.addEventListener("input", () => {
    const matches = searchProductIndex(index, input.value);
    if (matches.length === 0) {
      results.innerHTML = "";
      results.style.display = "none";
      return;
    }
    results.innerHTML = matches.map((m, i) =>
      `<button type="button" class="search-result" data-index="${i}">
        <strong>${m.product}</strong> &ndash; ${m.response}
        <span class="search-result-category">${categoryLabelWithIcon(m.category)}</span>
      </button>`
    ).join("");
    results.style.display = "block";
    results.querySelectorAll(".search-result").forEach((button, i) => {
      button.addEventListener("click", () => {
        const m = matches[i];
        input.value = "";
        results.innerHTML = "";
        results.style.display = "none";
        onSelect(m.category, m.product, m.response);
      });
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target !== input && !results.contains(event.target)) {
      results.style.display = "none";
    }
  });
}

// Accessibility, applied once for every page (the nav is static per-page HTML):
// mark the active nav link programmatically and inject a skip-to-content link
// as the first focusable element. aria-pressed on the segmented toggles and the
// OpenLayers map's keyboard operability are handled in their own page scripts.
(function enhanceNavAccessibility() {
  const run = () => {
    document.querySelectorAll(".site-nav a.active").forEach((a) => a.setAttribute("aria-current", "page"));
    const main = document.querySelector("main");
    if (main && !document.querySelector(".skip-link")) {
      if (!main.id) main.id = "main-content";
      const skip = document.createElement("a");
      skip.href = "#" + main.id;
      skip.className = "skip-link";
      skip.textContent = "Skip to content";
      document.body.insertBefore(skip, document.body.firstChild);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();

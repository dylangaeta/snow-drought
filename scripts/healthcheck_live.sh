#!/usr/bin/env bash
# Health check for the LIVE Western US snow-drought dashboard.
#
# The site's HTML/JS is on GitHub Pages, but all of its DATA (manifest,
# map styles, map COGs) is served from a Cloudflare R2 bucket -- see
# js/common.js's assetUrl(). The two can drift silently: the site looks fine
# from a local server (which reads the local data/ dir) while the live site is
# broken (because R2 is stale/missing after a pipeline export that wasn't
# re-synced). This pings BOTH the pages and the live R2 data path end to end
# -- manifest -> a real map style -> a COG it references -- and flags drift.
#
# NOTE: the dashboard's data is served from the custom domain
# data.snowdrought.org (a Cloudflare R2 custom domain), NOT the bucket's raw
# pub-*.r2.dev URL. NOAA's DNS filter sinkholes the entire r2.dev domain, so
# the raw URL is unreachable from NOAA machines. The custom domain rides
# normal Cloudflare CDN hostnames that the filter does not block, so these
# checks should run from NOAA too -- but verify on the NOAA network after any
# domain change (a brand-new domain can be briefly caught by a
# newly-registered-domain filter category). The R2 checks still WARN (not
# FAIL) on a total connect failure, so a transient outage doesn't produce a
# misleading hard failure.
#
# Exit code: 0 if everything that could be checked passed, 1 if anything that
# WAS reachable came back broken -- suitable for cron/CI.
set -uo pipefail

SITE_BASE="${SITE_BASE:-https://snowdrought.org}"
R2_BASE="${R2_BASE:-https://data.snowdrought.org}"
TIMEOUT="${TIMEOUT:-20}"
PAGES=(index map explore seasonal compare data heatmaps classification gallery about)

fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ok()   { printf "  \033[32m OK \033[0m %s\n" "$1"; }
bad()  { printf "  \033[31mFAIL\033[0m %s\n" "$1"; fail=1; }
warn() { printf "  \033[33mWARN\033[0m %s\n" "$1"; }

# Echoes the HTTP status (000 on connect/resolve/timeout failure); body -> $2.
http() {
  local url="$1" out="${2:-/dev/null}" code
  code="$(curl -sS --max-time "$TIMEOUT" -o "$out" -w "%{http_code}" "$url" 2>/dev/null)"
  echo "${code:-000}"
}

echo "== GitHub Pages ($SITE_BASE) =="
for p in "${PAGES[@]}"; do
  code="$(http "$SITE_BASE/$p.html")"
  if [ "$code" = "200" ]; then ok "$p.html"; else bad "$p.html -> HTTP $code"; fi
done

echo "== R2 data path ($R2_BASE) =="
code="$(http "$R2_BASE/data/manifest.json" "$tmp/manifest.json")"
if [ "$code" = "000" ]; then
  warn "manifest.json unreachable -- can't resolve/connect to $R2_BASE (is the R2 custom domain Active? on NOAA, confirm it isn't caught by a newly-registered-domain filter)"
elif [ "$code" != "200" ]; then
  bad "manifest.json -> HTTP $code (live site has no data -- re-run sync_cogs_to_r2.sh)"
else
  read -r nprod prod resp < <(python3 - "$tmp/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
cats = m.get("categories", {})
n = sum(len(v) for v in cats.values())
prod = resp = ""
# Pick the first product/response that actually has a raster map (non-empty
# "maps"): station datasets (SNOTEL, AmeriFlux, ...) carry an empty maps dict
# and legitimately have no map_styles JSON, so sampling one would false-FAIL.
for cat in m.get("category_order", list(cats)):
    for p, responses in (cats.get(cat) or {}).items():
        for r, entry in responses.items():
            if entry.get("maps"):
                prod, resp = p, r
                break
        if prod:
            break
    if prod:
        break
print(n, prod, resp)
PY
)
  if [ "${nprod:-0}" -gt 0 ]; then ok "manifest.json (${nprod} products)"; else bad "manifest.json loaded but lists 0 products"; fi

  # Chain-check the real data path a map page walks: style JSON, then a COG it names.
  if [ -n "${prod:-}" ] && [ -n "${resp:-}" ]; then
    skey="${prod}_${resp}"
    scode="$(http "$R2_BASE/data/map_styles/$skey.json" "$tmp/style.json")"
    if [ "$scode" = "200" ]; then
      ok "data/map_styles/$skey.json"
      cog="$(python3 - "$tmp/style.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
f = ""
for slot in (s.get("periods") or {}).values():
    for v in slot.values():
        if isinstance(v, dict) and v.get("file"):
            f = v["file"]; break
    if f:
        break
print(f)
PY
)"
      if [ -n "$cog" ]; then
        ccode="$(http "$R2_BASE/cogs/$cog")"
        if [ "$ccode" = "200" ]; then ok "cogs/$cog"; else bad "cogs/$cog -> HTTP $ccode (style names a COG not on R2 -- classic drift)"; fi
      else
        warn "no COG filename found in $skey.json to sample"
      fi
    else
      bad "data/map_styles/$skey.json -> HTTP $scode"
    fi
  fi
fi

echo
if [ "$fail" = "0" ]; then
  echo "RESULT: OK (everything reachable passed)"
else
  echo "RESULT: FAILURES above -- live site likely out of sync; re-run scripts/sync_cogs_to_r2.sh"
fi
exit "$fail"

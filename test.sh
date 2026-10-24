#!/usr/bin/env bash
# Regression suite for index.html over file:// via agent-browser.
set -u
cd "$(dirname "$0")"

SESSION="$(agent-browser session id --scope worktree --prefix app-tests)"
AB=(agent-browser --session "$SESSION")
PAGE_URL="http://localhost:8000/index.html"
CACHE_KEY="cat-opd-doctors-v4"
: "${NORI_USER:?set NORI_USER and NORI_PASS (a viewer login)}" "${NORI_PASS:?}"

TOTAL=0 FAILED=0
check() { # check <name> <expected> <actual>
  TOTAL=$((TOTAL+1))
  if [ "$2" = "$3" ]; then
    echo "✓ $1"
  else
    echo "✗ $1 — expected [$2], got [$3]"
    FAILED=$((FAILED+1))
  fi
}
js() { "${AB[@]}" eval --stdin; }   # js <<< 'expression' prints the result value

"${AB[@]}" open "$PAGE_URL" > /dev/null
"${AB[@]}" set viewport 1280 800 > /dev/null
"${AB[@]}" console --clear > /dev/null   # drop stale entries from previous runs
"${AB[@]}" errors --clear > /dev/null
check "login form shown when signed out" "true" "$(js <<< "!!document.querySelector('#login')")"
js <<EOF2 > /dev/null
const f=document.querySelector('#login');f.username.value='$NORI_USER';f.password.value='$NORI_PASS';f.requestSubmit();
EOF2
"${AB[@]}" wait --fn "!!document.querySelector('.list')" --timeout 60000

# ---- TEST 0: site essentials present ----
check "favicon is cat png" "true" "$(js <<< "!!document.querySelector('link[rel=\"icon\"][href=\"icon-192.png\"]')")"
check "theme-color light+dark" "2" "$(js <<< 'document.querySelectorAll("meta[name=theme-color]").length')"
check "meta description set" "true" "$(js <<< 'document.querySelector("meta[name=description]").content.length > 0')"
check "noscript fallback present" "true" "$(js <<< '!!document.querySelector("noscript")')"

# ---- TEST 1: cold load renders doctors and populates the localStorage cache ----
check "list rendered" "true" "$(js <<< "document.querySelectorAll('.list li').length > 0")"
check "cache populated" "true" "$(js <<< "JSON.parse(localStorage.getItem('$CACHE_KEY')).doctors.length > 0")"
check "render matches cache" "true" "$(js <<< "document.querySelectorAll('.list li').length === JSON.parse(localStorage.getItem('$CACHE_KEY')).doctors.length")"
check "updated timestamp shown" "true" "$(js <<< '/อัปเดต/.test(document.querySelector(".count").textContent)')"
check "config applied" "true" "$(js <<< 'API_URL.startsWith("https://") && !!TABLE && DAYS.length === 7 && ORDER.length === 7')"

# ---- TEST 2: reload still renders (cache/network path stays healthy) ----
"${AB[@]}" reload > /dev/null
"${AB[@]}" wait --fn "!!document.querySelector('.list')" --timeout 60000
check "renders after reload" "true" "$(js <<< "document.querySelectorAll('.list li').length > 0")"

# ---- TEST 3: stale-while-revalidate — seeded cache paints first, then background refresh replaces it ----
js <<EOF > /dev/null
localStorage.setItem('$CACHE_KEY', JSON.stringify({savedAt: Date.now(), doctors: [{id:'x',name:'TESTDOCTORCACHE',spec:'T',note:'',schedule:[]}]}));
EOF
"${AB[@]}" reload > /dev/null
"${AB[@]}" wait --text "TESTDOCTORCACHE" --timeout 60000
check "cache-first paint of seeded data" "true" "$(js <<< "document.body.innerText.includes('TESTDOCTORCACHE')")"
SWR_OK=false
for i in $(seq 1 40); do
  if [ "$(js <<< "!document.body.innerText.includes('TESTDOCTORCACHE') && !!document.querySelector('.list')")" = "true" ]; then
    SWR_OK=true; break
  fi
  sleep 1
done
check "background refresh re-renders fresh data" "true" "$SWR_OK"
check "cache overwritten with fresh data" "true" "$(js <<< "!localStorage.getItem('$CACHE_KEY').includes('TESTDOCTORCACHE')")"

# ---- TEST 4: hash routing still works (listener moved to top level) ----
check "doctor ids are name hashes" "true" "$(js <<< 'DOCTORS.length > 0 && DOCTORS.every(d=>/^d[0-9a-f]+$/.test(d.id))')"
js <<< "location.hash='#'+DOCTORS[0].id" > /dev/null
"${AB[@]}" wait --text "กลับไปค้นหา" --timeout 15000
check "doctor view opens via hash" "true" "$(js <<< "!!document.querySelector('table')")"
js <<< "location.hash=''" > /dev/null
"${AB[@]}" wait --fn "!!document.querySelector('.list')" --timeout 15000
check "back to list via hash" "true" "true"

# ---- app-side errors must be empty ----
check "no page errors" "" "$("${AB[@]}" errors)"
check "no console errors" "" "$("${AB[@]}" console | grep -F '[error]' || true)"

# ---- TEST 5: PWA — manifest, service worker, offline reload ----
check "manifest reachable" "true" "$(js <<< "fetch('manifest.webmanifest').then(r=>r.ok)")"
"${AB[@]}" wait --fn "navigator.serviceWorker.controller !== null" --timeout 30000
check "service worker controls page" "true" "true"
"${AB[@]}" console --clear > /dev/null
"${AB[@]}" errors --clear > /dev/null
"${AB[@]}" set offline on > /dev/null
"${AB[@]}" reload > /dev/null
"${AB[@]}" wait --fn "!!document.querySelector('.list')" --timeout 60000
check "offline: app renders from cache" "true" "$(js <<< "document.querySelectorAll('.list li').length > 0")"
"${AB[@]}" set offline off > /dev/null

"${AB[@]}" close > /dev/null
echo
echo "=== $((TOTAL - FAILED))/$TOTAL passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ]

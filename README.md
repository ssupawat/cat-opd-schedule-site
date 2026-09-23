# ตารางออกตรวจ (cat-opd-schedule-site)

Single-file Thai OPD doctor schedule PWA. No backend, no build step. Data comes from a published Google Sheet.

## How it works

- `config.json` holds the CSV link, day names (the sheet's column names), and day display order — fetched at startup, no code edits needed to retarget.
- Two views switched by URL hash: search list and per-doctor weekly table with today highlighted. Doctor ids are name hashes, so shared links survive row reordering in the sheet.
- Three caches make repeat loads fast and offline-friendly: browser HTTP cache (CSV, 5 min), `localStorage` (parsed doctors + update time), service worker (app shell).

## Data flow

```mermaid
flowchart TD
    A[Browser opens site] --> B{"localStorage has<br>cat-opd-doctors-v2?"}
    B -- yes --> C["Paint list instantly<br>from cached doctors + updated-at"]
    C --> D[Revalidate in background]
    B -- no --> E[Show loading]
    E --> F["Fetch published CSV<br>from docs.google.com"]
    D --> F
    F --> G[PapaParse to doctors array]
    G --> H["Save savedAt + doctors<br>to localStorage"]
    H --> I{"Data changed since paint?"}
    I -- yes --> J[Re-render current view]
    I -- no --> K["Keep view / search state"]
```

## Run

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

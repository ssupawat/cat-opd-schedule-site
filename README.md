# ตารางออกตรวจ (cat-opd-schedule-site)

Single-file Thai OPD doctor schedule PWA. Data source: a published Google Sheet.

## How it works

- `config.json` holds the CSV link, day names, and day display order. Fetched at startup.
- Two views switched by URL hash: search list, per-doctor weekly table with today highlighted. Doctor ids are `d` + djb2 hash of the doctor name.
- Caches: browser HTTP cache (CSV, 5 min), `localStorage` (parsed doctors + update time), service worker (app shell).

## Data flow

```mermaid
flowchart TD
    A[Browser opens site] --> B{"localStorage has<br>cat-opd-doctors-v2?"}
    B -- yes --> C["Paint from cached<br>doctors + updated-at"]
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

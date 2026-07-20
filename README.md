# Urban Service Inequality — Colombo District

A Leaflet-based web GIS app that maps public-service accessibility and
priority across GN (Grama Niladhari) Divisions in the Colombo District,
with layers for hospitals, schools, banks, parks, and bus stops, plus a
**live Public Participation GIS (PPGIS) Community Feedback Dashboard**
backed by Google Forms + Google Sheets — no database or backend server
required.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure — map, sidebar, feedback form, PPGIS dashboard |
| `style.css` | All styling |
| `script.js` | App logic (Leaflet setup, data loading, choropleth, search, PPGIS dashboard) |
| `data/` | **You provide this** — see below |

## 1. Add your map data

Create a `data/` folder next to `index.html` with these files:

```
data/
  GND_layer_n.geojson    (GN Division polygons)
  Hospitals.geojson
  Schools.geojson
  Banks.geojson
  Parks.geojson
  Bus_stops.geojson
```

If your filenames differ, update the `DATA_FILES` object at the top of
`script.js` — nothing else needs to change.

The GN polygon layer must include these properties (or edit the `FIELD`
object in `script.js` to match your schema):

- `ADM4_EN` — GN Division name
- `Colombo_GN_Population_Population` — population
- `AI` — accessibility index
- `priority_i` — priority index

## 2. Run it locally

Browsers block `fetch()` on local files opened directly (`file://`), so
serve the folder over HTTP. From the project folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

(Any static server works — `npx serve`, VS Code's Live Server extension, etc.)

## 3. Set up the PPGIS Community Feedback system

This replaces the old session-only feedback list with a **live dashboard**
that reads directly from a Google Sheet, updates automatically, and shows
every citizen report as a marker on the map.

### Step A — Build the Google Form

Create a Google Form with exactly these 7 questions, **in this order**:

1. GN Division (short answer)
2. Service Type (multiple choice: Hospital / School / Bank / Park / Bus Stop)
3. Issue Category (multiple choice: Access / Distance, Poor Condition,
   Overcrowding / Capacity, Safety Concern, Other)
4. Description (paragraph)
5. Latitude (short answer)
6. Longitude (short answer)
7. Reporter Name (short answer, **mark as not required**)

Responses will land automatically in a linked Google Sheet (Form → Responses
tab → green Sheets icon → *Create spreadsheet*).

### Step B — Get your form submission entry IDs

1. Open the Form's 3-dot menu → **Get pre-filled link**.
2. Type a distinct placeholder into each question (e.g. `GNDIVISIONTEST`)
   and click **Get link**.
3. Copy the generated URL — it looks like:
   ```
   https://docs.google.com/forms/d/e/FORM_ID/viewform?usp=pp_url&entry.111111111=GNDIVISIONTEST&entry.222222222=...
   ```
4. Match each `entry.NNNNNNNNN=` number to the question you recognise from
   its placeholder value.
5. In `script.js`, find `GOOGLE_FORM_CONFIG` and paste in:
   - `formActionUrl` — the same link, with `/viewform` changed to
     `/formResponse` (keep the same `FORM_ID`)
   - each `entry.NNNNNNNNN` ID under `entries: { ... }`

```js
const GOOGLE_FORM_CONFIG = {
  formActionUrl: 'https://docs.google.com/forms/d/e/FORM_ID/formResponse',
  entries: {
    gnDivision:    'entry.XXXXXXXXX',
    serviceType:   'entry.XXXXXXXXX',
    issueCategory: 'entry.XXXXXXXXX',
    description:   'entry.XXXXXXXXX',
    latitude:      'entry.XXXXXXXXX',
    longitude:     'entry.XXXXXXXXX',
    reporterName:  'entry.XXXXXXXXX'
  }
};
```

The web map submits directly to this form via a hidden iframe — no page
reload, no visible new tab. Because the response is cross-origin, the
browser can't confirm Google accepted it (a known limitation of the
no-backend Forms approach) — test once and confirm a new row appears in
your Sheet.

### Step C — Publish the Google Apps Script JSON API

1. Open the linked Google **Sheet** → **Extensions → Apps Script**.
2. Delete any starter code and paste:

   ```js
   function doGet() {
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Form Responses 1');
     const [headers, ...rows] = sheet.getDataRange().getValues();
     const data = rows.map(row =>
       Object.fromEntries(headers.map((h, i) => [h, row[i]]))
     );
     return ContentService.createTextOutput(JSON.stringify(data))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

   (If your responses tab isn't named `Form Responses 1`, update that
   string to match.)

3. Click **Deploy → New deployment**.
4. Type: **Web app**.
5. Execute as: **Me**. Who has access: **Anyone**.
6. Click **Deploy**, authorize the script, and copy the URL ending in
   `/exec`.

### Step D — Connect the web map to the API

In `script.js`, find `APPS_SCRIPT_CONFIG` near the bottom of the file and
paste your URL:

```js
const APPS_SCRIPT_CONFIG = {
  url: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  refreshIntervalMs: 30000   // auto-refresh interval, in ms
};
```

Save, refresh the page, and submit a test report through the panel. Within
~30 seconds (or immediately via the ⟳ **Refresh** button) it will appear as:

- A card in the **Community Feedback Dashboard**, with stats updated
- A colour-coded marker on the map (Hospital = red, School = blue,
  Bank = gold, Park = green, Bus Stop = purple)

Clicking a dashboard card zooms to and highlights its marker; clicking a
marker highlights and scrolls to its card. Use the search box, service /
issue / date filters, or the **Clear filters** button to narrow both the
list and the map together.

## Notes

- Leaflet and fonts load from CDNs, so an internet connection is required.
- No database or backend server is used anywhere in this app — the map
  itself, the choropleth layers, and the PPGIS dashboard are all fully
  client-side, backed only by static GeoJSON files and Google's own
  Forms/Sheets/Apps Script infrastructure.
- Choropleth class breaks (5 for Accessibility, 3 for Priority) are computed
  automatically from your data using quantiles, so they'll adapt to
  whatever GN dataset you load.
- If you'd rather not use the live dashboard yet, the app still works fine
  without it — you'll just see a "Live dashboard not connected yet" message
  in the panel until `APPS_SCRIPT_CONFIG.url` is set.

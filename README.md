# Urban Service Inequality — Colombo District

A Leaflet-based web GIS app that maps public-service accessibility and
priority across GN (Grama Niladhari) Divisions in the Colombo District,
with layers for hospitals, schools, banks, parks, and bus stops, plus a
community feedback form.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure — map, sidebar, feedback panel |
| `style.css` | All styling |
| `script.js` | App logic (Leaflet setup, data loading, choropleth, search, feedback form) |
| `data/` | **You provide this** — see below |

## 1. Add your data

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

Browsers block `fetch()` on local GeoJSON files opened directly (`file://`),
so serve the folder over HTTP. From the project folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

(Any static server works — `npx serve`, VS Code's Live Server extension, etc.)

## 3. Community feedback form (optional)

Submitted reports are saved to the visitor's browser via `localStorage`, so
they persist across page reloads and browser restarts **on that device**.
They are not shared across devices/visitors — someone else opening the page
on their own computer won't see reports submitted from yours, and clearing
browser data will clear them.

Reports are also POSTed to a Google Form, configured in `script.js`:

```js
const GOOGLE_FORM_CONFIG = {
  formActionUrl: '...' ,   // your form's /formResponse URL
  entries: {
    gnDivision:    'entry.XXXXXXXXX',
    serviceType:   'entry.XXXXXXXXX',
    issueCategory: 'entry.XXXXXXXXX',
    description:   'entry.XXXXXXXXX',
    location:      'entry.XXXXXXXXX'
  }
};
```

To point this at your own Google Form, open the form's pre-filled link
(3-dot menu → *Get pre-filled link*), fill in placeholder values, copy the
generated `entry.NNNNNNNNN` IDs for each question, and paste them in.
Change `/viewform` to `/formResponse` in the URL for `formActionUrl`.

If you'd rather not use Google Forms at all, you can delete the
`submitToGoogleForm(...)` call in the submit handler — reports will still
appear in the in-page "Your Submitted Reports" list.

**Want one shared list every visitor can see** (not just per-browser)?
That needs reading reports back from somewhere central — e.g. publishing
the linked Google Sheet to the web and fetching it on load — rather than
`localStorage`, which is local to each visitor's browser.

## Notes

- Leaflet and fonts load from CDNs, so an internet connection is required.
- No backend or database is used — everything runs client-side.
- Choropleth class breaks (5 for Accessibility, 3 for Priority) are computed
  automatically from your data using quantiles, so they'll adapt to
  whatever GN dataset you load.

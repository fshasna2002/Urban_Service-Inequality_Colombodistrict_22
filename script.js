/* ==========================================================================
   Urban Service Inequality — Colombo District
   Web GIS Application Logic (Leaflet.js)
   ==========================================================================
   Data expected in /data:
     - Accessibility Index.geojson  (polygons: GN_NAME, POPULATION,
                                      accessibility_index, priority_index)
     - Hospitals.geojson  (points)
     - Schools.geojson    (points)
     - Banks.geojson      (points)
     - Parks.geojson      (points)
     - BusStops.geojson  (points)

   If your file names differ, only the DATA_FILES object below needs to
   change — nothing else in the app depends on the file names.
   ========================================================================== */

/* -------------------------------------------------------------------------
   0. CONFIG
   ------------------------------------------------------------------------- */
const DATA_FILES = {
  gn:        'data/GND_layer_n.geojson',
  Hospitals: 'data/Hospitals.geojson',
  Schools:   'data/Schools.geojson',
  Banks:     'data/Banks.geojson',
  Parks:     'data/Parks.geojson',
  BusStops:  'data/Bus_stops.geojson'
};

// Field names on the gn polygon layer (edit here if your schema differs)
const FIELD = {
  name:        'ADM4_EN',
  population:  'Colombo_GN_Population_Population',
  accessibility: 'AI',
  priority:    'priority_i'
};

// Colors per service layer + a text glyph used inside the marker
const SERVICE_STYLE = {
  Hospitals: { color: '#d7304a', glyph: '+',  label: 'Hospital' },
  Schools:   { color: '#2f6fed', glyph: 'S',  label: 'School' },
  Banks:     { color: '#c99a2e', glyph: '$',  label: 'Bank' },
  Parks:     { color: '#2f9e6b', glyph: '\u2698', label: 'Park' },
  BusStops:  { color: '#8452d5', glyph: '\u2261', label: 'Bus Stop' }
};

// Accessibility Index — 5 class scheme (low -> high = worse -> better)
const ACCESSIBILITY_CLASSES = [
  { label: 'Very Poor', color: '#d7304a' },
  { label: 'Poor',       color: '#f2884f' },
  { label: 'Moderate',   color: '#f5cc5b' },
  { label: 'Good',       color: '#8dc06a' },
  { label: 'Excellent',  color: '#1c8a5c' }
];

// Priority Index — 3 class scheme (low -> high = low -> high priority)
const PRIORITY_CLASSES = [
  { label: 'Low Priority',    color: '#2f9e6b' },
  { label: 'Medium Priority', color: '#ef9d3d' },
  { label: 'High Priority',   color: '#e0433f' }
];

/* -------------------------------------------------------------------------
   1. MAP + BASEMAP
   ------------------------------------------------------------------------- */
const map = L.map('map', {
  zoomControl: false,
  minZoom: 9
}).setView([6.9271, 79.9612], 11); // fallback view; refit once data loads

L.control.zoom({ position: 'bottomright' }).addTo(map);

const osmBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

/* -------------------------------------------------------------------------
   2. STATE
   ------------------------------------------------------------------------- */
let gnLayer = null;              // L.geoJSON layer for GN Divisions (choropleth)
let currentTheme = 'accessibility'; // 'accessibility' | 'priority'
let accBreaks = null;            // computed quantile breaks for accessibility_index
let priBreaks = null;            // computed quantile breaks for priority_index
let allGnFeatures = [];          // cached features for search
let selectedLayer = null;        // currently selected GN polygon (for persistent highlight)

const serviceLayers = {};        // { Hospitals: L.layerGroup, ... }
const serviceCounts = {};        // { Hospitals: 12, ... }

/* -------------------------------------------------------------------------
   3. UTILITIES
   ------------------------------------------------------------------------- */

// Quantile-based class breaks: returns array of upper-bound thresholds
function computeQuantileBreaks(values, numClasses) {
  const sorted = values.filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks = [];
  for (let i = 1; i < numClasses; i++) {
    const idx = Math.floor((i / numClasses) * (sorted.length - 1));
    breaks.push(sorted[idx]);
  }
  breaks.push(sorted[sorted.length - 1]); // final upper bound = max
  return breaks;
}

// Given a value and a breaks array, return the class index (0-based)
function classify(value, breaks) {
  if (value === undefined || value === null || isNaN(value)) return -1;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return i;
  }
  return breaks.length - 1;
}

function getAccessibilityStyle(value) {
  if (!accBreaks) return { color: '#ccc', label: 'No data' };
  const idx = classify(value, accBreaks);
  return idx === -1 ? { color: '#ccc', label: 'No data' } : ACCESSIBILITY_CLASSES[idx];
}

function getPriorityStyle(value) {
  if (!priBreaks) return { color: '#ccc', label: 'No data' };
  const idx = classify(value, priBreaks);
  return idx === -1 ? { color: '#ccc', label: 'No data' } : PRIORITY_CLASSES[idx];
}

function fmtNumber(n, decimals = 2) {
  if (n === undefined || n === null || isNaN(n)) return 'N/A';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function setMapStatus(text, autoHide = false) {
  const el = document.getElementById('mapStatus');
  el.textContent = text;
  el.classList.remove('hidden');
  if (autoHide) {
    setTimeout(() => el.classList.add('hidden'), 1800);
  }
}

/* -------------------------------------------------------------------------
   4. GN DIVISION (CHOROPLETH) LAYER
   ------------------------------------------------------------------------- */

function styleForCurrentTheme(feature) {
  const props = feature.properties || {};
  const value = currentTheme === 'accessibility'
    ? props[FIELD.accessibility]
    : props[FIELD.priority];

  const info = currentTheme === 'accessibility'
    ? getAccessibilityStyle(value)
    : getPriorityStyle(value);

  return {
    fillColor: info.color,
    color: '#ffffff',
    weight: 1,
    fillOpacity: 0.78,
    opacity: 1
  };
}

function buildGnPopupHtml(props) {
  const accInfo = getAccessibilityStyle(props[FIELD.accessibility]);
  const priInfo = getPriorityStyle(props[FIELD.priority]);
  return `
    <div class="popup-title">${props[FIELD.name] ?? 'Unnamed GN Division'}</div>
    <div class="popup-row"><span class="k">Population</span><span class="v">${fmtNumber(props[FIELD.population], 0)}</span></div>
    <div class="popup-row"><span class="k">Accessibility Index</span><span class="v">${fmtNumber(props[FIELD.accessibility])}</span></div>
    <div class="popup-row"><span class="k">Priority Index</span><span class="v">${fmtNumber(props[FIELD.priority])}</span></div>
    <span class="info-badge" style="background:${accInfo.color}">${accInfo.label}</span>
    <span class="info-badge" style="background:${priInfo.color}">${priInfo.label}</span>
  `;
}

function updateInfoPanel(props) {
  const accInfo = getAccessibilityStyle(props[FIELD.accessibility]);
  const priInfo = getPriorityStyle(props[FIELD.priority]);
  document.getElementById('infoBody').innerHTML = `
    <div class="info-row"><span class="k">GN Name</span><span class="v">${props[FIELD.name] ?? 'N/A'}</span></div>
    <div class="info-row"><span class="k">Population</span><span class="v">${fmtNumber(props[FIELD.population], 0)}</span></div>
    <div class="info-row"><span class="k">Accessibility Index</span><span class="v">${fmtNumber(props[FIELD.accessibility])}</span></div>
    <div class="info-row"><span class="k">Priority Index</span><span class="v">${fmtNumber(props[FIELD.priority])}</span></div>
    <span class="info-badge" style="background:${accInfo.color}">${accInfo.label}</span>
    <span class="info-badge" style="background:${priInfo.color}">${priInfo.label}</span>
  `;
}

function onEachGnFeature(feature, layer) {
  layer.bindPopup(buildGnPopupHtml(feature.properties || {}));

  layer.on({
    mouseover: (e) => {
      const l = e.target;
      l.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      l.bringToFront();
      updateInfoPanel(feature.properties || {});
    },
    mouseout: (e) => {
      if (selectedLayer !== e.target) {
        gnLayer.resetStyle(e.target);
      }
    },
    click: (e) => {
      if (selectedLayer) gnLayer.resetStyle(selectedLayer);
      selectedLayer = e.target;
      selectedLayer.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      map.fitBounds(e.target.getBounds(), { maxZoom: 15 });
      updateInfoPanel(feature.properties || {});
    }
  });
}

function loadGnLayer(geojson) {
  allGnFeatures = geojson.features || [];

  // Compute classification breaks once, from the full dataset
  const accValues = allGnFeatures.map(f => f.properties?.[FIELD.accessibility]);
  const priValues = allGnFeatures.map(f => f.properties?.[FIELD.priority]);
  accBreaks = computeQuantileBreaks(accValues, ACCESSIBILITY_CLASSES.length);
  priBreaks = computeQuantileBreaks(priValues, PRIORITY_CLASSES.length);

  gnLayer = L.geoJSON(geojson, {
    style: styleForCurrentTheme,
    onEachFeature: onEachGnFeature
  }).addTo(map);

  // Average accessibility index for the dashboard
  const validAcc = accValues.filter(v => typeof v === 'number' && !isNaN(v));
  const avgAcc = validAcc.length ? validAcc.reduce((a, b) => a + b, 0) / validAcc.length : NaN;
  document.getElementById('statAvgAccessibility').textContent = fmtNumber(avgAcc);

  renderLegend();
  map.fitBounds(gnLayer.getBounds(), { padding: [20, 20] });
}

/* -------------------------------------------------------------------------
   5. LEGEND
   ------------------------------------------------------------------------- */
function renderLegend() {
  const title = document.getElementById('legendTitle');
  const body = document.getElementById('legendBody');
  body.innerHTML = '';

  const classes = currentTheme === 'accessibility' ? ACCESSIBILITY_CLASSES : PRIORITY_CLASSES;
  title.textContent = currentTheme === 'accessibility'
    ? 'Legend — Accessibility Index'
    : 'Legend — Priority Areas';

  classes.forEach(c => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-swatch" style="background:${c.color}"></span><span>${c.label}</span>`;
    body.appendChild(row);
  });

  const note = document.createElement('div');
  note.className = 'legend-note';
  note.textContent = currentTheme === 'accessibility'
    ? 'Classes derived from quantiles of accessibility_index across all GN Divisions.'
    : 'Classes derived from quantiles of priority_index across all GN Divisions.';
  body.appendChild(note);
}

/* -------------------------------------------------------------------------
   6. THEME SWITCH (Accessibility <-> Priority)
   ------------------------------------------------------------------------- */
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');

    currentTheme = btn.dataset.theme;
    if (gnLayer) gnLayer.setStyle(styleForCurrentTheme);
    renderLegend();
  });
});

/* -------------------------------------------------------------------------
   7. SERVICE POINT LAYERS (Hospitals, Schools, Banks, Parks, Bus Stops)
   ------------------------------------------------------------------------- */
function makeServiceIcon(layerKey) {
  const s = SERVICE_STYLE[layerKey];
  return L.divIcon({
    className: 'service-marker',
    html: `<div style="
        background:${s.color};
        width:22px;height:22px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:12px;font-weight:700;
        border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);
      ">${s.glyph}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11]
  });
}

function buildServicePopupHtml(layerKey, props) {
  const s = SERVICE_STYLE[layerKey];
  const name = props.name || props.NAME || props.Name || s.label;
  let rows = '';
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    rows += `<div class="popup-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  });
  return `
    <div class="popup-title">${name}</div>
    ${rows || '<p style="color:#647089;font-size:12px;margin:0;">No additional attributes.</p>'}
    <span class="info-badge" style="background:${s.color}">${s.label}</span>
  `;
}

function loadServiceLayer(layerKey, geojson) {
  const group = L.layerGroup();

  const features = geojson.features || [];
  features.forEach(feature => {
    if (!feature.geometry) return;
    const coordsHandler = (latlng) => L.marker(latlng, { icon: makeServiceIcon(layerKey) });
    const layer = L.geoJSON(feature, { pointToLayer: (f, latlng) => coordsHandler(latlng) });
    layer.eachLayer(l => {
      l.bindPopup(buildServicePopupHtml(layerKey, feature.properties || {}));
      group.addLayer(l);
    });
  });

  serviceLayers[layerKey] = group;
  serviceCounts[layerKey] = features.length;
  group.addTo(map);

  // Update sidebar counters + dashboard stats
  const countEl = document.getElementById(`count-${layerKey}`);
  if (countEl) countEl.textContent = features.length;
  const statEl = document.getElementById(`stat${layerKey}`);
  if (statEl) statEl.textContent = features.length;
}

// Checkbox toggling for each service layer
document.querySelectorAll('#serviceLayerList input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const key = cb.dataset.layer;
    const layer = serviceLayers[key];
    if (!layer) return;
    if (cb.checked) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  });
});

/* -------------------------------------------------------------------------
   8. SEARCH (GN Division by name)
   ------------------------------------------------------------------------- */
const searchInput = document.getElementById('gnSearchInput');
const suggestionsBox = document.getElementById('searchSuggestions');

function renderSuggestions(matches) {
  suggestionsBox.innerHTML = '';
  if (matches.length === 0) {
    suggestionsBox.innerHTML = '<div class="no-results">No matching GN Division</div>';
    suggestionsBox.hidden = false;
    return;
  }
  matches.slice(0, 8).forEach(feature => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = feature.properties[FIELD.name];
    btn.addEventListener('click', () => selectSearchResult(feature));
    suggestionsBox.appendChild(btn);
  });
  suggestionsBox.hidden = false;
}

function selectSearchResult(feature) {
  suggestionsBox.hidden = true;
  searchInput.value = feature.properties[FIELD.name];

  if (!gnLayer) return;
  gnLayer.eachLayer(layer => {
    if (layer.feature === feature) {
      if (selectedLayer) gnLayer.resetStyle(selectedLayer);
      selectedLayer = layer;
      layer.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      map.fitBounds(layer.getBounds(), { maxZoom: 15 });
      layer.openPopup();
      updateInfoPanel(feature.properties || {});
    }
  });
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length === 0) {
    suggestionsBox.hidden = true;
    return;
  }
  const matches = allGnFeatures.filter(f =>
    (f.properties?.[FIELD.name] || '').toLowerCase().includes(q)
  );
  renderSuggestions(matches);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) suggestionsBox.hidden = true;
});

/* -------------------------------------------------------------------------
   9. SIDEBAR TOGGLE (mobile / small screens)
   ------------------------------------------------------------------------- */
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

/* -------------------------------------------------------------------------
   10. DATA LOADING
   ------------------------------------------------------------------------- */
async function fetchGeoJson(path) {
  const res = await fetch(encodeURI(path));
  if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
  return res.json();
}

async function init() {
  setMapStatus('Loading GN Division boundaries…');
  try {
    const gnData = await fetchGeoJson(DATA_FILES.gn);
    loadGnLayer(gnData);
  } catch (err) {
    console.error(err);
    setMapStatus('Could not load Accessibility Index.geojson — check /data folder.');
    return;
  }

  const pointLayers = ['Hospitals', 'Schools', 'Banks', 'Parks', 'BusStops'];
  for (const key of pointLayers) {
    setMapStatus(`Loading ${SERVICE_STYLE[key].label} layer…`);
    try {
      const data = await fetchGeoJson(DATA_FILES[key]);
      loadServiceLayer(key, data);
    } catch (err) {
      console.warn(`Skipping ${key}:`, err.message);
      const countEl = document.getElementById(`count-${key}`);
      if (countEl) countEl.textContent = '0';
    }
  }

  setMapStatus('All layers loaded.', true);
}

init();


/* -------------------------------------------------------------------------
   11. COMMUNITY FEEDBACK PANEL  (NEW SECTION — additive only)
   ------------------------------------------------------------------------- 
   This section is fully self-contained: it does not modify, call, or
   depend on any function/variable above other than the read-only
   SERVICE_STYLE color config (used so report icons match the map legend).

   - No database / backend is used.
   - "Your Submitted Reports" holds only what the visitor submits during
     this browser session (in memory — resets on page reload).
   - The submit button opens a Google Form in a new browser tab.
   ------------------------------------------------------------------------- */

// TODO: replace with your real Google Form URL
const GOOGLE_FORM_URL = 'https://forms.gle/YOUR_GOOGLE_FORM_ID';

/* -------------------------------------------------------------------------
   GOOGLE FORM SUBMISSION CONFIG
   -------------------------------------------------------------------------
   Google Forms will NOT receive any data just from opening the link — the
   values have to be POSTed to the form's specific "entry.XXXXXXXXXX"
   field IDs. Follow these steps once, using YOUR actual form:

   1. Open your Google Form (the edit view), click the 3-dot menu → "Get
      pre-filled link".
   2. Fill in each question with a placeholder value you'll recognise
      (e.g. type "GNDIVISIONTEST" into the GN Division question) and click
      "Get link".
   3. Copy the generated link. It will look like:
      https://docs.google.com/forms/d/e/FORM_ID/viewform?usp=pp_url&entry.111111111=GNDIVISIONTEST&entry.222222222=...
   4. Match each "entry.XXXXXXXXXX=" number to the question it belongs to
      (you'll recognise them from the placeholder values you typed), and
      paste those numbers below.
   5. Set FORM_ACTION_URL to the same link but with "/viewform" changed to
      "/formResponse" (keep the FORM_ID the same).
   ------------------------------------------------------------------------- */
const GOOGLE_FORM_CONFIG = {
  // TODO: paste your form's response endpoint here
  // e.g. 'https://docs.google.com/forms/d/e/1FAIpQLSxxxxxxxxxxxxxxxxxxxx/formResponse'
  formActionUrl: 'https://docs.google.com/forms/u/0/d/e/1FAIpQLSdhZqHQnwJ_VTmfngSdNurf_MrFFtjjBOGGgv1d6SAezps2fw/formResponse',

  // TODO: paste each question's real entry ID (see steps above).
  // Your Google Form should have 7 questions, in this order:
  //   GN Division, Service Type, Issue Category, Description,
  //   Latitude, Longitude, Reporter Name (make this one "not required")
  entries: {
    gnDivision:    'entry.323032994',
    serviceType:   'entry.1615350334',
    issueCategory: 'entry.151701495',
    description:   'entry.283401894',
    location:      'entry.1312166089',
   
  }
};

// Silently POSTs the submitted values to Google Forms via a hidden iframe,
// so the response is actually recorded in your Form/Sheet — no page
// navigation, no visible new tab, no CORS error (the iframe absorbs it).
// NOTE: because the response is cross-origin, the browser can't read
// whether Google accepted it — this is a known/expected limitation of the
// no-backend Google Forms approach. Double check your entry IDs are
// correct by testing once and confirming a new row appears in your Form's
// results.
function submitToGoogleForm(values) {
  if (GOOGLE_FORM_CONFIG.formActionUrl.includes('YOUR_GOOGLE_FORM_ID')) {
    console.warn('Community Feedback: set GOOGLE_FORM_CONFIG.formActionUrl and entry IDs in script.js before this can reach your real Google Form.');
    return;
  }

  let iframe = document.getElementById('hiddenGoogleFormFrame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'hiddenGoogleFormFrame';
    iframe.name = 'hiddenGoogleFormFrame';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  }

  const form = document.createElement('form');
  form.action = GOOGLE_FORM_CONFIG.formActionUrl;
  form.method = 'POST';
  form.target = 'hiddenGoogleFormFrame';

  Object.entries(GOOGLE_FORM_CONFIG.entries).forEach(([fieldKey, entryId]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = entryId;
    input.value = values[fieldKey] ?? '';
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/* --- Optional "pin location on map" control ---
   Clicking the pin button arms one-time map click capture. The next
   click on the map records lat/lng (for demo purposes only — it is not
   sent anywhere) and updates the button label, mirroring the reference
   design's "📍 Location pinned ✓ (click to change)" state. */
let feedbackPinArmed = false;
let feedbackPinnedLatLng = null;
let feedbackPinMarker = null;

const fbPinLocationBtn = document.getElementById('fbPinLocationBtn');
const fbPinLabel = document.getElementById('fbPinLabel');

function setFeedbackPinLabel() {
  if (!fbPinLabel) return;
  if (feedbackPinArmed) {
    fbPinLabel.textContent = '📍 Click anywhere on the map…';
  } else if (feedbackPinnedLatLng) {
    fbPinLabel.textContent = '📍 Location pinned ✓ (click to change)';
    fbPinLocationBtn.classList.add('pinned');
  } else {
    fbPinLabel.textContent = '📍 Pin location on map (optional)';
    fbPinLocationBtn.classList.remove('pinned');
  }
}

if (fbPinLocationBtn) {
  fbPinLocationBtn.addEventListener('click', () => {
    feedbackPinArmed = true;
    setFeedbackPinLabel();
  });
}

// Reuses the existing global `map` instance created earlier in this file
map.on('click', (e) => {
  if (!feedbackPinArmed) return;
  feedbackPinArmed = false;
  feedbackPinnedLatLng = e.latlng;

  if (feedbackPinMarker) map.removeLayer(feedbackPinMarker);
  feedbackPinMarker = L.marker(e.latlng).addTo(map)
    .bindPopup('Pinned feedback location').openPopup();

  setFeedbackPinLabel();
});

function resetFeedbackPin() {
  feedbackPinArmed = false;
  feedbackPinnedLatLng = null;
  if (feedbackPinMarker) {
    map.removeLayer(feedbackPinMarker);
    feedbackPinMarker = null;
  }
  setFeedbackPinLabel();
}

/* --- Submit handling ---
   Collects the form fields, POSTs them to the Google Form (see
   submitToGoogleForm above), then re-polls the live PPGIS dashboard a few
   seconds later so the citizen's own report appears on the map + dashboard
   once Google Forms has written the row into the connected Sheet. */
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
if (submitFeedbackBtn) {
  submitFeedbackBtn.addEventListener('click', () => {
    const gnInput = document.getElementById('fbGnDivision');
    const serviceSelect = document.getElementById('fbServiceType');
    const categorySelect = document.getElementById('fbIssueCategory');
    const descriptionInput = document.getElementById('fbDescription');
    const reporterNameInput = document.getElementById('fbReporterName');

    const gnDivision = gnInput.value.trim();
    const description = descriptionInput.value.trim();

    if (!gnDivision) {
      gnInput.focus();
      setMapStatus('Please enter a GN Division before submitting.', true);
      return;
    }
    if (!description) {
      descriptionInput.focus();
      setMapStatus('Please describe the issue before submitting.', true);
      return;
    }

    // Actually deliver the data to the Google Form (see submitToGoogleForm above)
    submitToGoogleForm({
      gnDivision,
      serviceType: serviceSelect.options[serviceSelect.selectedIndex].text,
      issueCategory: categorySelect.value,
      description,
      latitude: feedbackPinnedLatLng ? feedbackPinnedLatLng.lat.toFixed(6) : '',
      longitude: feedbackPinnedLatLng ? feedbackPinnedLatLng.lng.toFixed(6) : '',
      reporterName: reporterNameInput.value.trim()
    });

    // Reset the form for the next entry
    gnInput.value = '';
    descriptionInput.value = '';
    reporterNameInput.value = '';
    serviceSelect.selectedIndex = 0;
    categorySelect.selectedIndex = 0;
    resetFeedbackPin();

    setMapStatus('Feedback submitted — syncing to the dashboard…', true);

    // Google Forms/Sheets needs a moment to write the row, so give it a
    // few seconds before pulling the live data again.
    setTimeout(() => fetchLiveReports(), 4000);
  });
}

// Mobile toggle for the Community Feedback panel (mirrors #sidebarToggle behavior)
const feedbackToggleBtn = document.getElementById('feedbackToggle');
if (feedbackToggleBtn) {
  feedbackToggleBtn.addEventListener('click', () => {
    document.getElementById('feedbackPanel').classList.toggle('open');
  });
}


/* -------------------------------------------------------------------------
   12. PPGIS COMMUNITY FEEDBACK DASHBOARD  (live Google Sheets data)
   -------------------------------------------------------------------------
   Fully additive: reads from a published Google Apps Script Web App that
   returns your Feedback Google Sheet as JSON, then renders:
     - dashboard stats
     - filterable, scrollable report cards
     - colour-coded map markers (one per report)
     - two-way click sync between cards and markers
     - auto-refresh every 30s + manual refresh button

   Nothing in this section modifies gnLayer, serviceLayers, search, legend,
   or the accessibility/priority choropleths above.
   ------------------------------------------------------------------------- */

// TODO: paste your published Apps Script Web App URL here.
// Deploy -> Web App -> "Anyone" access -> copy the URL ending in /exec
const APPS_SCRIPT_CONFIG = {
  url: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  refreshIntervalMs: 30000
};

// Dedicated layer group for live citizen reports (kept separate from the
// Hospitals/Schools/Banks/Parks/BusStops facility layers above).
const ppgisMarkersLayer = L.layerGroup().addTo(map);

let PPGIS_REPORTS = [];       // normalized reports, newest first
let ppgisMarkersById = {};    // { reportId: L.marker }
let ppgisActiveReportId = null;
let ppgisAutoRefreshTimer = null;
let ppgisIsFetching = false;

const PPGIS_FILTERS = { search: '', service: '', issue: '', date: '' };

// Accepts several possible header spellings so this works whether your
// Apps Script echoes back the exact Google Form question titles or a
// cleaned-up JSON key. Add more aliases here if your sheet headers differ.
const PPGIS_FIELD_ALIASES = {
  gnDivision:    ['GN Division', 'gnDivision', 'GN_Division', 'GNDivision'],
  serviceType:   ['Service Type', 'serviceType', 'Service'],
  issueCategory: ['Issue Category', 'issueCategory', 'Issue Type', 'Category'],
  description:   ['Description', 'description', 'Details'],
  latitude:      ['Latitude', 'latitude', 'Lat'],
  longitude:     ['Longitude', 'longitude', 'Lng', 'Lon'],
  reporterName:  ['Reporter Name', 'reporterName', 'Name'],
  timestamp:     ['Timestamp', 'timestamp', 'Date', 'Submitted']
};

function ppgisPick(row, aliasKey) {
  const aliases = PPGIS_FIELD_ALIASES[aliasKey] || [];
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

// Maps a free-typed Service Type value (e.g. "Hospital" from the Form's
// visible option text) back to the SERVICE_STYLE / DATA_FILES key
// (e.g. "Hospitals") so colors/icons match the rest of the app.
function ppgisNormalizeServiceKey(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('hospital')) return 'Hospitals';
  if (s.startsWith('school')) return 'Schools';
  if (s.startsWith('bank')) return 'Banks';
  if (s.startsWith('park')) return 'Parks';
  if (s.startsWith('bus')) return 'BusStops';
  return 'Hospitals';
}

function ppgisParseRow(row, index) {
  const lat = parseFloat(ppgisPick(row, 'latitude'));
  const lng = parseFloat(ppgisPick(row, 'longitude'));
  const rawTimestamp = ppgisPick(row, 'timestamp');
  const parsedDate = rawTimestamp ? new Date(rawTimestamp) : null;
  const validDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null;

  return {
    id: `ppgis-${index}-${rawTimestamp || ''}`,
    gnDivision: String(ppgisPick(row, 'gnDivision') || 'Unspecified'),
    service: ppgisNormalizeServiceKey(ppgisPick(row, 'serviceType')),
    serviceRaw: String(ppgisPick(row, 'serviceType') || ''),
    issueCategory: String(ppgisPick(row, 'issueCategory') || 'Other'),
    description: String(ppgisPick(row, 'description') || ''),
    reporterName: String(ppgisPick(row, 'reporterName') || 'Anonymous'),
    lat: isNaN(lat) ? null : lat,
    lng: isNaN(lng) ? null : lng,
    date: validDate,
    dateLabel: validDate
      ? validDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Unknown date'
  };
}

/* -------------------------- Fetch live data -------------------------- */
async function fetchLiveReports() {
  if (APPS_SCRIPT_CONFIG.url.includes('YOUR_DEPLOYMENT_ID')) {
    ppgisRenderListStatus(
      'Live dashboard not connected yet — paste your Apps Script Web App URL into APPS_SCRIPT_CONFIG.url in script.js.',
      true
    );
    return;
  }
  if (ppgisIsFetching) return;
  ppgisIsFetching = true;

  const refreshBtn = document.getElementById('ppgisRefreshBtn');
  if (refreshBtn) refreshBtn.classList.add('is-spinning');

  try {
    const res = await fetch(APPS_SCRIPT_CONFIG.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Accepts either a raw array of rows, or { reports: [...] } / { data: [...] }
    const rows = Array.isArray(data) ? data : (data.reports || data.data || []);

    PPGIS_REPORTS = rows
      .map((row, i) => ppgisParseRow(row, i))
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

    const stamp = document.getElementById('ppgisLastUpdated');
    if (stamp) stamp.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    ppgisRebuildMarkers();
    ppgisApplyFilters();
  } catch (err) {
    console.error('PPGIS live fetch failed:', err);
    ppgisRenderListStatus('Could not load live reports. Check the Apps Script URL and that it is deployed for "Anyone" access.', true);
  } finally {
    ppgisIsFetching = false;
    if (refreshBtn) setTimeout(() => refreshBtn.classList.remove('is-spinning'), 400);
  }
}

/* -------------------------- Stats -------------------------- */
function ppgisRenderStats(reports) {
  const counts = { Hospitals: 0, Schools: 0, Banks: 0, Parks: 0, BusStops: 0 };
  reports.forEach(r => { if (counts[r.service] !== undefined) counts[r.service]++; });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ppgisStatTotal', reports.length);
  set('ppgisStatHospitals', counts.Hospitals);
  set('ppgisStatSchools', counts.Schools);
  set('ppgisStatBanks', counts.Banks);
  set('ppgisStatParks', counts.Parks);
  set('ppgisStatBusStops', counts.BusStops);
  set('ppgisStatNewest', reports.length && reports[0].date ? reports[0].dateLabel : '–');
}

/* -------------------------- Filtering -------------------------- */
function ppgisApplyFilters() {
  const { search, service, issue, date } = PPGIS_FILTERS;
  const filtered = PPGIS_REPORTS.filter(r => {
    if (service && r.service !== service) return false;
    if (issue && r.issueCategory !== issue) return false;
    if (date && r.date) {
      const iso = r.date.toISOString().slice(0, 10);
      if (iso !== date) return false;
    }
    if (search) {
      const haystack = `${r.gnDivision} ${r.description}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  ppgisRenderStats(PPGIS_REPORTS); // stats always reflect the full live dataset
  ppgisRenderCards(filtered);
  ppgisSyncMarkerVisibility(filtered);
}

/* -------------------------- Dashboard cards -------------------------- */
function ppgisRenderListStatus(message, isError = false) {
  const list = document.getElementById('ppgisReportList');
  if (!list) return;
  list.innerHTML = `<p class="ppgis-list-status${isError ? ' is-error' : ''}">${message}</p>`;
}

function ppgisBuildCardHtml(report) {
  const style = SERVICE_STYLE[report.service] || { color: '#647089', glyph: '?', label: report.serviceRaw };
  const isActive = report.id === ppgisActiveReportId;
  return `
    <div class="ppgis-card${isActive ? ' ppgis-card-active' : ''}" data-report-id="${report.id}" style="border-left-color:${style.color}">
      <div class="ppgis-card-icon" style="background:${style.color}">${style.glyph}</div>
      <div class="ppgis-card-body">
        <div class="ppgis-card-top-row">
          <span class="ppgis-card-gn">📍 ${report.gnDivision}</span>
          <span class="ppgis-card-service-badge" style="background:${style.color}">🔧 ${style.label}</span>
        </div>
        <div class="ppgis-card-category">🗂 ${report.issueCategory}</div>
        <p class="ppgis-card-desc">📝 ${report.description || 'No description provided.'}</p>
        <div class="ppgis-card-meta">
          <span>👤 ${report.reporterName}</span>
          <span>🕒 ${report.dateLabel}</span>
          ${report.lat !== null && report.lng !== null
            ? `<span>📍 ${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}</span>`
            : ''}
        </div>
      </div>
    </div>
  `;
}

function ppgisRenderCards(reports) {
  const list = document.getElementById('ppgisReportList');
  if (!list) return;

  if (reports.length === 0) {
    ppgisRenderListStatus(
      PPGIS_REPORTS.length === 0
        ? 'No community reports yet. Submitted reports will appear here automatically.'
        : 'No reports match the current filters.'
    );
    return;
  }

  list.innerHTML = reports.map(ppgisBuildCardHtml).join('');

  list.querySelectorAll('.ppgis-card').forEach(card => {
    card.addEventListener('click', () => {
      ppgisSelectReport(card.dataset.reportId, { panTo: true, scrollCard: false });
    });
  });
}

/* -------------------------- Map markers -------------------------- */
function ppgisMakePinIcon(serviceKey, active = false) {
  const style = SERVICE_STYLE[serviceKey] || { color: '#647089', glyph: '?' };
  const svg = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 21 13 21s13-11.5 13-21C26 5.8 20.2 0 13 0z" fill="${style.color}" stroke="#fff" stroke-width="2"/>
      <circle cx="13" cy="13" r="7.5" fill="#fff" opacity="0.92"/>
      <text x="13" y="17.5" text-anchor="middle" font-size="11" font-weight="700" font-family="Inter, sans-serif" fill="${style.color}">${style.glyph}</text>
    </svg>`;
  return L.divIcon({
    className: `ppgis-marker-pin${active ? ' ppgis-marker-active' : ''}`,
    html: svg,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30]
  });
}

function ppgisBuildPopupHtml(report) {
  const style = SERVICE_STYLE[report.service] || { color: '#647089', label: report.serviceRaw };
  return `
    <div class="popup-title">${report.gnDivision}</div>
    <div class="popup-row"><span class="k">Service</span><span class="v">${style.label || report.serviceRaw}</span></div>
    <div class="popup-row"><span class="k">Reporter</span><span class="v">${report.reporterName}</span></div>
    <div class="popup-row"><span class="k">Issue</span><span class="v">${report.issueCategory}</span></div>
    <div class="popup-row"><span class="k">Coordinates</span><span class="v">${report.lat !== null ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}` : 'N/A'}</span></div>
    <div class="popup-row"><span class="k">Date</span><span class="v">${report.dateLabel}</span></div>
    <p style="margin:8px 0 0;font-size:12.5px;color:#647089;">${report.description || ''}</p>
    <span class="info-badge" style="background:${style.color}">${style.label || report.serviceRaw}</span>
  `;
}

function ppgisRebuildMarkers() {
  ppgisMarkersLayer.clearLayers();
  ppgisMarkersById = {};

  PPGIS_REPORTS.forEach(report => {
    if (report.lat === null || report.lng === null) return; // skip reports with no coordinates

    const marker = L.marker([report.lat, report.lng], {
      icon: ppgisMakePinIcon(report.service, report.id === ppgisActiveReportId)
    });
    marker.bindPopup(ppgisBuildPopupHtml(report));
    marker.on('click', () => {
      ppgisSelectReport(report.id, { panTo: false, scrollCard: true });
      marker.openPopup();
    });

    ppgisMarkersById[report.id] = marker;
    ppgisMarkersLayer.addLayer(marker);
  });
}

// Shows/hides markers to match the currently filtered card list, without
// tearing down and rebuilding every marker (cheaper on rapid filter typing).
function ppgisSyncMarkerVisibility(filteredReports) {
  const visibleIds = new Set(filteredReports.map(r => r.id));
  Object.entries(ppgisMarkersById).forEach(([id, marker]) => {
    const shouldShow = visibleIds.has(id);
    const isShown = ppgisMarkersLayer.hasLayer(marker);
    if (shouldShow && !isShown) ppgisMarkersLayer.addLayer(marker);
    if (!shouldShow && isShown) ppgisMarkersLayer.removeLayer(marker);
  });
}

/* -------------------------- Dashboard <-> Map sync -------------------------- */
function ppgisSelectReport(reportId, { panTo = false, scrollCard = false } = {}) {
  ppgisActiveReportId = reportId;
  const report = PPGIS_REPORTS.find(r => r.id === reportId);
  if (!report) return;

  // Highlight the matching dashboard card
  document.querySelectorAll('.ppgis-card').forEach(card => {
    card.classList.toggle('ppgis-card-active', card.dataset.reportId === reportId);
  });

  // Re-icon the active marker so it visually stands out
  Object.entries(ppgisMarkersById).forEach(([id, marker]) => {
    marker.setIcon(ppgisMakePinIcon(
      PPGIS_REPORTS.find(r => r.id === id)?.service,
      id === reportId
    ));
  });

  const marker = ppgisMarkersById[reportId];
  if (marker) {
    if (panTo && report.lat !== null && report.lng !== null) {
      map.flyTo([report.lat, report.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    }
    marker.openPopup();
  }

  if (scrollCard) {
    const cardEl = document.querySelector(`.ppgis-card[data-report-id="${reportId}"]`);
    if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* -------------------------- Filter control wiring -------------------------- */
const ppgisFilterSearch = document.getElementById('ppgisFilterSearch');
const ppgisFilterService = document.getElementById('ppgisFilterService');
const ppgisFilterIssue = document.getElementById('ppgisFilterIssue');
const ppgisFilterDate = document.getElementById('ppgisFilterDate');
const ppgisFilterClear = document.getElementById('ppgisFilterClear');

if (ppgisFilterSearch) {
  ppgisFilterSearch.addEventListener('input', () => {
    PPGIS_FILTERS.search = ppgisFilterSearch.value.trim();
    ppgisApplyFilters();
  });
}
if (ppgisFilterService) {
  ppgisFilterService.addEventListener('change', () => {
    PPGIS_FILTERS.service = ppgisFilterService.value;
    ppgisApplyFilters();
  });
}
if (ppgisFilterIssue) {
  ppgisFilterIssue.addEventListener('change', () => {
    PPGIS_FILTERS.issue = ppgisFilterIssue.value;
    ppgisApplyFilters();
  });
}
if (ppgisFilterDate) {
  ppgisFilterDate.addEventListener('change', () => {
    PPGIS_FILTERS.date = ppgisFilterDate.value;
    ppgisApplyFilters();
  });
}
if (ppgisFilterClear) {
  ppgisFilterClear.addEventListener('click', () => {
    PPGIS_FILTERS.search = '';
    PPGIS_FILTERS.service = '';
    PPGIS_FILTERS.issue = '';
    PPGIS_FILTERS.date = '';
    if (ppgisFilterSearch) ppgisFilterSearch.value = '';
    if (ppgisFilterService) ppgisFilterService.value = '';
    if (ppgisFilterIssue) ppgisFilterIssue.value = '';
    if (ppgisFilterDate) ppgisFilterDate.value = '';
    ppgisApplyFilters();
  });
}

/* -------------------------- Refresh controls -------------------------- */
const ppgisRefreshBtn = document.getElementById('ppgisRefreshBtn');
if (ppgisRefreshBtn) {
  ppgisRefreshBtn.addEventListener('click', () => fetchLiveReports());
}

const ppgisAutoRefreshToggle = document.getElementById('ppgisAutoRefreshToggle');
function ppgisStartAutoRefresh() {
  if (ppgisAutoRefreshTimer) clearInterval(ppgisAutoRefreshTimer);
  ppgisAutoRefreshTimer = setInterval(() => fetchLiveReports(), APPS_SCRIPT_CONFIG.refreshIntervalMs);
}
function ppgisStopAutoRefresh() {
  if (ppgisAutoRefreshTimer) clearInterval(ppgisAutoRefreshTimer);
  ppgisAutoRefreshTimer = null;
}
if (ppgisAutoRefreshToggle) {
  ppgisAutoRefreshToggle.addEventListener('change', () => {
    if (ppgisAutoRefreshToggle.checked) ppgisStartAutoRefresh();
    else ppgisStopAutoRefresh();
  });
}

/* -------------------------- Init -------------------------- */
fetchLiveReports();
ppgisStartAutoRefresh();

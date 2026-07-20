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

  // TODO: paste each question's real entry ID (see steps above)
  entries: {
    gnDivision:    'entry.323032994',
    serviceType:   'entry.1615350334',
    issueCategory: 'entry.151701495',
    description:   'entry.283401894',
    location:      'entry.1312166089'  // add a "Location" question in your form for this
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

// Reports submitted by this visitor, persisted permanently in the
// browser's localStorage — they survive page reloads and browser restarts
// on this device. (They are also POSTed to the Google Form for the
// official/shared record — see submitToGoogleForm below.)
const FEEDBACK_STORAGE_KEY = 'communityFeedbackReports';

function loadStoredReports() {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Could not read saved feedback reports:', err);
    return [];
  }
}

function saveStoredReports() {
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(SUBMITTED_FEEDBACK_REPORTS));
  } catch (err) {
    console.warn('Could not save feedback reports:', err);
  }
}

const SUBMITTED_FEEDBACK_REPORTS = loadStoredReports();

// Build one report card's HTML using the same colors/glyphs as the map layers
function buildFeedbackCardHtml(report, isNew = false) {
  const style = SERVICE_STYLE[report.service] || { color: '#647089', glyph: '?', label: report.service };
  return `
    <div class="feedback-card${isNew ? ' feedback-card-new' : ''}">
      <div class="feedback-card-icon" style="background:${style.color}">${style.glyph}</div>
      <div class="feedback-card-body">
        <div class="fc-top-row">
          <span class="fc-gn">${report.gnDivision}</span>
          <span class="fc-service-badge" style="background:${style.color}">${style.label}</span>
        </div>
        <p class="fc-issue">&ldquo;${report.issue}&rdquo;</p>
        <span class="fc-date">Submitted: ${report.submitted}</span>
        ${isNew ? '<span class="fc-new-badge">New</span>' : ''}
      </div>
    </div>
  `;
}

// Renders the "Your Submitted Reports" space — starts empty with a
// placeholder note, then fills in as the visitor submits the form.
function renderSubmittedFeedbackReports() {
  const list = document.getElementById('newFeedbackReportList');
  if (!list) return;

  if (SUBMITTED_FEEDBACK_REPORTS.length === 0) {
    list.innerHTML = `
      <p class="feedback-empty-note" id="newFeedbackEmptyNote">
        Reports you submit above will appear here.
      </p>
    `;
    return;
  }

  list.innerHTML = SUBMITTED_FEEDBACK_REPORTS.map(r => buildFeedbackCardHtml(r, true)).join('');
}

function fmtFeedbackDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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
   Collects the form fields, prepends a new card to the (in-memory only)
   report list so the demo feels alive, clears the form, then opens the
   Google Form in a new tab for the actual/official submission. */
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
if (submitFeedbackBtn) {
  submitFeedbackBtn.addEventListener('click', () => {
    const gnInput = document.getElementById('fbGnDivision');
    const serviceSelect = document.getElementById('fbServiceType');
    const categorySelect = document.getElementById('fbIssueCategory');
    const descriptionInput = document.getElementById('fbDescription');

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

    const newReport = {
      gnDivision,
      service: serviceSelect.value,
      issue: `${categorySelect.value}: ${description}`,
      submitted: fmtFeedbackDate(new Date())
    };

    SUBMITTED_FEEDBACK_REPORTS.unshift(newReport);
    saveStoredReports();
    renderSubmittedFeedbackReports();

    // Actually deliver the data to the Google Form (see submitToGoogleForm below)
    submitToGoogleForm({
      gnDivision,
      serviceType: serviceSelect.options[serviceSelect.selectedIndex].text,
      issueCategory: categorySelect.value,
      description,
      location: feedbackPinnedLatLng
        ? `${feedbackPinnedLatLng.lat.toFixed(6)}, ${feedbackPinnedLatLng.lng.toFixed(6)}`
        : 'Not specified'
    });

    // Reset the form for the next entry
    gnInput.value = '';
    descriptionInput.value = '';
    serviceSelect.selectedIndex = 0;
    categorySelect.selectedIndex = 0;
    resetFeedbackPin();

    setMapStatus('Feedback submitted — sent to the Google Form ✓', true);
  });
}

// Mobile toggle for the Community Feedback panel (mirrors #sidebarToggle behavior)
const feedbackToggleBtn = document.getElementById('feedbackToggle');
if (feedbackToggleBtn) {
  feedbackToggleBtn.addEventListener('click', () => {
    document.getElementById('feedbackPanel').classList.toggle('open');
  });
}

renderSubmittedFeedbackReports();


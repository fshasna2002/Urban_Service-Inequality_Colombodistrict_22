/* ==========================================================================
   Urban Service Inequality — Colombo District
   Web GIS Application Logic (Leaflet.js)
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

const FIELD = {
  name:          'ADM4_EN',
  population:    'Colombo_GN_Population_Population',
  accessibility: 'AI',
  priority:      'priority_i'
};

const SERVICE_STYLE = {
  Hospitals: { color: '#d7304a', glyph: '+',  label: 'Hospital' },
  Schools:   { color: '#2f6fed', glyph: 'S',  label: 'School' },
  Banks:     { color: '#c99a2e', glyph: '$',  label: 'Bank' },
  Parks:     { color: '#2f9e6b', glyph: '\u2698', label: 'Park' },
  BusStops:  { color: '#8452d5', glyph: '\u2261', label: 'Bus Stop' }
};

const ACCESSIBILITY_CLASSES = [
  { label: 'Very Poor', color: '#d7304a' },
  { label: 'Poor',       color: '#f2884f' },
  { label: 'Moderate',   color: '#f5cc5b' },
  { label: 'Good',       color: '#8dc06a' },
  { label: 'Excellent',  color: '#1c8a5c' }
];

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
}).setView([6.9271, 79.9612], 11);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const osmBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

/* -------------------------------------------------------------------------
   2. STATE
   ------------------------------------------------------------------------- */
let gnLayer = null;
let currentTheme = 'accessibility';
let accBreaks = null;
let priBreaks = null;
let allGnFeatures = [];
let selectedLayer = null;

const serviceLayers = {};
const serviceCounts = {};

/* -------------------------------------------------------------------------
   3. UTILITIES
   ------------------------------------------------------------------------- */
function computeQuantileBreaks(values, numClasses) {
  const sorted = values.filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks = [];
  for (let i = 1; i < numClasses; i++) {
    const idx = Math.floor((i / numClasses) * (sorted.length - 1));
    breaks.push(sorted[idx]);
  }
  breaks.push(sorted[sorted.length - 1]);
  return breaks;
}

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
  if(!el) return;
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
  const value = currentTheme === 'accessibility' ? props[FIELD.accessibility] : props[FIELD.priority];
  const info = currentTheme === 'accessibility' ? getAccessibilityStyle(value) : getPriorityStyle(value);

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
  const infoEl = document.getElementById('infoBody');
  if(!infoEl) return;
  infoEl.innerHTML = `
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
  const accValues = allGnFeatures.map(f => f.properties?.[FIELD.accessibility]);
  const priValues = allGnFeatures.map(f => f.properties?.[FIELD.priority]);
  accBreaks = computeQuantileBreaks(accValues, ACCESSIBILITY_CLASSES.length);
  priBreaks = computeQuantileBreaks(priValues, PRIORITY_CLASSES.length);

  gnLayer = L.geoJSON(geojson, {
    style: styleForCurrentTheme,
    onEachFeature: onEachGnFeature
  }).addTo(map);

  const validAcc = accValues.filter(v => typeof v === 'number' && !isNaN(v));
  const avgAcc = validAcc.length ? validAcc.reduce((a, b) => a + b, 0) / validAcc.length : NaN;
  const avgEl = document.getElementById('statAvgAccessibility');
  if(avgEl) avgEl.textContent = fmtNumber(avgAcc);

  renderLegend();
  map.fitBounds(gnLayer.getBounds(), { padding: [20, 20] });
}

/* -------------------------------------------------------------------------
   5. LEGEND
   ------------------------------------------------------------------------- */
function renderLegend() {
  const title = document.getElementById('legendTitle');
  const body = document.getElementById('legendBody');
  if(!body) return;
  body.innerHTML = '';

  const classes = currentTheme === 'accessibility' ? ACCESSIBILITY_CLASSES : PRIORITY_CLASSES;
  if(title) {
    title.textContent = currentTheme === 'accessibility' ? 'Legend — Accessibility Index' : 'Legend — Priority Areas';
  }

  classes.forEach(c => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-swatch" style="background:${c.color}"></span><span>${c.label}</span>`;
    body.appendChild(row);
  });
}

/* -------------------------------------------------------------------------
   6. THEME SWITCH
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
   7. SERVICE POINT LAYERS
   ------------------------------------------------------------------------- */
function makeServiceIcon(layerKey) {
  const s = SERVICE_STYLE[layerKey];
  return L.divIcon({
    className: 'service-marker',
    html: `<div style="background:${s.color}; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:700; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.35);">${s.glyph}</div>`,
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
  return `<div class="popup-title">${name}</div>${rows}<span class="info-badge" style="background:${s.color}">${s.label}</span>`;
}

function loadServiceLayer(layerKey, geojson) {
  const group = L.layerGroup();
  const features = geojson.features || [];
  
  features.forEach(feature => {
    if (!feature.geometry) return;
    const marker = L.geoJSON(feature, {
      pointToLayer: (f, latlng) => L.marker(latlng, { icon: makeServiceIcon(layerKey) })
    });
    marker.eachLayer(l => {
      l.bindPopup(buildServicePopupHtml(layerKey, feature.properties || {}));
      group.addLayer(l);
    });
  });

  serviceLayers[layerKey] = group;
  serviceCounts[layerKey] = features.length;
  group.addTo(map);

  const countEl = document.getElementById(`count-${layerKey}`);
  if (countEl) countEl.textContent = features.length;
  const statEl = document.getElementById(`stat${layerKey}`);
  if (statEl) statEl.textContent = features.length;
}

document.querySelectorAll('#serviceLayerList input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const key = cb.dataset.layer;
    const layer = serviceLayers[key];
    if (!layer) return;
    if (cb.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
});

/* -------------------------------------------------------------------------
   8. SEARCH (GN Division)
   ------------------------------------------------------------------------- */
const searchInput = document.getElementById('gnSearchInput');
const suggestionsBox = document.getElementById('searchSuggestions');

function renderSuggestions(matches) {
  if(!suggestionsBox) return;
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
  if(suggestionsBox) suggestionsBox.hidden = true;
  if(searchInput) searchInput.value = feature.properties[FIELD.name];

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

if(searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length === 0) {
      if(suggestionsBox) suggestionsBox.hidden = true;
      return;
    }
    const matches = allGnFeatures.filter(f => (f.properties?.[FIELD.name] || '').toLowerCase().includes(q));
    renderSuggestions(matches);
  });
}

document.addEventListener('click', (e) => {
  if (suggestionsBox && !e.target.closest('.search-box')) suggestionsBox.hidden = true;
});

/* -------------------------------------------------------------------------
   9. SIDEBAR TOGGLES
   ------------------------------------------------------------------------- */
const sbToggle = document.getElementById('sidebarToggle');
if(sbToggle) {
  sbToggle.addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    if(sb) sb.classList.toggle('open');
  });
}

/* -------------------------------------------------------------------------
   10. DATA LOADING
   ------------------------------------------------------------------------- */
async function fetchGeoJson(path) {
  const res = await fetch(encodeURI(path));
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function init() {
  setMapStatus('Loading GN Division boundaries…');
  try {
    const gnData = await fetchGeoJson(DATA_FILES.gn);
    loadGnLayer(gnData);
  } catch (err) {
    console.error(err);
    setMapStatus('Could not load GN Layer boundaries.', false);
    return;
  }

  const pointLayers = ['Hospitals', 'Schools', 'Banks', 'Parks', 'BusStops'];
  for (const key of pointLayers) {
    try {
      const data = await fetchGeoJson(DATA_FILES[key]);
      loadServiceLayer(key, data);
    } catch (err) {
      console.warn(`Skipping layer ${key}:`, err.message);
    }
  }
  setMapStatus('All layers loaded.', true);
}

init();

/* -------------------------------------------------------------------------
   11. COMMUNITY FEEDBACK PANEL (Direct Forms Hook & Dynamic Map Plots)
   ------------------------------------------------------------------------- */
const FEEDBACK_STORAGE_KEY = 'communityFeedbackReports';
let clickReportMarker = null;

const FEEDBACK_MARKER_STYLE = {
  color: '#e65100', 
  glyph: '⭐'
};

function loadStoredReports() {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) { return []; }
}

function saveStoredReports() {
  localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(SUBMITTED_FEEDBACK_REPORTS));
}

const SUBMITTED_FEEDBACK_REPORTS = loadStoredReports();

function buildFeedbackCardHtml(report, index) {
  const style = SERVICE_STYLE[report.service] || { color: '#647089', glyph: '?', label: report.service };
  const latAttr = report.lat ? `data-lat="${report.lat}"` : '';
  const lngAttr = report.lng ? `data-lng="${report.lng}"` : '';
  
  return `
    <div class="feedback-card clickable-report" data-index="${index}" ${latAttr} ${lngAttr} 
         style="cursor: pointer; padding: 12px; margin-top: 8px; border-radius: 6px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; gap: 10px;">
      <div class="feedback-card-icon" style="background:${style.color}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight:bold;">${style.glyph}</div>
      <div class="feedback-card-body" style="flex: 1;">
        <div class="fc-top-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
          <span class="fc-gn" style="font-weight: 700; font-size: 12px; color: #1e293b;">${report.gnDivision}</span>
          <span class="fc-service-badge" style="background:${style.color}; color: #fff; font-size: 9px; padding: 2px 5px; border-radius: 4px;">${style.label}</span>
        </div>
        <p class="fc-issue" style="margin: 0 0 4px 0; font-size: 11px; color: #475569;">&ldquo;${report.issue}&rdquo;</p>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="fc-date" style="font-size: 10px; color: #94a3b8;">${report.submitted}</span>
          ${report.lat ? `<span style="font-size: 10px; color: ${FEEDBACK_MARKER_STYLE.color}; font-weight: 600;">📍 Map View</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderSubmittedFeedbackReports() {
  const list = document.getElementById('newFeedbackReportList');
  if (!list) return;

  if (SUBMITTED_FEEDBACK_REPORTS.length === 0) {
    list.innerHTML = `<p style="font-size: 11px; color: #64748b; text-align: center; padding: 15px 0;">Logged reports will appear here.</p>`;
    return;
  }

  list.innerHTML = SUBMITTED_FEEDBACK_REPORTS.map((r, idx) => buildFeedbackCardHtml(r, idx)).join('');
  attachReportClickEvents();
}

function attachReportClickEvents() {
  document.querySelectorAll('.clickable-report').forEach(card => {
    card.addEventListener('click', () => {
      const lat = parseFloat(card.getAttribute('data-lat'));
      const lng = parseFloat(card.getAttribute('data-lng'));
      if (isNaN(lat) || isNaN(lng)) return;

      if (clickReportMarker) map.removeLayer(clickReportMarker);

      const uniqueIcon = L.divIcon({
        className: 'submitted-report-marker',
        html: `<div style="background: ${FEEDBACK_MARKER_STYLE.color}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; border: 2px solid #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${FEEDBACK_MARKER_STYLE.glyph}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const rData = SUBMITTED_FEEDBACK_REPORTS[card.getAttribute('data-index')];
      clickReportMarker = L.marker([lat, lng], { icon: uniqueIcon }).addTo(map);
      clickReportMarker.bindPopup(`<b>${rData.gnDivision}</b><br>${rData.issue}`).openPopup();
      map.setView([lat, lng], 15);
    });
  });
}

/* --- Map Pin Management --- */
let feedbackPinArmed = false;
let feedbackPinnedLatLng = null;
let feedbackPinMarker = null;
const fbPinLocationBtn = document.getElementById('fbPinLocationBtn');
const fbPinLabel = document.getElementById('fbPinLabel');

if (fbPinLocationBtn) {
  fbPinLocationBtn.addEventListener('click', () => {
    feedbackPinArmed = true;
    if (fbPinLabel) fbPinLabel.textContent = '📍 Click anywhere on the map…';
  });
}

map.on('click', (e) => {
  if (!feedbackPinArmed) return;
  feedbackPinArmed = false;
  feedbackPinnedLatLng = e.latlng;

  document.getElementById('fbLatHidden').value = e.latlng.lat;
  document.getElementById('fbLngHidden').value = e.latlng.lng;

  if (feedbackPinMarker) map.removeLayer(feedbackPinMarker);
  feedbackPinMarker = L.marker(e.latlng).addTo(map).bindPopup('Pinned Location').openPopup();

  if (fbPinLabel) fbPinLabel.textContent = '📍 Location pinned ✓';
  if (fbPinLocationBtn) fbPinLocationBtn.classList.add('pinned');
});

/* --- Form Submit Interception --- */
const feedbackForm = document.getElementById('customFeedbackForm');
if (feedbackForm) {
  feedbackForm.addEventListener('submit', (e) => {
    const gnDivision = document.getElementById('fbGnDivision').value;
    const service = document.getElementById('fbServiceType').value;
    const category = document.getElementById('fbIssueCategory').value;
    const description = document.getElementById('fbDescription').value;

    const newReport = {
      gnDivision,
      service,
      issue: `${category}: ${description}`,
      submitted: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      lat: feedbackPinnedLatLng ? feedbackPinnedLatLng.lat : null,
      lng: feedbackPinnedLatLng ? feedbackPinnedLatLng.lng : null
    };

    SUBMITTED_FEEDBACK_REPORTS.unshift(newReport);
    saveStoredReports();
    renderSubmittedFeedbackReports();

    setTimeout(() => {
      feedbackForm.reset();
      feedbackPinnedLatLng = null;
      if (feedbackPinMarker) map.removeLayer(feedbackPinMarker);
      if (fbPinLabel) fbPinLabel.textContent = '📍 Pin location on map (optional)';
      if (fbPinLocationBtn) fbPinLocationBtn.classList.remove('pinned');
      setMapStatus('Report submitted and saved to database successfully!', true);
    }, 200);
  });
}

const feedbackToggleBtn = document.getElementById('feedbackToggle');
if (feedbackToggleBtn) {
  feedbackToggleBtn.addEventListener('click', () => {
    document.getElementById('feedbackPanel').classList.toggle('open');
  });
}

renderSubmittedFeedbackReports();
// map.js — Leaflet map init, venue markers, popups, flyTo, lightweight clustering.
// Exposes: initMap(events, venues), updateMarkers(visibleEventIds), flyToVenue(venueId), openVenuePopup(venueId), closeVenuePopup()

const DRESDEN_CENTER = [51.0504, 13.7373];
let map = null;
let markerLayer = null;
let clusterLayer = null;
let markersByVenueId = new Map();
let _events = [];
let _venues = new Map();
let _onSelectEvent = null;
let _visibleVenueIds = new Set();

// Custom popup overlay state
let popupOverlay = null;
let popupBackdrop = null;
let popupPanel = null;
let popupContent = null;
let popupClose = null;

function formatTime(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function makeDivIcon(count) {
  const size = count > 10 ? 38 : count > 4 ? 32 : 26;
  return L.divIcon({
    className: '',
    html: `<div class="venue-marker" style="width:${size}px;height:${size}px;">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function buildPopupContent(venue) {
  const venueEvents = (venue.eventIds || [])
    .map(id => _events.find(e => e.id === id))
    .filter(Boolean)
    .sort((a, b) => (a.beginMin || 9999) - (b.beginMin || 9999));

  const items = venueEvents.map(ev => `
    <a class="popup-event" data-event-id="${ev.id}" href="#" role="button">
      <div class="popup-event-time">${formatTime(ev.beginMin)}${ev.endMin ? ' – ' + formatTime(ev.endMin) : ''} Uhr</div>
      <div class="popup-event-title">${escapeHtml(ev.title)}</div>
      ${ev.formats && ev.formats.length ? `<div class="popup-event-format">${escapeHtml(ev.formats.join(', '))}</div>` : ''}
    </a>
  `).join('');

  return `
    <div class="popup-venue">
      <div class="popup-venue-name">${escapeHtml(venue.name)}</div>
      ${venue.address?.district ? `<div class="popup-venue-district">${escapeHtml(venue.address.district)}</div>` : ''}
      <div class="popup-event-list">${items || '<div class="popup-event-title">Keine Veranstaltungen</div>'}</div>
    </div>
  `;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initMap(events, venues, onSelectEvent) {
  _events = events;
  _venues = new Map(venues.map(v => [v.id, v]));
  _onSelectEvent = onSelectEvent;

  map = L.map('map', {
    center: DRESDEN_CENTER,
    zoom: 13,
    zoomControl: true,
    scrollWheelZoom: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> Mitwirkende',
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  clusterLayer = L.layerGroup().addTo(map);

  // Grab popup overlay DOM refs
  popupOverlay = document.getElementById('popup-overlay');
  popupBackdrop = document.getElementById('popup-backdrop');
  popupPanel = document.getElementById('popup-panel');
  popupContent = document.getElementById('popup-content');
  popupClose = document.getElementById('popup-close');

  // Wire close handlers
  popupClose.addEventListener('click', closeVenuePopup);
  popupBackdrop.addEventListener('click', closeVenuePopup);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupOverlay.classList.contains('open')) closeVenuePopup();
  });

  // Create all markers once (but don't add yet — clustering decides visibility)
  for (const venue of venues) {
    if (venue.lat == null || venue.lng == null) continue;
    const count = venue.eventIds?.length || 0;
    const marker = L.marker([venue.lat, venue.lng], { icon: makeDivIcon(count) });
    marker.on('click', () => openVenuePopup(venue.id));
    marker.venueId = venue.id;
    markersByVenueId.set(venue.id, marker);
  }

  // Initial: all venues visible
  _visibleVenueIds = new Set(markersByVenueId.keys());

  // Fit bounds to all markers
  const valid = venues.filter(v => v.lat != null && v.lng != null);
  if (valid.length > 0) {
    const bounds = L.latLngBounds(valid.map(v => [v.lat, v.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  // Re-render on zoom/move (clustering)
  map.on('zoomend moveend', renderClusters);
  renderClusters();
}

// Lightweight grid-based clustering: group nearby visible markers by pixel grid.
// At high zoom, show individual markers; at low zoom, group overlapping ones into clusters.
function renderClusters() {
  if (!map) return;
  const zoom = map.getZoom();
  // Grid size in pixels — smaller at higher zoom
  const gridSize = zoom >= 16 ? 0 : zoom >= 14 ? 40 : zoom >= 12 ? 60 : 90;

  markerLayer.clearLayers();
  clusterLayer.clearLayers();

  if (gridSize === 0) {
    // Show all individual markers
    for (const venueId of _visibleVenueIds) {
      const marker = markersByVenueId.get(venueId);
      if (marker) marker.addTo(markerLayer);
    }
    return;
  }

  // Group markers by grid cell
  const grid = new Map();
  for (const venueId of _visibleVenueIds) {
    const venue = _venues.get(venueId);
    const marker = markersByVenueId.get(venueId);
    if (!venue || !marker) continue;
    const pt = map.latLngToContainerPoint([venue.lat, venue.lng]);
    const cx = Math.floor(pt.x / gridSize);
    const cy = Math.floor(pt.y / gridSize);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(venueId);
  }

  for (const [, venueIds] of grid) {
    if (venueIds.length === 1) {
      const marker = markersByVenueId.get(venueIds[0]);
      if (marker) marker.addTo(markerLayer);
    } else {
      // Create a cluster marker at the average position
      const venues = venueIds.map(id => _venues.get(id)).filter(Boolean);
      const avgLat = venues.reduce((s, v) => s + v.lat, 0) / venues.length;
      const avgLng = venues.reduce((s, v) => s + v.lng, 0) / venues.length;
      const totalEvents = venues.reduce((s, v) => s + (v.eventIds?.length || 0), 0);
      const clusterIcon = L.divIcon({
        className: '',
        html: `<div class="venue-marker cluster-marker" style="width:44px;height:44px;background:var(--accent-2);">${totalEvents}</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      const cluster = L.marker([avgLat, avgLng], { icon: clusterIcon });
      cluster.on('click', () => {
        // Zoom in to expand the cluster
        map.flyTo([avgLat, avgLng], Math.min(zoom + 2, 17), { duration: 0.5 });
      });
      cluster.addTo(clusterLayer);
    }
  }
}

export function updateMarkers(visibleEventIds) {
  const visibleSet = new Set(visibleEventIds);
  const newVisible = new Set();
  for (const [venueId, marker] of markersByVenueId) {
    const venue = _venues.get(venueId);
    if (!venue) continue;
    const visibleAtVenue = (venue.eventIds || []).filter(id => visibleSet.has(id));
    if (visibleAtVenue.length === 0) continue;
    newVisible.add(venueId);
    // Update count badge (popup content is built fresh on each open)
    const filteredVenue = { ...venue, eventIds: visibleAtVenue };
    marker.setIcon(makeDivIcon(visibleAtVenue.length));
    // Store filtered event IDs on the marker so openVenuePopup can use them
    marker._filteredEventIds = visibleAtVenue;
  }
  _visibleVenueIds = newVisible;
  renderClusters();
}

export function flyToVenue(venueId) {
  const venue = _venues.get(venueId);
  const marker = markersByVenueId.get(venueId);
  if (!venue || !marker) return;
  closeVenuePopup();
  map.flyTo([venue.lat, venue.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
  setTimeout(() => openVenuePopup(venueId), 850);
}

export function openVenuePopup(venueId) {
  const venue = _venues.get(venueId);
  const marker = markersByVenueId.get(venueId);
  if (!venue || !marker || !popupOverlay) return;

  // Build the venue object with filtered event IDs if available
  let eventIds = venue.eventIds;
  if (marker._filteredEventIds) {
    eventIds = marker._filteredEventIds;
  }
  const venueForPopup = { ...venue, eventIds };

  // Set content
  popupContent.innerHTML = buildPopupContent(venueForPopup);

  // Wire event click handlers
  popupContent.querySelectorAll('.popup-event').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const id = el.getAttribute('data-event-id');
      if (_onSelectEvent) _onSelectEvent(id);
      closeVenuePopup();
    });
  });

  // Capture marker screen position for zoom animation origin.
  // Compute offset from screen center so the panel animates
  // from the marker's location → to the center of the screen.
  const mapRect = map.getContainer().getBoundingClientRect();
  const markerPt = map.latLngToContainerPoint([venue.lat, venue.lng]);
  const markerScreenX = mapRect.left + markerPt.x;
  const markerScreenY = mapRect.top + markerPt.y;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const offsetX = markerScreenX - centerX;
  const offsetY = markerScreenY - centerY;
  popupPanel.style.setProperty('--popup-origin-x', `${offsetX}px`);
  popupPanel.style.setProperty('--popup-origin-y', `${offsetY}px`);

  // Show overlay
  popupOverlay.classList.add('open');
  popupOverlay.setAttribute('aria-hidden', 'false');
}

export function closeVenuePopup() {
  if (!popupOverlay) return;
  popupOverlay.classList.remove('open');
  popupOverlay.setAttribute('aria-hidden', 'true');
  popupContent.innerHTML = '';
}

export function invalidateSize() {
  if (map) map.invalidateSize();
}

// main.js — App entry: load data, init filters/map/cards, wire everything together.

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function main() {
  const loadingEl = document.getElementById('map-loading');
  const countEl = document.getElementById('result-count');

  try {
    const [eventsData, venuesData, filtersData] = await Promise.all([
      fetchJson('data/events.json'),
      fetchJson('data/venues.json'),
      fetchJson('data/filters.json'),
    ]);
    const events = Array.isArray(eventsData) ? eventsData : eventsData.events;
    const venues = venuesData.venues || venuesData;
    const filters = filtersData;

    // Hide loading
    loadingEl.classList.add('hidden');
    setTimeout(() => loadingEl.remove(), 500);

    // Init cards first (needs events/venues)
    const { initCards, showEvent, closeDrawer } = await import('./cards.js');
    const { initMap, updateMarkers, flyToVenue, invalidateSize } = await import('./map.js');
    const { initFilters, getVisibleEventIds } = await import('./filters.js');

    initCards(events, venues, flyToVenue);
    initMap(events, venues, showEvent);

    // Count venues that have coordinates (map-able)
    const mappableVenueCount = venues.filter(v => v.lat != null && v.lng != null).length;

    // Filters onChange → update markers + count
    const onChange = (visibleIds) => {
      const visibleSet = new Set(visibleIds);
      // Count venues that have at least one visible event
      const visibleVenueCount = venues.filter(v =>
        (v.eventIds || []).some(id => visibleSet.has(id))
      ).length;
      updateMarkers(visibleIds);
      countEl.innerHTML = `<strong>${visibleIds.length}</strong> Veranstaltungen an <strong>${visibleVenueCount}</strong> Orten`;
    };
    initFilters(events, venues, filters, onChange);

    // Initial count — both event and venue totals
    countEl.innerHTML = `<strong>${events.length}</strong> Veranstaltungen an <strong>${mappableVenueCount}</strong> Orten`;

    // Invalidate map size after layout settles
    setTimeout(() => invalidateSize(), 300);

    // Handle browser back/forward for filter state
    window.addEventListener('hashchange', () => location.reload());

  } catch (e) {
    console.error(e);
    loadingEl.innerHTML = `<p style="color:var(--pink)">Fehler beim Laden der Daten.<br><small>${escapeHtml(e.message)}</small></p>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();

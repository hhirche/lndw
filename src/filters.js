// filters.js — Filter state, UI building, and event filtering logic.
// Exposes: initFilters(events, venues, filters, onChange), getVisibleEventIds(), syncFromUrl(), syncToUrl()

let _events = [];
let _venues = [];
let _filters = {};
let _state = createEmptyState();
let _onChange = null;

function createEmptyState() {
  return {
    search: '',
    timeFrom: null,   // minutes
    timeTo: null,     // minutes
    organizer: '',
    venue: '',        // venue name
    district: '',
    format: '',
    interests: new Set(),
  };
}

function timeToMinutes(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToLabel(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildTimeOptions(range) {
  // Generate 30-min steps from min to max
  const opts = [{ value: '', label: 'beliebig' }];
  const start = Math.floor(range.min / 30) * 30;
  for (let t = start; t <= range.max; t += 30) {
    opts.push({ value: String(t), label: minutesToLabel(t) });
  }
  return opts;
}

function populateSelect(id, options, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  sel.appendChild(ph);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
}

export function initFilters(events, venues, filters, onChange) {
  _events = events;
  _venues = venues;
  _filters = filters;
  _onChange = onChange;
  _state = createEmptyState();

  // Time selects
  const timeOpts = buildTimeOptions(filters.timeRange);
  populateSelect('filter-time-from', timeOpts.map(o => o.label === 'beliebig' ? null : `${o.value}:${o.label}`).filter(Boolean), 'beliebig');
  // Simpler: rebuild with value=label=minutes
  const fromSel = document.getElementById('filter-time-from');
  const toSel = document.getElementById('filter-time-to');
  for (const sel of [fromSel, toSel]) {
    sel.innerHTML = '<option value="">beliebig</option>';
    const start = Math.floor(filters.timeRange.min / 30) * 30;
    for (let t = start; t <= filters.timeRange.max; t += 30) {
      const o = document.createElement('option');
      o.value = String(t);
      o.textContent = minutesToLabel(t);
      sel.appendChild(o);
    }
  }

  populateSelect('filter-organizer', filters.organizers, 'Alle Veranstalter');
  populateSelect('filter-venue', filters.venues, 'Alle Veranstaltungsorte');
  populateSelect('filter-district', filters.districts, 'Alle Stadtteile');
  populateSelect('filter-format', filters.formats, 'Alle Formate');

  // Interests chips
  const chipsEl = document.getElementById('filter-interests');
  chipsEl.innerHTML = '';
  for (const interest of filters.interests) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = interest;
    chip.dataset.value = interest;
    chip.addEventListener('click', () => {
      if (_state.interests.has(interest)) { _state.interests.delete(interest); chip.classList.remove('active'); }
      else { _state.interests.add(interest); chip.classList.add('active'); }
      emit();
    });
    chipsEl.appendChild(chip);
  }

  // Wire selects
  const wire = (id, key, transform) => {
    const sel = document.getElementById(id);
    sel.addEventListener('change', () => {
      _state[key] = transform ? transform(sel.value) : sel.value;
      emit();
    });
  };
  wire('filter-time-from', 'timeFrom', v => v ? parseInt(v, 10) : null);
  wire('filter-time-to', 'timeTo', v => v ? parseInt(v, 10) : null);
  wire('filter-organizer', 'organizer');
  wire('filter-venue', 'venue');
  wire('filter-district', 'district');
  wire('filter-format', 'format');

  // Search
  const searchInput = document.getElementById('search-input');
  let debounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      _state.search = searchInput.value.trim().toLowerCase();
      emit();
    }, 200);
  });

  // Reset
  document.getElementById('reset-filters').addEventListener('click', () => {
    _state = createEmptyState();
    searchInput.value = '';
    [fromSel, toSel].forEach(s => s.value = '');
    ['filter-organizer', 'filter-venue', 'filter-district', 'filter-format'].forEach(id => { document.getElementById(id).value = ''; });
    chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    emit();
  });

  // Filters toggle
  const toggle = document.getElementById('filters-toggle');
  const panel = document.getElementById('filters-panel');
  const backdrop = document.getElementById('filters-backdrop');

  function openFilters() {
    panel.classList.remove('collapsed');
    toggle.setAttribute('aria-expanded', 'true');
    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function closeFilters() {
    panel.classList.add('collapsed');
    toggle.setAttribute('aria-expanded', 'false');
    backdrop.classList.remove('visible');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  toggle.addEventListener('click', () => {
    if (panel.classList.contains('collapsed')) {
      openFilters();
    } else {
      closeFilters();
    }
  });

  backdrop.addEventListener('click', () => {
    closeFilters();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('collapsed')) {
      closeFilters();
    }
  });

  // Sync from URL on load
  syncFromUrl();
  emit();
}

function emit() {
  syncToUrl();
  if (_onChange) _onChange(getVisibleEventIds());
}

export function getVisibleEventIds() {
  const visible = [];
  for (const ev of _events) {
    // Search
    if (_state.search) {
      const hay = `${ev.title} ${ev.teaser} ${ev.description} ${ev.organizer}`.toLowerCase();
      if (!hay.includes(_state.search)) continue;
    }
    // Time from: event must start at or after, OR overlap (end >= timeFrom)
    if (_state.timeFrom != null) {
      if (ev.beginMin == null) continue;
      // Show events that are still running at timeFrom: beginMin <= timeFrom && endMin >= timeFrom, OR beginMin >= timeFrom
      const overlaps = (ev.beginMin <= _state.timeFrom && (ev.endMin == null || ev.endMin >= _state.timeFrom)) || ev.beginMin >= _state.timeFrom;
      if (!overlaps) continue;
    }
    // Time to: event must start at or before timeTo
    if (_state.timeTo != null) {
      if (ev.beginMin == null || ev.beginMin > _state.timeTo) continue;
    }
    // Organizer
    if (_state.organizer && ev.organizer !== _state.organizer) continue;
    // Venue (by venue name → match venueId)
    if (_state.venue) {
      const venue = _venues.find(v => v.name === _state.venue);
      if (!venue || ev.venueId !== venue.id) continue;
    }
    // District
    if (_state.district && ev.address?.district !== _state.district) continue;
    // Format
    if (_state.format && !(ev.formats || []).includes(_state.format)) continue;
    // Interests
    if (_state.interests.size > 0 && !_state.interests.has(ev.interest)) continue;
    visible.push(ev.id);
  }
  return visible;
}

export function getResultCount() {
  return getVisibleEventIds().length;
}

function syncToUrl() {
  const params = new URLSearchParams();
  if (_state.search) params.set('q', _state.search);
  if (_state.timeFrom != null) params.set('from', String(_state.timeFrom));
  if (_state.timeTo != null) params.set('to', String(_state.timeTo));
  if (_state.organizer) params.set('org', _state.organizer);
  if (_state.venue) params.set('venue', _state.venue);
  if (_state.district) params.set('dist', _state.district);
  if (_state.format) params.set('fmt', _state.format);
  if (_state.interests.size > 0) params.set('int', Array.from(_state.interests).join('|'));
  const qs = params.toString();
  const newHash = qs ? '#' + qs : '';
  if (newHash !== location.hash) history.replaceState(null, '', newHash || location.pathname);
}

function syncFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!location.hash) return;
  _state.search = params.get('q') || '';
  _state.timeFrom = params.get('from') ? parseInt(params.get('from'), 10) : null;
  _state.timeTo = params.get('to') ? parseInt(params.get('to'), 10) : null;
  _state.organizer = params.get('org') || '';
  _state.venue = params.get('venue') || '';
  _state.district = params.get('dist') || '';
  _state.format = params.get('fmt') || '';
  const ints = params.get('int');
  if (ints) _state.interests = new Set(ints.split('|'));

  // Reflect in UI
  document.getElementById('search-input').value = _state.search;
  document.getElementById('filter-time-from').value = _state.timeFrom != null ? String(_state.timeFrom) : '';
  document.getElementById('filter-time-to').value = _state.timeTo != null ? String(_state.timeTo) : '';
  document.getElementById('filter-organizer').value = _state.organizer;
  document.getElementById('filter-venue').value = _state.venue;
  document.getElementById('filter-district').value = _state.district;
  document.getElementById('filter-format').value = _state.format;
  document.querySelectorAll('#filter-interests .chip').forEach(c => {
    if (_state.interests.has(c.dataset.value)) c.classList.add('active');
    else c.classList.remove('active');
  });
}

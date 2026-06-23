// cards.js — Event detail drawer rendering.
// Exposes: initCards(events, venues, onFlyToVenue), showEvent(eventId), closeDrawer()

let _events = [];
let _venues = new Map();
let _onFlyToVenue = null;
let drawer, overlay, content;

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatTime(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const LINK_ICONS = {
  website: '🔗', twitter: '𝕏', youtube: '▶', facebook: 'f', instagram: '📷',
};

export function initCards(events, venues, onFlyToVenue) {
  _events = events;
  _venues = new Map(venues.map(v => [v.id, v]));
  _onFlyToVenue = onFlyToVenue;
  drawer = document.getElementById('event-drawer');
  overlay = document.getElementById('drawer-overlay');
  content = document.getElementById('drawer-content');

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });
}

export function showEvent(eventId) {
  const ev = _events.find(e => e.id === eventId);
  if (!ev) return;
  const venue = ev.venueId ? _venues.get(ev.venueId) : null;

  const interestBadge = ev.interest ? `<span class="card-format-badge">${escapeHtml(ev.interest)}</span>` : '';
  const timeBlocks = `
    <div class="card-time-block">
      <span class="card-time-label">Beginn</span>
      <span class="card-time-value">${escapeHtml(ev.begin || '')} Uhr</span>
    </div>
    <div class="card-time-block">
      <span class="card-time-label">Ende</span>
      <span class="card-time-value">${escapeHtml(ev.end || '')} Uhr</span>
    </div>
    ${ev.duration ? `<span class="card-time-duration">${escapeHtml(ev.duration)}</span>` : ''}
  `;

  const venueBlock = venue ? `
    <div class="card-venue" id="card-venue" role="button" tabindex="0">
      <span class="card-venue-icon">📍</span>
      <div>
        <div class="card-venue-name">${escapeHtml(venue.name)}</div>
        <div class="card-venue-address">${escapeHtml([venue.address?.street, venue.address?.district].filter(Boolean).join(', '))}</div>
      </div>
    </div>
  ` : '';

  const interests = (ev.formats || []).concat(ev.attributes || []);
  const interestsHtml = interests.length ? `
    <div class="card-interests">
      ${interests.map(i => `<span class="card-interest">${escapeHtml(i)}</span>`).join('')}
    </div>
  ` : '';

  const linksHtml = (ev.links || []).length ? `
    <div class="card-links">
      ${ev.links.map(l => `<a class="card-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${LINK_ICONS[l.type] || '🔗'} ${escapeHtml(l.label)}</a>`).join('')}
    </div>
  ` : '';

  const imageHtml = ev.imageUrl
    ? `<img class="card-image" src="${escapeHtml(ev.imageUrl)}" alt="${escapeHtml(ev.title)}" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="card-image-placeholder" aria-hidden="true"><span class="card-image-placeholder-icon">🔬</span></div>`;

  content.innerHTML = `
    ${imageHtml}
    <div class="card-body">
      ${interestBadge}
      <h2 class="card-title">${escapeHtml(ev.title)}</h2>
      <div class="card-time">${timeBlocks}</div>
      ${venueBlock}
      <div class="card-organizer">Veranstalter: <strong>${escapeHtml(ev.organizer)}</strong></div>
      ${ev.description ? `<div class="card-description">${escapeHtml(ev.description)}</div>` : ''}
      ${interestsHtml}
      ${linksHtml}
      <a class="card-detail-link" href="${escapeHtml(ev.detailUrl)}" target="_blank" rel="noopener noreferrer">
        Original-Veranstaltungsseite →
      </a>
    </div>
  `;

  // Wire venue click → fly to marker
  const venueEl = document.getElementById('card-venue');
  if (venueEl && venue && _onFlyToVenue) {
    const fly = () => { _onFlyToVenue(venue.id); closeDrawer(); };
    venueEl.addEventListener('click', fly);
    venueEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fly(); } });
  }

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
  content.scrollTop = 0;
  // Focus close button for a11y
  setTimeout(() => document.getElementById('drawer-close').focus(), 100);
}

export function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
}

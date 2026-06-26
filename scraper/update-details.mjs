// update-details.mjs — Fetches detail pages for events that don't yet have one
// in details.json. Compares cards.json against existing details.json and fills gaps.
// Uses only Node.js built-ins.
// Usage: node scraper/update-details.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://www.wissenschaftsnacht-dresden.de';

function idFromUrl(url) {
  const m = url.match(/-(\d+)$/);
  return m ? m[1] : null;
}

// ── Load data ──
const cards = JSON.parse(readFileSync('scraper/data/cards.json', 'utf8'));
const oldDetails = existsSync('scraper/data/details.json')
  ? JSON.parse(readFileSync('scraper/data/details.json', 'utf8'))
  : [];

const detailByUrl = new Map(oldDetails.map(d => [d.detailUrl, d]));

// ── Find cards that need detail pages ──
const urlsToFetch = cards
  .filter(c => !detailByUrl.has(c.detailUrl))
  .map(c => c.detailUrl);

console.log(`Cards: ${cards.length}`);
console.log(`Existing details: ${oldDetails.length}`);
console.log(`Need to fetch: ${urlsToFetch.length}`);
if (urlsToFetch.length === 0) {
  console.log('All cards already have matching detail records. Nothing to do.');
  process.exit(0);
}

// ── Parse a detail page HTML ──
function parseDetailPage(html, detailUrl) {
  const dec = (s) => (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&szlig;/g, 'ß').replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö')
    .replace(/&Uuml;/g, 'Ü');

  let title = '';
  const h1Match = html.match(/<h1\s+class="h4\s+d-inline-block">([^<]*)<\/h1>/);
  if (h1Match) title = dec(h1Match[1].trim());
  if (!title) {
    const tMatch = html.match(/<title>([^<]*)<\/title>/);
    if (tMatch) title = dec(tMatch[1].replace(/: Wissenschaftsnacht Dresden.*$/, '').trim());
  }

  let description = '';
  const subMatch = html.match(/<div\s+class="subheader">\s*([\s\S]*?)\s*<\/div>/);
  if (subMatch) {
    description = dec(subMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
  }

  let beschreibung = '';
  const descMatch = html.match(/<div\s+class="description\s+mb-3\s+mb-lg-5">\s*<h2>\s*Beschreibung\s*<\/h2>\s*([\s\S]*?)<\/div>/);
  if (descMatch) {
    beschreibung = dec(descMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
  }

  let formatBadge = '';
  const badgeMatch = html.match(/<span\s+class="badge\s+bg-pink[^"]*">([^<]*)<\/span>/);
  if (badgeMatch) formatBadge = dec(badgeMatch[1].trim());

  let organizer = '';
  const orgMatch = html.match(/<div\s+class="location\s+d-flex[^"]*">[\s\S]*?<span>([^<]*)<\/span>/);
  if (orgMatch) organizer = dec(orgMatch[1].trim());

  let addressBlock = '';
  const addrMatch = html.match(/<div\s+class="location-address[^"]*">([\s\S]*?)<\/div>\s*(?=<div|$)/);
  if (addrMatch) {
    const spanMatch = addrMatch[1].match(/<span>([\s\S]*?)<\/span>/);
    if (spanMatch) addressBlock = spanMatch[1].trim();
  }

  let begin = '', end = '';
  const timeMatch = html.match(/<div\s+class="time-wrap-container[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/);
  if (timeMatch) {
    const beginMatch = timeMatch[1].match(/<span>Beginn<\/span>\s*<span>([^<]*)<\/span>/);
    const endMatch = timeMatch[1].match(/<span>Ende<\/span>\s*<span>([^<]*)<\/span>/);
    if (beginMatch) begin = beginMatch[1].trim() + ' Uhr';
    if (endMatch) end = endMatch[1].trim() + ' Uhr';
  }

  let duration = '';
  const durMatch = html.match(/<i\s+class="icon-duration"><\/i>\s*<span>([^<]*)<\/span>/);
  if (durMatch) duration = dec(durMatch[1].trim());

  const links = [];
  const linkRegex = /<a\s+class="website\s+d-flex[^"]*"\s+href="([^"]*)"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g;
  let lm;
  while ((lm = linkRegex.exec(html)) !== null) {
    let type = 'website';
    if (/facebook/i.test(lm[1])) type = 'facebook';
    if (/twitter/i.test(lm[1]) || /x\.com/i.test(lm[1])) type = 'twitter';
    if (/instagram/i.test(lm[1])) type = 'instagram';
    if (/youtube/i.test(lm[1])) type = 'youtube';
    links.push({ url: lm[1], label: dec(lm[2].trim()), type });
  }

  let imageUrl = '';
  const imgMatch = html.match(/<img\s+class="bg-img"\s+src="([^"]*)"/);
  if (imgMatch) {
    imageUrl = imgMatch[1].startsWith('http') ? imgMatch[1] : BASE + imgMatch[1];
  }

  return { detailUrl, title, description, beschreibung, formatInfo: '', organizer, addressBlock,
    duration, links, begin, end, formatBadge, imageUrl };
}

// ── Fetch missing detail pages ──
const newDetails = [];
let fetched = 0, errors = 0;

for (const url of urlsToFetch) {
  const id = idFromUrl(url);
  try {
    console.log(`[${++fetched}/${urlsToFetch.length}] Fetching ${id}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  ERROR: HTTP ${res.status}`);
      errors++;
      continue;
    }
    const html = await res.text();
    const detail = parseDetailPage(html, url);
    newDetails.push(detail);
    if (!detail.title) console.log(`  WARNING: no title found`);
    if (!detail.addressBlock) console.log(`  WARNING: no addressBlock found`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    errors++;
  }
}

console.log(`\nFetched: ${newDetails.length} (${errors} errors)`);

// ── Merge: keep existing details for cards that still exist + new details ──
const cardUrls = new Set(cards.map(c => c.detailUrl));
const updatedDetails = [
  ...oldDetails.filter(d => cardUrls.has(d.detailUrl)),  // keep matching
  ...newDetails,                                          // add new
];

console.log(`Details: ${oldDetails.length} → ${updatedDetails.length}`);
console.log(`  Kept: ${updatedDetails.length - newDetails.length}`);
console.log(`  Added: ${newDetails.length}`);
console.log(`  Dropped: ${oldDetails.length - (updatedDetails.length - newDetails.length)} (cards no longer exist)`);

writeFileSync('scraper/data/details.json', JSON.stringify(updatedDetails, null, 2), 'utf8');
console.log(`Wrote scraper/data/details.json`);

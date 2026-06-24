// extract-cards.mjs — Parses the programm.html page to extract event card data.
// Mirrors what the browser page.evaluate does: reads DOM elements and collects
// detailUrl, title, imageUrl, organizer, teaser, formats, begin, end.
// Usage: node scraper/extract-cards.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('scraper/data/programm.html', 'utf8');

// The program page renders all event cards as:
// <div class="... event-grid-item ..." data-begin="..." data-end="...">
//   <a class="event-grid-item-link" title="..." href="/programm/detailansicht/{slug}-{id}">
//     <img ... src="..." />
//     <div class="event-grid-header">
//       <div class="location">Organizer</div>
//       <div class="event-grid-header-badges">
//         <div class="format badge ...">Format</div>
//       </div>
//     </div>
//     <div class="event-grid-footer">
//       <div class="event-grid-footer-text">
//         <h3 class="title">Title</h3>
//         <p class="description">Teaser</p>
//       </div>
//       <div class="time-wrap">
//         <div class="time"><span>Beginn</span><span>HH:MM</span><span>Uhr</span></div>
//         <div class="duration"><span>Ende</span><span>HH:MM</span><span>Uhr</span></div>
//       </div>
//     </div>
//   </a>
//   <div data-controller="watchlist">...</div>
// </div>

const cardRegex = /<div\s+class="[^"]*event-grid-item[^"]*"\s+data-begin="([^"]*)"\s+data-end="([^"]*)">([\s\S]*?)(?=<div\s+class="[^"]*event-grid-item[^"]*"|<div\s+class="g-col)/g;

const cards = [];
let match;

while ((match = cardRegex.exec(html)) !== null) {
  const [, dataBegin, dataEnd, block] = match;

  // Extract detailUrl from href
  const hrefMatch = block.match(/href="(\/programm\/detailansicht\/[^"]+)"/);
  if (!hrefMatch) continue;
  const detailUrl = 'https://www.wissenschaftsnacht-dresden.de' + hrefMatch[1];

  // Extract title from the title attribute on the link (attribute order varies)
  const titleMatch = block.match(/<a\s+[^>]*\btitle="([^"]*)"[^>]*>/);
  const title = titleMatch ? titleMatch[1] : '';

  // Extract image URL
  const imgMatch = block.match(/<img[^>]*src="([^"]*)"[^>]*>/);
  let imageUrl = '';
  if (imgMatch) {
    imageUrl = imgMatch[1].startsWith('http') ? imgMatch[1]
      : 'https://www.wissenschaftsnacht-dresden.de' + imgMatch[1];
  }

  // Extract organizer from <div class="location">
  const orgMatch = block.match(/<div\s+class="location">([^<]*)<\/div>/);
  const organizer = orgMatch ? orgMatch[1].trim() : '';

  // Extract teaser from <p class="description">
  const teaserMatch = block.match(/<p\s+class="description">\s*([\s\S]*?)\s*<\/p>/);
  let teaser = '';
  if (teaserMatch) {
    teaser = teaserMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  // Extract format badges — can be multiple
  const formatRegex = /<div\s+class="format\s+badge[^"]*">([^<]*)<\/div>/g;
  const formats = [];
  let fm;
  while ((fm = formatRegex.exec(block)) !== null) {
    formats.push(fm[1].trim());
  }

  // Extract begin and end times from the time-wrap
  // <div class="time"><span>Beginn</span><span>HH:MM</span><span>Uhr</span></div>
  // <div class="duration"><span>Ende</span><span>HH:MM</span><span>Uhr</span></div>
  const timeDivs = block.match(/<div\s+class="(?:time|duration)[^"]*">([\s\S]*?)<\/div>/g);
  let begin = '', end = '';
  if (timeDivs) {
    for (const td of timeDivs) {
      const spans = td.match(/<span>([^<]*)<\/span>/g);
      if (spans && spans.length >= 2) {
        const label = spans[0].replace(/<\/?span>/g, '');
        const value = spans[1].replace(/<\/?span>/g, '');
        if (label === 'Beginn') begin = value + ' Uhr';
        if (label === 'Ende') end = value + ' Uhr';
      }
    }
  }

  cards.push({
    detailUrl,
    title,
    imageUrl,
    organizer,
    teaser,
    formats,
    begin,
    end,
  });
}

console.log(`Extracted ${cards.length} cards from program page`);

const outPath = 'scraper/data/cards.json';
writeFileSync(outPath, JSON.stringify(cards, null, 2), 'utf8');
console.log(`Wrote ${outPath}`);

// receive.mjs — tiny one-shot HTTP server that writes the POST body to a file.
// Usage: node receive.mjs <outPath>
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const outPath = process.argv[2];
if (!outPath) { console.error('Usage: node receive.mjs <outPath>'); process.exit(1); }

const server = createServer((req, res) => {
  // CORS: allow any origin so the browser page can POST
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    writeFileSync(outPath, body);
    console.log(`Wrote ${body.length} bytes to ${outPath}`);
    res.end('OK');
    // Close after writing (one-shot)
    setTimeout(() => process.exit(0), 100);
  });
});
server.listen(0, '127.0.0.1', () => {
  console.log('PORT=' + server.address().port);
});

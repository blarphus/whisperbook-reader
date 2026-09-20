// After `vinext build`, give the generated Worker config its R2 binding (MEDIA -> whisperbook-audio).
import fs from 'node:fs';
const path = new URL('../dist/server/wrangler.json', import.meta.url);
const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
cfg.r2_buckets = [{binding: 'MEDIA', bucket_name: 'whisperbook-audio'}];
fs.writeFileSync(path, JSON.stringify(cfg));
console.log('wrangler.json: bound MEDIA -> whisperbook-audio');

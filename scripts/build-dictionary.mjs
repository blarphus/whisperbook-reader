// Builds the in-browser dictionary from WordNet (Princeton, MIT-style licence).
// Output: public/dict/<two-letter shard>.json plus public/dict/exc.json (irregular forms).
// Run after `npm i`:  node scripts/build-dictionary.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dict = path.join(root, 'node_modules/wordnet-db/dict');
const excDir = path.join(root, 'scripts/wordnet-exc');
const out = path.join(root, 'public/dict');
const POS = {noun: 'n', verb: 'v', adj: 'a', adv: 'r'};
const MAX_PER_POS = 8, MAX_TOTAL = 12;

const shardKey = w => (w.length > 1 ? w.slice(0, 2) : w + '_').replace(/[^a-z]/g, '_');

function glosses(pos) {
  const map = new Map();
  for (const line of fs.readFileSync(path.join(dict, `data.${pos}`), 'utf8').split('\n')) {
    if (!line || line[0] === ' ') continue;
    const bar = line.indexOf('| ');
    if (bar < 0) continue;
    const gloss = line.slice(bar + 2).trim();
    const split = gloss.search(/;\s+"/);
    const definition = (split < 0 ? gloss : gloss.slice(0, split)).replace(/^\(|\)$/g, m => m).trim();
    const example = split < 0 ? '' : (gloss.slice(split).match(/"([^"]+)"/) || [])[1] || '';
    map.set(line.slice(0, 8), [definition, example]);
  }
  return map;
}

const entries = new Map(); // lemma -> [{pos, weight, senses}]
for (const pos of Object.keys(POS)) {
  const gl = glosses(pos);
  for (const line of fs.readFileSync(path.join(dict, `index.${pos}`), 'utf8').split('\n')) {
    if (!line || line[0] === ' ') continue;
    const t = line.split(' ');
    const lemma = t[0];
    if (lemma.includes('_')) continue;
    const synsets = +t[2], pointers = +t[3];
    const tagged = +t[5 + pointers];
    const offsets = t.slice(6 + pointers, 6 + pointers + synsets);
    const senses = offsets.slice(0, MAX_PER_POS).map(o => gl.get(o)).filter(Boolean).map(([d, e]) => e ? [POS[pos], d, e] : [POS[pos], d]);
    if (!senses.length) continue;
    if (!entries.has(lemma)) entries.set(lemma, []);
    entries.get(lemma).push({weight: tagged, senses});
  }
}

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
fs.copyFileSync(path.join(root, 'node_modules/wordnet-db/LICENSE'), path.join(out, 'WORDNET-LICENSE.txt')); // WordNet requires its notice to accompany copies
const shards = new Map();
for (const [lemma, groups] of entries) {
  groups.sort((a, b) => b.weight - a.weight);
  const senses = groups.flatMap(g => g.senses).slice(0, MAX_TOTAL);
  const key = shardKey(lemma);
  if (!shards.has(key)) shards.set(key, {});
  shards.get(key)[lemma] = senses;
}
let bytes = 0;
for (const [key, data] of shards) {
  const json = JSON.stringify(data);
  bytes += json.length;
  fs.writeFileSync(path.join(out, `${key}.json`), json);
}

const exc = {};
for (const pos of Object.keys(POS)) {
  for (const line of fs.readFileSync(path.join(excDir, `${pos}.exc`), 'utf8').split('\n')) {
    const [form, ...lemmas] = line.trim().split(/\s+/);
    if (!form || form.includes('_')) continue;
    exc[form] = [...new Set([...(exc[form] || []), ...lemmas.filter(l => !l.includes('_'))])];
  }
}
fs.writeFileSync(path.join(out, 'exc.json'), JSON.stringify(exc));
console.log(`${entries.size} words, ${shards.size} shards, ${(bytes / 1e6).toFixed(1)} MB total, ${Object.keys(exc).length} irregular forms`);

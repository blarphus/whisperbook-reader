#!/usr/bin/env python3
"""Builds public/dict-simple/<shard>.json from the Simple English Wiktionary dump.

  curl -O https://dumps.wikimedia.org/simplewiktionary/latest/simplewiktionary-latest-pages-articles.xml.bz2
  python3 scripts/build-simple-dictionary.py simplewiktionary-latest-pages-articles.xml.bz2

Text is CC BY-SA 4.0 (https://simple.wiktionary.org); the popup credits it.
Shard keys match scripts/build-dictionary.mjs so the app can fetch both by the same key.
"""
import bz2, json, os, re, sys, pathlib
import xml.etree.ElementTree as ET

ns = '{http://www.mediawiki.org/xml/export-0.11/}'
root = pathlib.Path(__file__).resolve().parent.parent
out_dir = root / 'public/dict-simple'
POS = {'noun':'n','proper noun':'n','verb':'v','adjective':'a','adverb':'r','preposition':'p','pronoun':'pr','conjunction':'c','interjection':'i','determiner':'d','article':'d'}
FORM_OF = re.compile(r'\{\{\s*(plural of|past tense of|past participle of|present participle of|third-person|form of|inflection of|comparative of|superlative of|alternative|misspelling|obsolete|dated|archaic)', re.I)

def clean(t):
    t = re.sub(r'<small>.*?</small>', '', t, flags=re.S)
    t = re.sub(r'<ref[^>]*>.*?</ref>', '', t, flags=re.S)
    t = re.sub(r'<[^>]+>', '', t)
    for _ in range(3): t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', t)
    t = t.replace("'''", '').replace("''", '')
    return re.sub(r'\s+', ' ', t).strip()

def shard_key(w):
    return re.sub(r'[^a-z]', '_', (w[:2] if len(w) > 1 else w + '_'))

entries = {}
for _, el in ET.iterparse(bz2.open(sys.argv[1]), events=('end',)):
    if el.tag != ns + 'page': continue
    title = el.findtext(ns + 'title'); nsn = el.findtext(ns + 'ns')
    rev = el.find(ns + 'revision'); text = (rev.findtext(ns + 'text') or '') if rev is not None else ''
    el.clear()
    if nsn != '0' or not title or not re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", title): continue
    if text.lstrip().upper().startswith('#REDIRECT'): continue
    pos = None; cur = None; senses = []
    for line in text.split('\n'):
        m = re.match(r'^==\s*([^=]+?)\s*==\s*$', line)
        if m: pos = POS.get(m.group(1).strip().lower()); cur = None; continue
        if pos is None: continue
        if re.match(r'^#(?![:*#])', line):
            if FORM_OF.search(line): cur = None; continue
            d = clean(line[1:])
            if len(d) < 8: cur = None; continue
            cur = [pos, d]; senses.append(cur)
        elif re.match(r'^#:', line) and cur is not None and len(cur) == 2:
            e = clean(line[2:])
            if e and title.lower()[:max(3, len(title) - 2)] in e.lower(): cur.append(e.strip('"“” '))
    if senses: entries.setdefault(title.lower(), []).extend(senses)

shards = {}
for w, s in entries.items(): shards.setdefault(shard_key(w), {})[w] = s
out_dir.mkdir(parents=True, exist_ok=True)
for f in out_dir.glob('*.json'): f.unlink()
for k, d in shards.items(): (out_dir / f'{k}.json').write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
(out_dir / 'LICENSE.txt').write_text('Definitions in this folder are derived from Simple English Wiktionary (https://simple.wiktionary.org)\nand are available under the Creative Commons Attribution-ShareAlike 4.0 licence:\nhttps://creativecommons.org/licenses/by-sa/4.0/\nAuthors: see each entry\'s page history on Simple English Wiktionary.\n')
print(f"{len(entries):,} words, {sum(len(v) for v in entries.values()):,} senses, {len(shards)} shards")

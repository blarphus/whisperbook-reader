'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { audioChunkSize, type BookAsset, type CachedBook } from '@/lib/book-cache';

type AssetSpec = { book: CachedBook; asset: BookAsset; fileName: string; contentType: string };
const specs: AssetSpec[] = [
  { book: 'dungeon-crawler-carl', asset: 'audio', fileName: 'Dungeon Crawler Carl, Book 1.m4b', contentType: 'audio/mp4' },
  { book: 'dungeon-crawler-carl', asset: 'prepared', fileName: 'dungeon-crawler-carl.reader.json.gz', contentType: 'application/gzip' },
  { book: 'dungeon-crawler-carl', asset: 'epub', fileName: 'Dungeon Crawler Carl - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'dungeon-crawler-carl', asset: 'alignment', fileName: 'Dungeon Crawler Carl, Book 1.whisperbook-alignment.json', contentType: 'application/json' },
  { book: 'the-car', asset: 'audio', fileName: 'The Car [B008I5SP4W].m4b', contentType: 'audio/mp4' },
  { book: 'the-car', asset: 'prepared', fileName: 'the-car.reader.json.gz', contentType: 'application/gzip' },
  { book: 'the-car', asset: 'epub', fileName: 'The Car - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'the-car', asset: 'alignment', fileName: 'the-car.alignment.json', contentType: 'application/json' },
  { book: 'the-car', asset: 'cover', fileName: 'The Car [B008I5SP4W].jpg', contentType: 'image/jpeg' },
  { book: 'scythe', asset: 'audio', fileName: 'Scythe - Chapterized.mp3', contentType: 'audio/mpeg' },
  { book: 'scythe', asset: 'prepared', fileName: 'scythe.reader.json.gz', contentType: 'application/gzip' },
  { book: 'scythe', asset: 'epub', fileName: 'Scythe - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'scythe', asset: 'alignment', fileName: 'scythe.alignment.json', contentType: 'application/json' },
  { book: 'scythe', asset: 'cover', fileName: 'Scythe - Cover.jpeg', contentType: 'image/jpeg' },
  { book: 'eragon', asset: 'audio', fileName: 'Eragon: Inheritance, Book 1 [B002UZKL7A].m4b', contentType: 'audio/mp4' },
  { book: 'eragon', asset: 'prepared', fileName: 'eragon.reader.json.gz', contentType: 'application/gzip' },
  { book: 'eragon', asset: 'epub', fileName: 'Eragon - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'eragon', asset: 'alignment', fileName: 'eragon.alignment.json', contentType: 'application/json' },
  { book: 'eragon', asset: 'cover', fileName: 'Eragon: Inheritance, Book 1 [B002UZKL7A].jpg', contentType: 'image/jpeg' },
  { book: 'project-hail-mary', asset: 'audio', fileName: 'Project Hail Mary - Chapterized.m4b', contentType: 'audio/mp4' },
  { book: 'project-hail-mary', asset: 'prepared', fileName: 'project-hail-mary.reader.json.gz', contentType: 'application/gzip' },
  { book: 'project-hail-mary', asset: 'epub', fileName: 'Project Hail Mary - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'project-hail-mary', asset: 'alignment', fileName: 'project-hail-mary.alignment.json', contentType: 'application/json' },
  { book: 'project-hail-mary', asset: 'cover', fileName: 'Andy Weir - Project Hail Mary.jpg', contentType: 'image/jpeg' },
  { book: 'just-mercy', asset: 'audio', fileName: 'Just Mercy - Chapterized.m4b', contentType: 'audio/mp4' },
  { book: 'just-mercy', asset: 'prepared', fileName: 'just-mercy.reader.json.gz', contentType: 'application/gzip' },
  { book: 'just-mercy', asset: 'epub', fileName: 'Just Mercy - Reader Edition.epub', contentType: 'application/epub+zip' },
  { book: 'just-mercy', asset: 'alignment', fileName: 'just-mercy.alignment.json', contentType: 'application/json' },
  { book: 'just-mercy', asset: 'cover', fileName: 'Just Mercy (Adapted for Young Adults): A True Story of the Fight for Justice [0525635912].jpg', contentType: 'image/jpeg' },
];

export default function CacheImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState('Select the reader files.');
  const [running, setRunning] = useState(false);
  const available = useMemo(() => new Map(files.map(file => [file.name, file])), [files]);
  const matched = specs.filter(spec => available.has(spec.fileName));

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setStatus('Ready to cache selected files.');
  }

  async function send(file: Blob, spec: AssetSpec, part: number, parts: number, complete = false) {
    const headers = new Headers({
      'x-book': spec.book,
      'x-asset': spec.asset,
      'x-part': String(part),
      'x-parts': String(parts),
      'x-total-bytes': String(file instanceof File ? file.size : 0),
      'content-type': spec.contentType,
    });
    if (complete) headers.set('x-complete', '1');
    const response = await fetch('/api/book-cache', { method: 'POST', headers, body: complete ? undefined : file });
    if (!response.ok) throw new Error(await response.text());
  }

  async function upload() {
    if (!matched.length) return;
    setRunning(true);
    try {
      for (let fileIndex = 0; fileIndex < matched.length; fileIndex += 1) {
        const spec = matched[fileIndex];
        const file = available.get(spec.fileName)!;
        const parts = spec.asset === 'audio' ? Math.ceil(file.size / audioChunkSize) : 1;
        for (let part = 0; part < parts; part += 1) {
          setStatus(`${fileIndex + 1}/${matched.length} ${spec.book} ${spec.asset} ${part + 1}/${parts}`);
          await send(file.slice(part * audioChunkSize, Math.min(file.size, (part + 1) * audioChunkSize)), spec, part, parts);
        }
        if (spec.asset === 'audio') {
          setStatus(`${fileIndex + 1}/${matched.length} ${spec.book} audio manifest`);
          await send(file, spec, parts - 1, parts, true);
        }
      }
      setStatus('Selected files are cached.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setRunning(false);
    }
  }

  return <main style={{ maxWidth: 680, margin: '48px auto', padding: 24, fontFamily: 'system-ui' }}>
    <h1>Reader cache</h1>
    <p>{matched.length} of {specs.length} reader files selected.</p>
    <input aria-label="Reader files" type="file" multiple onChange={selectFiles} disabled={running} />
    <button type="button" onClick={upload} disabled={running || !matched.length} style={{ display: 'block', marginTop: 20 }}>{running ? 'Caching…' : 'Cache selected files'}</button>
    <p aria-live="polite">{status}</p>
  </main>;
}

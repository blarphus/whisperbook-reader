import { assetContentTypes, audioChunkSize, isBookAsset, isCachedBook, objectKey, type BookAsset, type CachedBook } from '@/lib/book-cache';

type DriveFile = { id: string; type: string };
type RuntimeEnv = { BOOKS?: R2Bucket };
type AudioManifest = { parts: number; totalBytes: number; contentType: string };

const books: Record<string, Record<string, DriveFile>> = {
  'dungeon-crawler-carl': { audio: { id: '10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a', type: 'audio/mp4' }, prepared: { id: '1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT', type: 'application/json; charset=utf-8' }, epub: { id: '1_pkY8LQ4d_jwvh61FLe6X5IGPt7o6oeE', type: 'application/epub+zip' }, alignment: { id: '1lCRdBXLG8UdggN6B8j7Vk2ByH4GRDEzq', type: 'application/json' } },
  'the-car': { audio: { id: '1pjIxN4uISRCEVRjKIXwYY_wag9x9W7pi', type: 'audio/mp4' }, prepared: { id: '1WpJgogtvI0t6d7GU7vgfTQsVTwZvKvr-', type: 'application/json; charset=utf-8' }, epub: { id: '1xMAkEsN_D4U9eCpTuRRkcl2HPCh3MehX', type: 'application/epub+zip' }, alignment: { id: '18HG1Idfw3fO2wngjVA4antcqlMnUbwHG', type: 'application/json' }, cover: { id: '1XGRrtpMA9Iy3qPc0JgSSXjnI9hvDsm5l', type: 'image/jpeg' } },
  scythe: { audio: { id: '1-zyKxmuFsuB9T078xNuTEdV3qDOGPNiE', type: 'audio/mpeg' }, prepared: { id: '1w71H201njkS8eGBxxKfKuXh9yBaQTtYG', type: 'application/json; charset=utf-8' }, epub: { id: '1H8JXADJxHwWUYA-8u_jxuGo4yDL2TE53', type: 'application/epub+zip' }, alignment: { id: '1LbB61VgxOGGn6UcW3mIeJa4xZYM0SgBW', type: 'application/json' }, cover: { id: '1zuCMBncZqR8dqBiaq_2pCywZH0iE1C-2', type: 'image/jpeg' } },
  eragon: { audio: { id: '1RF-J7mzZoG3AJzHM2dj9resgIs5rXrbW', type: 'audio/mp4' }, prepared: { id: '1F6u0OWPWrJenembohmY-2FFVAI0_k4i0', type: 'application/json; charset=utf-8' }, epub: { id: '1mWSCDFj2cnCndtwzLvtzi5XAqIWBascu', type: 'application/epub+zip' }, alignment: { id: '1-V8IsF1SykHnZD2BcGMkpE2hWuT8mqpH', type: 'application/json' }, cover: { id: '1TSbFN7oSxsC4wj7J-JxzESxU-LqWF59m', type: 'image/jpeg' } },
  'project-hail-mary': { audio: { id: '19EBL2jgPQF6DFpTCVEjo9An99wgqI94L', type: 'audio/mp4' }, prepared: { id: '1TDYNIIX78ohGncIHZVtFd1WEORB9ooCU', type: 'application/json; charset=utf-8' }, epub: { id: '1WolXvTtv99RqxkIkkPzeF5lv12IvW7zr', type: 'application/epub+zip' }, alignment: { id: '1Nzm0QxN4q-ArY6VZXh4rseUK8xWRIkPb', type: 'application/json' }, cover: { id: '1oEoe34k3638n45QvRWJSbll-u2cRYSw3', type: 'image/jpeg' } },
  'just-mercy': { audio: { id: '1Sp-XYQWbs0g6iOjQpl0hpg7Lo_Q12SyW', type: 'audio/mp4' }, prepared: { id: '1ScJgBpD5YDCkha2H--FcUn8hzZ8-3wAT', type: 'application/json; charset=utf-8' }, epub: { id: '1AKrSzEmc5DY-mQA3vkgC_1RjO941e1Vy', type: 'application/epub+zip' }, alignment: { id: '1jow8e9prX0w9P3-E2hcRCe2X5y24Pw8Y', type: 'application/json' }, cover: { id: '13QsFZ6mtYOBSNHebSJ7_Zh_wQVkuWceu', type: 'image/jpeg' } },
};

async function getBucket() {
  try { return (await import('cloudflare:workers') as { env: RuntimeEnv }).env.BOOKS; } catch { return undefined; }
}

function rangeFor(request: Request, totalBytes: number) {
  const raw = request.headers.get('range');
  if (!raw) return { start: 0, end: Math.min(totalBytes - 1, audioChunkSize - 1) };
  const match = raw.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  if (!match[1]) { const suffix = Number(match[2]); return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, totalBytes - suffix), end: totalBytes - 1 } : undefined; }
  const start = Number(match[1]); const requestedEnd = match[2] ? Number(match[2]) : start + audioChunkSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= totalBytes) return undefined;
  return { start, end: Math.min(totalBytes - 1, requestedEnd) };
}

async function cachedAsset(request: Request, book: CachedBook, asset: BookAsset) {
  const bucket = await getBucket();
  if (!bucket) return undefined;
  if (asset !== 'audio') {
    const object = await bucket.get(objectKey(book, asset));
    if (!object?.body) return undefined;
    const headers = new Headers({ 'Content-Type': assetContentTypes[asset], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    if (asset === 'prepared') return new Response(object.body.pipeThrough(new DecompressionStream('gzip')), { headers });
    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  }
  const manifestObject = await bucket.get(`${book}/audio-manifest`);
  if (!manifestObject?.body) return undefined;
  const manifest = JSON.parse(await new Response(manifestObject.body).text()) as AudioManifest;
  if (!Number.isSafeInteger(manifest.parts) || !Number.isSafeInteger(manifest.totalBytes) || manifest.parts < 1 || manifest.totalBytes < 1) return undefined;
  const range = rangeFor(request, manifest.totalBytes);
  if (!range) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${manifest.totalBytes}` } });
  const firstPart = Math.floor(range.start / audioChunkSize); const lastPart = Math.floor(range.end / audioChunkSize);
  const stream = new ReadableStream<Uint8Array>({ async start(controller) { try {
    for (let part = firstPart; part <= lastPart; part += 1) {
      const chunkStart = part * audioChunkSize; const offset = Math.max(0, range.start - chunkStart); const end = Math.min(audioChunkSize, range.end - chunkStart + 1);
      const object = await bucket.get(objectKey(book, 'audio', part), { range: { offset, length: end - offset } });
      if (!object?.body) throw new Error('Audio cache chunk is missing');
      const reader = object.body.getReader(); while (true) { const result = await reader.read(); if (result.done) break; controller.enqueue(result.value); }
    }
    controller.close();
  } catch (error) { controller.error(error); } } });
  return new Response(stream, { status: 206, headers: { 'Content-Type': manifest.contentType || assetContentTypes.audio, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${manifest.totalBytes}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

async function driveAsset(request: Request, file: DriveFile, asset: string) {
  const range = request.headers.get('range');
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response('Invalid range', { status: 416 });
  const openRange = asset === 'audio' && range?.match(/^bytes=(\d+)-$/); const start = openRange ? Number(openRange[1]) : 0;
  if (openRange && !Number.isSafeInteger(start + audioChunkSize)) return new Response('Invalid range', { status: 416 });
  const upstreamRange = openRange ? `bytes=${start}-${start + audioChunkSize - 1}` : range;
  try {
    const upstream = await fetch(`https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`, { headers: upstreamRange ? { Range: upstreamRange } : {}, signal: request.signal });
    if (upstream.status === 416) { await upstream.body?.cancel(); return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': upstream.headers.get('content-range') || '' } }); }
    if (!upstream.ok || upstream.headers.get('content-type')?.includes('text/html')) { const responseText = upstream.headers.get('content-type')?.includes('text/html') ? await upstream.text() : ''; console.error('Drive asset request failed', { asset, status: upstream.status, quota: responseText.toLowerCase().includes('quota') }); if (!responseText) await upstream.body?.cancel(); return new Response('The reader file is being cached. Please try again.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    const headers = new Headers({ 'Content-Type': file.type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    for (const key of ['content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(key); if (value) headers.set(key, value); }
    if (asset === 'prepared') { headers.delete('content-length'); return new Response(upstream.body!.pipeThrough(new DecompressionStream('gzip')), { status: 200, headers }); }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return new Response('The reader file is being cached. Please try again.', { status: 503 }); }
}

export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params; const id = new URL(request.url).searchParams.get('book') || 'dungeon-crawler-carl';
  const file = Object.hasOwn(books, id) && Object.hasOwn(books[id], asset) ? books[id][asset] : undefined;
  if (!file || !isCachedBook(id) || !isBookAsset(asset)) return new Response('Not found', { status: 404 });
  return (await cachedAsset(request, id, asset)) ?? driveAsset(request, file, asset);
}

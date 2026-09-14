import { assetContentTypes, audioChunkSize, isBookAsset, isCachedBook, objectKey } from '@/lib/book-cache';

type RuntimeEnv = { BOOKS?: R2Bucket };

async function getBucket() {
  try {
    const runtime = await import('cloudflare:workers') as { env: RuntimeEnv };
    return runtime.env.BOOKS;
  } catch {
    return undefined;
  }
}

function numberHeader(request: Request, name: string) {
  const value = Number(request.headers.get(name));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function POST(request: Request) {
  const book = request.headers.get('x-book') ?? '';
  const asset = request.headers.get('x-asset') ?? '';
  const part = numberHeader(request, 'x-part');
  const parts = numberHeader(request, 'x-parts');
  const totalBytes = numberHeader(request, 'x-total-bytes');
  if (!isCachedBook(book) || !isBookAsset(asset) || part === undefined || parts === undefined || parts < 1 || parts > 256 || part >= parts) {
    return new Response('Invalid upload details', { status: 400 });
  }
  if (asset !== 'audio' && (part !== 0 || parts !== 1)) return new Response('Invalid asset upload', { status: 400 });
  const bucket = await getBucket();
  if (!bucket) return new Response('Book cache is unavailable', { status: 503 });

  if (request.headers.get('x-complete') === '1') {
    if (asset !== 'audio' || !totalBytes || part !== parts - 1) return new Response('Invalid audio manifest', { status: 400 });
    await bucket.put(`${book}/audio-manifest`, JSON.stringify({ parts, totalBytes, contentType: request.headers.get('content-type') || assetContentTypes.audio }), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    return Response.json({ stored: 'manifest' });
  }

  const contentLength = numberHeader(request, 'content-length');
  if (!contentLength || contentLength > audioChunkSize || !request.body) return new Response('Invalid upload body', { status: 400 });
  await bucket.put(objectKey(book, asset, part), request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') || assetContentTypes[asset] },
  });
  return Response.json({ stored: objectKey(book, asset, part), contentLength });
}

export async function DELETE(request: Request) {
  const book = request.headers.get('x-book') ?? '';
  const asset = request.headers.get('x-asset') ?? '';
  const parts = numberHeader(request, 'x-parts');
  if (!isCachedBook(book) || !isBookAsset(asset) || parts === undefined || parts < 1 || parts > 256) return new Response('Invalid cache details', { status: 400 });
  const bucket = await getBucket();
  if (!bucket) return new Response('Book cache is unavailable', { status: 503 });
  if (asset === 'audio') {
    await bucket.delete([...Array.from({ length: parts }, (_, part) => objectKey(book, 'audio', part)), `${book}/audio-manifest`]);
  } else {
    await bucket.delete(objectKey(book, asset));
  }
  return Response.json({ deleted: asset });
}

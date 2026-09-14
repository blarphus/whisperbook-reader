export const bookAssetTypes = ['audio', 'prepared', 'epub', 'alignment', 'cover'] as const;
export type BookAsset = (typeof bookAssetTypes)[number];

export const cachedBooks = [
  'dungeon-crawler-carl',
  'the-car',
  'scythe',
  'eragon',
  'project-hail-mary',
  'just-mercy',
] as const;
export type CachedBook = (typeof cachedBooks)[number];

export const assetContentTypes: Record<BookAsset, string> = {
  audio: 'audio/mp4',
  prepared: 'application/json; charset=utf-8',
  epub: 'application/epub+zip',
  alignment: 'application/json; charset=utf-8',
  cover: 'image/jpeg',
};

export const audioChunkSize = 1024 * 1024;

export function isCachedBook(value: string): value is CachedBook {
  return (cachedBooks as readonly string[]).includes(value);
}

export function isBookAsset(value: string): value is BookAsset {
  return (bookAssetTypes as readonly string[]).includes(value);
}

export function objectKey(book: CachedBook, asset: BookAsset, part?: number) {
  return asset === 'audio' ? `${book}/audio/${part ?? 0}` : `${book}/${asset}`;
}

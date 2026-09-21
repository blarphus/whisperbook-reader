// Books added with scripts/add_book.py live in R2 (catalog.json) instead of in code, so adding one needs no deploy.
import {preparedKeys,r2Books} from './storage';
import type {BookMetadata} from './catalog';
export type RemoteBook=BookMetadata&{classes?:string[];prepared?:string;hidden?:boolean;needsReview?:boolean;audioExtension?:string;addedAt?:string};

export type RemoteData={books:RemoteBook[];overrides:Record<string,string[]>};
let cache:Promise<RemoteData>|null=null;
export function loadRemoteCatalog(){
 cache??=fetch('/api/catalog').then(r=>r.ok?r.json() as Promise<Partial<RemoteData>>:({} as Partial<RemoteData>)).then(d=>({books:d.books??[],overrides:d.overrides??{}})).catch(()=>({books:[],overrides:{}}) as RemoteData).then(data=>{const books=data.books;
  for(const b of books){if(b.prepared)preparedKeys[b.id]=b.prepared;r2Books[b.id]={extension:b.audioExtension||'m4a'}}
  return data;
 });
 return cache;
}

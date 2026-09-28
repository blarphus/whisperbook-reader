import {r2Origin} from './media-origin';
import {hasBucket} from './admin/env';
import {readCatalog,readOverrides} from './admin/store';
import type {RemoteBook} from './remote-catalog';

type Data={books:RemoteBook[];overrides:Record<string,string[]>};
let cached:{at:number;data:Data}|null=null;

// The books added from the admin page plus the class overrides. Read through the R2 binding when available (always fresh),
// otherwise through the public media address; remembered for 15 seconds per Worker instance.
export async function remoteCatalog():Promise<Data>{
 if(cached&&Date.now()-cached.at<15_000)return cached.data;
 try{
  let data:Data;
  if(hasBucket())data={books:(await readCatalog()).books,overrides:await readOverrides()};
  else{
   const get=async(k:string)=>{const r=await fetch(`${r2Origin}/${k}`);return r.ok?await r.json():null};
   data={books:((await get('catalog.json')) as {books?:RemoteBook[]}|null)?.books??[],overrides:((await get('class-overrides.json')) as Record<string,string[]>|null)??{}};
  }
  // Keep catalog clients on the reader origin for covers as well as audio.
  // The source objects remain in R2, while school filters only need to allow
  // the approved reader hostname.
  const coverPrefix=`${r2Origin}/covers/`;
  for(const b of data.books){
   if(typeof b.cover==='string'&&b.cover.startsWith(coverPrefix))b.cover=`/api/media/covers/${b.cover.slice(coverPrefix.length)}`;
  }
  cached={at:Date.now(),data};
  return data;
 }catch{return cached?.data??{books:[],overrides:{}}}
}
export const remoteBooks=async()=>(await remoteCatalog()).books;
export const clearCatalogCache=()=>{cached=null};

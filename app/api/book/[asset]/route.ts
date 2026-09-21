import {preparedKeys,r2Origin} from '../../../../lib/storage';
import {remoteBooks} from '../../../../lib/remote-catalog-server';

// Reader packages live in R2 (built-in books are listed in lib/storage.ts, added books in the catalog); fetched server-side so browsers never need CORS access to the bucket.
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}){
 const {asset}=await params;const id=new URL(request.url).searchParams.get('book')||'';
 if(asset!=='prepared')return new Response('Not found',{status:404});
 const preparedKey=Object.hasOwn(preparedKeys,id)?preparedKeys[id]:(await remoteBooks()).find(b=>b.id===id)?.prepared;
 if(!preparedKey)return new Response('Not found',{status:404});
 const upstream=await fetch(`${r2Origin}/${preparedKey}`,{signal:request.signal});
 if(!upstream.ok||!upstream.body)return new Response('Reader package unavailable',{status:502});
 return new Response(upstream.body,{status:200,headers:{'Content-Type':'application/gzip','Cache-Control':'public, max-age=3600'}});
}

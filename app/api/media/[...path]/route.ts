import {r2Origin} from '../../../../lib/media-origin';

// Browser media requests stay on studentbookreader.com. Only the public
// reader assets that the app needs may be proxied to the R2 custom domain.
// Keeping this allow-list narrow avoids turning the route into a general R2
// proxy.
const AUDIO_PATH=/^audio\/[a-z0-9-]+\/segment-\d{3,}\.(?:m4a|m4b|mp3|opus|ogg)$/i;
const COVER_PATH=/^covers\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp|svg)$/i;
const FORWARDED_REQUEST_HEADERS=['range','if-range','if-none-match','if-modified-since'];
const RESPONSE_HEADERS=['accept-ranges','cache-control','content-length','content-range','content-type','etag','last-modified'];

export async function GET(request:Request,{params}:{params:Promise<{path?:string[]}>}){
 const segments=(await params).path||[];
 // Vinext can include the query string in the final catch-all segment on a
 // deployed Worker. R2 object keys do not include it, so remove it before
 // validating and fetching the key.
 const key=segments.join('/').split('?')[0];
 if(!AUDIO_PATH.test(key)&&!COVER_PATH.test(key))return new Response('Not found',{status:404});
 const headers=new Headers();
 for(const name of FORWARDED_REQUEST_HEADERS){const value=request.headers.get(name);if(value)headers.set(name,value)}
 let upstream:Response;
 try{upstream=await fetch(`${r2Origin}/${key}`,{headers,signal:request.signal})}
 catch{return new Response('Media unavailable',{status:502})}
 if(!upstream.body)return new Response('Media unavailable',{status:502});
 const responseHeaders=new Headers();
 for(const name of RESPONSE_HEADERS){const value=upstream.headers.get(name);if(value)responseHeaders.set(name,value)}
 return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
}

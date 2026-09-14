const relay = 'https://script.google.com/macros/s/AKfycbzutkLMbOkhlTczODwVfG9LR_oSzURVEMDtj_rnq0TYkvkNqo3nLny-EWRo2f-qkRkB/exec';
const books = {
  'dungeon-crawler-carl': {size:773787995, type:'audio/mp4'},
  'the-car': {size:123387948, type:'audio/mp4'},
  'scythe': {size:189822576, type:'audio/mpeg'},
  'eragon': {size:937347313, type:'audio/mp4'},
  'project-hail-mary': {size:924595694, type:'audio/mp4'},
  'just-mercy': {size:189060663, type:'audio/mp4'},
  'the-martian': {size:169264860, type:'audio/mp4'}
};
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const prefix = new URL('drive-audio/', self.registration.scope).pathname;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return;
  const book = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!books[book]) return;
  event.respondWith(streamAudio(event.request, book));
});
async function streamAudio(request, book) {
  const {size,type} = books[book];
  const header = request.headers.get('range');
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (header && (!match || (!match[1]&&!match[2]))) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  let start = match ? (match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]))) : 0;
  let end = match && match[1] && match[2] ? Number(match[2]) : size-1;
  if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  end=Math.min(end,size-1,start+8*1024*1024-1);
  const abort = new AbortController();
  request.signal.addEventListener('abort',()=>abort.abort(),{once:true});
  let position=start;
  const body = new ReadableStream({
    async pull(controller) {
      if(position>end){controller.close();return;}
      const last=Math.min(end,position+1048576-1);
      try {
        const url=new URL(relay);
        for(const [key,value] of Object.entries({book,asset:'audio',start:position,end:last})) url.searchParams.set(key,String(value));
        const response=await fetch(url,{signal:abort.signal,cache:'no-store',credentials:'omit'});
        if(!response.ok) throw Error('Drive relay could not be reached');
        const chunk=await response.json();
        if(chunk.error||chunk.start!==position||chunk.end!==last||chunk.total!==size) throw Error(chunk.error||'Drive audio range did not match');
        const decoded=atob(chunk.data), bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
        if(bytes.length!==last-position+1) throw Error('Drive audio range was incomplete');
        position=last+1;controller.enqueue(bytes);
      } catch(error){abort.abort();controller.error(error);}
    },
    cancel(){abort.abort();}
  },{highWaterMark:0});
  return new Response(body,{status:206,headers:{'Content-Type':type,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Cache-Control':'no-store'}});
}

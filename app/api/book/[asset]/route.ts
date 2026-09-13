const files:Record<string,{id:string;type:string}>={
 audio:{id:'10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a',type:'audio/mp4'},
 prepared:{id:'1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT',type:'application/json; charset=utf-8'},
 epub:{id:'1_pkY8LQ4d_jwvh61FLe6X5IGPt7o6oeE',type:'application/epub+zip'},
 alignment:{id:'1lCRdBXLG8UdggN6B8j7Vk2ByH4GRDEzq',type:'application/json'}
};
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}){
 const {asset}=await params;const file=files[asset];if(!file)return new Response('Not found',{status:404});
 const range=request.headers.get('range');if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response('Invalid range',{status:416});
 // Drive rejects open-ended audio requests from the hosted worker. Return a
 // bounded partial response; the media element requests the next part as needed.
 const openRange=asset==='audio'&&range?.match(/^bytes=(\d+)-$/);
 const start=openRange?Number(openRange[1]):0;
 if(openRange&&!Number.isSafeInteger(start+8*1024*1024))return new Response('Invalid range',{status:416});
 const upstreamRange=openRange?`bytes=${start}-${start+8*1024*1024-1}`:range;
 try{
 const upstream=await fetch(`https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`,{headers:upstreamRange?{Range:upstreamRange}:{},signal:request.signal});
 if(upstream.status===416){await upstream.body?.cancel();const headers=new Headers({'Cache-Control':'no-store'});const contentRange=upstream.headers.get('content-range');if(contentRange)headers.set('Content-Range',contentRange);return new Response('Range not satisfiable',{status:416,headers});}
 if(!upstream.ok||upstream.headers.get('content-type')?.includes('text/html')){console.error('Drive asset request failed',{asset,status:upstream.status,range:upstreamRange});await upstream.body?.cancel();return new Response('Google Drive could not serve this file. Please try again.',{status:502,headers:{'Cache-Control':'no-store'}});}
 const headers=new Headers({'Content-Type':file.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
 for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(key);if(value)headers.set(key,value);}
 if(asset==='prepared'){headers.delete('content-length');return new Response(upstream.body!.pipeThrough(new DecompressionStream('gzip')),{status:200,headers});}
 return new Response(upstream.body,{status:upstream.status,headers});
 }catch{return new Response('Unable to reach Google Drive. Please try again.',{status:502});}
}

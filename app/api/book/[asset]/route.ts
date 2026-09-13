const files:Record<string,{id:string;type:string}>={
 audio:{id:'10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a',type:'audio/mp4'},
 prepared:{id:'1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT',type:'application/json; charset=utf-8'},
 epub:{id:'1_pkY8LQ4d_jwvh61FLe6X5IGPt7o6oeE',type:'application/epub+zip'},
 alignment:{id:'1lCRdBXLG8UdggN6B8j7Vk2ByH4GRDEzq',type:'application/json'}
};
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}){
 const {asset}=await params;const file=files[asset];if(!file)return new Response('Not found',{status:404});
 const range=request.headers.get('range');if(range&&!/^bytes=\d*-\d*$/.test(range))return new Response('Invalid range',{status:416});
 try{
 const upstream=await fetch(`https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`,{headers:range?{Range:range}:{},signal:request.signal});
 if(!upstream.ok||upstream.headers.get('content-type')?.includes('text/html')){await upstream.body?.cancel();return new Response('Google Drive could not serve this file. Please try again.',{status:502});}
 const headers=new Headers({'Content-Type':file.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
 for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(key);if(value)headers.set(key,value);}
 if(asset==='prepared'){headers.delete('content-length');return new Response(upstream.body!.pipeThrough(new DecompressionStream('gzip')),{status:200,headers});}
 return new Response(upstream.body,{status:upstream.status,headers});
 }catch{return new Response('Unable to reach Google Drive. Please try again.',{status:502});}
}

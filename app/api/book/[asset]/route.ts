import {preparedKeys,r2Origin} from '../../../../lib/drive';
type DriveFile={id:string;type:string};
const books:Record<string,Record<string,DriveFile>>={'dungeon-crawler-carl':{
 audio:{id:'10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a',type:'audio/mp4'},
 prepared:{id:'1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT',type:'application/json; charset=utf-8'},
 epub:{id:'1_pkY8LQ4d_jwvh61FLe6X5IGPt7o6oeE',type:'application/epub+zip'},
 alignment:{id:'1lCRdBXLG8UdggN6B8j7Vk2ByH4GRDEzq',type:'application/json'}
},'the-car':{
 audio:{id:'1pjIxN4uISRCEVRjKIXwYY_wag9x9W7pi',type:'audio/mp4'},
 prepared:{id:'1WpJgogtvI0t6d7GU7vgfTQsVTwZvKvr-',type:'application/json; charset=utf-8'},
 epub:{id:'1xMAkEsN_D4U9eCpTuRRkcl2HPCh3MehX',type:'application/epub+zip'},
 alignment:{id:'18HG1Idfw3fO2wngjVA4antcqlMnUbwHG',type:'application/json'},
 cover:{id:'1XGRrtpMA9Iy3qPc0JgSSXjnI9hvDsm5l',type:'image/jpeg'}
},'scythe':{
 audio:{id:'1-zyKxmuFsuB9T078xNuTEdV3qDOGPNiE',type:'audio/mpeg'},
 prepared:{id:'1w71H201njkS8eGBxxKfKuXh9yBaQTtYG',type:'application/json; charset=utf-8'},
 epub:{id:'1H8JXADJxHwWUYA-8u_jxuGo4yDL2TE53',type:'application/epub+zip'},
 alignment:{id:'1LbB61VgxOGGn6UcW3mIeJa4xZYM0SgBW',type:'application/json'},
 cover:{id:'1zuCMBncZqR8dqBiaq_2pCywZH0iE1C-2',type:'image/jpeg'}
},'eragon':{
 audio:{id:'1RF-J7mzZoG3AJzHM2dj9resgIs5rXrbW',type:'audio/mp4'},
 prepared:{id:'1F6u0OWPWrJenembohmY-2FFVAI0_k4i0',type:'application/json; charset=utf-8'},
 epub:{id:'1mWSCDFj2cnCndtwzLvtzi5XAqIWBascu',type:'application/epub+zip'},
 alignment:{id:'1-V8IsF1SykHnZD2BcGMkpE2hWuT8mqpH',type:'application/json'},
 cover:{id:'1TSbFN7oSxsC4wj7J-JxzESxU-LqWF59m',type:'image/jpeg'}
},'project-hail-mary':{
 audio:{id:'19EBL2jgPQF6DFpTCVEjo9An99wgqI94L',type:'audio/mp4'},
 prepared:{id:'1TDYNIIX78ohGncIHZVtFd1WEORB9ooCU',type:'application/json; charset=utf-8'},
 epub:{id:'1WolXvTtv99RqxkIkkPzeF5lv12IvW7zr',type:'application/epub+zip'},
 alignment:{id:'1Nzm0QxN4q-ArY6VZXh4rseUK8xWRIkPb',type:'application/json'},
 cover:{id:'1oEoe34k3638n45QvRWJSbll-u2cRYSw3',type:'image/jpeg'}
},'just-mercy':{
 audio:{id:'1Sp-XYQWbs0g6iOjQpl0hpg7Lo_Q12SyW',type:'audio/mp4'},
 prepared:{id:'1ScJgBpD5YDCkha2H--FcUn8hzZ8-3wAT',type:'application/json; charset=utf-8'},
 epub:{id:'1AKrSzEmc5DY-mQA3vkgC_1RjO941e1Vy',type:'application/epub+zip'},
 alignment:{id:'1jow8e9prX0w9P3-E2hcRCe2X5y24Pw8Y',type:'application/json'},
 cover:{id:'13QsFZ6mtYOBSNHebSJ7_Zh_wQVkuWceu',type:'image/jpeg'}
},'bad-beginning':{audio:{id:'1a1Q8EneIitIh7Z8BQ8kIoJAo-Xw54O-o',type:'audio/mp4'},prepared:{id:'1LE2C6_Nw3U4hGl1sNumQpZdKEpp52WFJ',type:'application/json; charset=utf-8'}},'harry-potter':{audio:{id:'1gVuElWYYn0yyfliFYKUeb4q-R8ry4isG',type:'audio/ogg; codecs=opus'},prepared:{id:'1tVKydOfk7aGDrqFokr1xA8qIOxYEXrkP',type:'application/json; charset=utf-8'}}};
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}){
 const {asset}=await params;const id=new URL(request.url).searchParams.get('book')||'dungeon-crawler-carl';
 if(asset==='prepared'&&Object.hasOwn(preparedKeys,id)){
  // Reader packages live in R2; fetch them server-side so browsers never need CORS access to the bucket.
  const upstream=await fetch(`${r2Origin}/${preparedKeys[id]}`,{signal:request.signal});
  if(!upstream.ok||!upstream.body)return new Response('Reader package unavailable',{status:502});
  return new Response(upstream.body,{status:200,headers:{'Content-Type':'application/gzip','Cache-Control':'public, max-age=3600'}});
 }
 const file=Object.hasOwn(books,id)&&Object.hasOwn(books[id],asset)?books[id][asset]:undefined;if(!file)return new Response('Not found',{status:404});
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
 if(!upstream.ok||upstream.headers.get('content-type')?.includes('text/html')){const responseText=upstream.headers.get('content-type')?.includes('text/html')?await upstream.text():'';const pageTitle=responseText.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];const reason=['Virus scan warning','Too many users','quota','Download anyway','Sign in','Access denied','download-form'].filter(value=>responseText.toLowerCase().includes(value.toLowerCase()));console.error('Drive asset request failed',{asset,status:upstream.status,range:upstreamRange,pageTitle,reason});if(!responseText)await upstream.body?.cancel();return new Response('Google Drive could not serve this file. Please try again.',{status:502,headers:{'Cache-Control':'no-store'}});}
 const headers=new Headers({'Content-Type':file.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
 for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(key);if(value)headers.set(key,value);}
 if(asset==='prepared'){headers.delete('content-length');return new Response(upstream.body!.pipeThrough(new DecompressionStream('gzip')),{status:200,headers});}
 return new Response(upstream.body,{status:upstream.status,headers});
 }catch{return new Response('Unable to reach Google Drive. Please try again.',{status:502});}
}

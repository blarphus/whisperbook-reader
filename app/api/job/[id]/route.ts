// Private callback used by the Kaggle pipeline: it reports progress, uploads results, and registers the finished book.
// Every call must carry the one-off job token (x-job-token); uploads are limited to this book's own folders.
import {reply} from '../../../../lib/admin/auth';
import {hashToken} from '../../../../lib/admin/launch';
import {bucket} from '../../../../lib/admin/env';
import {deletePrefix,getJob,readCatalog,saveJob,writeCatalog,type Job} from '../../../../lib/admin/store';
import {deleteKernel} from '../../../../lib/admin/kaggle';

const FINAL=new Set(['done','cancelled']);

async function authorised(request:Request,job:Job|null){
 const token=request.headers.get('x-job-token')||'';
 return Boolean(job&&job.tokenHash&&token&&(await hashToken(token))===job.tokenHash&&!FINAL.has(job.status));
}
const allowedKey=(job:Job,key:string|null):key is string=>Boolean(key&&!key.includes('..')&&
 (key.startsWith(`audio/${job.bookId}/`)||key.startsWith(`reader/${job.bookId}/`)||key.startsWith(`covers/${job.bookId}.`)||key.startsWith(`jobs/${job.id}/`)));

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const job=await getJob((await params).id);
 if(!(await authorised(request,job)))return reply({error:'Unauthorised'},401);
 const url=new URL(request.url),key=url.searchParams.get('key'),mp=url.searchParams.get('mp');
 if(!allowedKey(job!,key)||!request.body)return reply({error:'Invalid upload'},400);
 const type=request.headers.get('content-type')||'application/octet-stream',cache=url.searchParams.get('cache')||undefined;
 if(mp==='part'){
  const part=await bucket().resumeMultipartUpload(key,url.searchParams.get('uploadId')||'').uploadPart(Number(url.searchParams.get('n')),request.body);
  return reply({partNumber:part.partNumber,etag:part.etag});
 }
 await bucket().put(key,request.body,{httpMetadata:{contentType:type,cacheControl:cache}});
 return reply({ok:true,key});
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const id=(await params).id,job=await getJob(id);
 if(!(await authorised(request,job)))return reply({error:'Unauthorised'},401);
 const j=job!,url=new URL(request.url),mp=url.searchParams.get('mp'),key=url.searchParams.get('key');
 if(mp){
  if(!allowedKey(j,key))return reply({error:'Invalid upload'},400);
  if(mp==='create'){const m=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:url.searchParams.get('type')||'application/octet-stream',cacheControl:url.searchParams.get('cache')||undefined}});return reply({uploadId:m.uploadId})}
  if(mp==='complete'){const {uploadId,parts}=(await request.json()) as any;const o=await bucket().resumeMultipartUpload(key,uploadId).complete(parts);return reply({key,size:o.size})}
  return reply({error:'Unknown multipart step'},400);
 }
 const b=(await request.json().catch(()=>({}))) as any;
 switch(b.event){
  case 'progress':
   j.progress={stage:String(b.stage||''),pct:Math.round(Math.max(0,Math.min(100,Number(b.pct)||0))*100)/100,message:String(b.message||'').slice(0,300),at:new Date().toISOString(),...(Number.isFinite(Number(b.eta))&&b.eta!==null?{eta:Math.round(Number(b.eta))}:{}),...(Number.isFinite(Number(b.pos))&&b.pos!==null?{pos:Number(b.pos)}:{}),...(Number.isFinite(Number(b.item))&&b.item!==null?{item:Number(b.item)}:{})};
   await saveJob(j);break;
  case 'inspected':
   j.chapters=Array.isArray(b.chapters)?b.chapters.slice(0,500).map((c:any)=>({title:String(c.title||'').slice(0,200),start:Number(c.start)||0,end:Number(c.end)||0})):[];
   j.inspect={duration:Number(b.duration)||0,codec:String(b.codec||''),ext:String(b.ext||''),epub:b.epub&&typeof b.epub==='object'?b.epub:undefined,notes:Array.isArray(b.notes)?b.notes.map(String).slice(0,20):[]};
   j.status='inspected';j.progress=undefined;await saveJob(j);
   if(j.kernel)await deleteKernel(j.kernel);break;
  case 'register':{
   const e=b.entry||{};
   if(e.id!==j.bookId||typeof e.prepared!=='string'||!e.prepared.startsWith(`reader/${j.bookId}/`)||!Array.isArray(e.markers)||!Array.isArray(e.chapters))return reply({error:'Invalid catalog entry'},400);
   const cover=typeof e.cover==='string'&&(e.cover.startsWith(`https://media.studentbookreader.com/covers/${j.bookId}.`)||e.cover==='/covers/placeholder.svg')?e.cover:'/covers/placeholder.svg';
   const entry={id:e.id,title:j.title,author:j.author,narrator:j.narrator,duration:Number(e.duration),introEnd:Number(e.introEnd)||0,creditsStart:Number(e.creditsStart)||Number(e.duration),
    audioOnlyIntroduction:Boolean(e.audioOnlyIntroduction),version:1,markers:e.markers,chapters:e.chapters,assetRevision:String(e.assetRevision||''),cover,chapterCount:e.chapters.length,
    classes:j.classes,prepared:e.prepared,audioExtension:String(e.audioExtension||'m4a'),addedAt:new Date().toISOString(),hidden:true,needsReview:Boolean(b.needsReview)};
   const cat=await readCatalog();cat.books=[...cat.books.filter(x=>x.id!==entry.id),entry as any];await writeCatalog(cat);break;
  }
  case 'done':
   j.status='review';j.result=b.result&&typeof b.result==='object'?b.result:{};j.progress={stage:'done',pct:100,message:'Finished. Review the book, then publish it.',at:new Date().toISOString()};
   await saveJob(j);await deletePrefix(`inbox/${id}/`);if(j.kernel)await deleteKernel(j.kernel);break;
  case 'failed':
   j.status=j.status==='inspecting'?'uploaded':'inspected';j.error=String(b.error||'The pipeline failed.').slice(0,1500);await saveJob(j);break;
  default:return reply({error:'Unknown event'},400);
 }
 return reply({ok:true});
}

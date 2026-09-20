// Uploads from the admin page go to the R2 inbox (inbox/<jobId>/...) in parts, so a 1 GB audiobook never sits in memory.
import {reply,requireAdmin} from '../../../../lib/admin/auth';
import {bucket} from '../../../../lib/admin/env';

const okKey=(k:string|null):k is string=>Boolean(k&&/^inbox\/[a-f0-9]{12}\/[A-Za-z0-9._-]{1,120}$/.test(k));

export async function POST(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const url=new URL(request.url),action=url.searchParams.get('action'),key=url.searchParams.get('key');
 if(!okKey(key))return reply({error:'Invalid file name'},400);
 if(action==='create'){
  const mp=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:url.searchParams.get('type')||'application/octet-stream'}});
  return reply({uploadId:mp.uploadId});
 }
 if(action==='complete'){
  const {uploadId,parts}=(await request.json()) as {uploadId:string;parts:{partNumber:number;etag:string}[]};
  const obj=await bucket().resumeMultipartUpload(key,uploadId).complete(parts);
  return reply({key,size:obj.size});
 }
 if(action==='abort'){await bucket().resumeMultipartUpload(key,url.searchParams.get('uploadId')||'').abort().catch(()=>{});return reply({ok:true})}
 return reply({error:'Unknown action'},400);
}

export async function PUT(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const url=new URL(request.url),key=url.searchParams.get('key'),uploadId=url.searchParams.get('uploadId'),n=Number(url.searchParams.get('part'));
 if(!okKey(key)||!uploadId||!Number.isInteger(n)||n<1||n>10000||!request.body)return reply({error:'Invalid part'},400);
 const part=await bucket().resumeMultipartUpload(key,uploadId).uploadPart(n,request.body);
 return reply({partNumber:part.partNumber,etag:part.etag});
}

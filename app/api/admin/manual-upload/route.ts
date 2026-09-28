import {reply,requireAdmin} from '../../../../lib/admin/auth';
import {bucket} from '../../../../lib/admin/env';

// Manual imports go directly to their final R2 keys. This is protected by the
// same admin session as the catalogue and keeps large audio uploads multipart.
const okKey=(k:string|null):k is string=>Boolean(k&&(
 /^audio\/[a-z0-9-]+\/[A-Za-z0-9._-]{1,120}$/.test(k)||
 /^reader\/[a-z0-9-]+\/[a-f0-9]{16}\.json\.gz$/.test(k)||
 /^covers\/[a-z0-9-]+\.[A-Za-z0-9]{1,8}$/.test(k)
));

export async function POST(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const url=new URL(request.url),action=url.searchParams.get('action'),key=url.searchParams.get('key');
 if(!okKey(key))return reply({error:'Invalid destination key.'},400);
 if(action==='create'){
  const mp=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:url.searchParams.get('type')||'application/octet-stream',cacheControl:url.searchParams.get('cache')||'public, max-age=31536000, immutable'}});
  return reply({uploadId:mp.uploadId});
 }
 if(action==='complete'){
  const {uploadId,parts}=(await request.json()) as {uploadId:string;parts:{partNumber:number;etag:string}[]};
  const obj=await bucket().resumeMultipartUpload(key,uploadId).complete(parts);
  return reply({key,size:obj.size});
 }
 return reply({error:'Unknown multipart action.'},400);
}

export async function PUT(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const url=new URL(request.url),key=url.searchParams.get('key'),uploadId=url.searchParams.get('uploadId'),n=Number(url.searchParams.get('part'));
 if(!okKey(key)||!uploadId||!Number.isInteger(n)||n<1||n>10000||!request.body)return reply({error:'Invalid upload part.'},400);
 const part=await bucket().resumeMultipartUpload(key,uploadId).uploadPart(n,request.body);
 return reply({partNumber:part.partNumber,etag:part.etag});
}

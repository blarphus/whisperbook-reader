// Chunked, resumable-per-part uploads to the R2 inbox through the site (multipart), with progress.
const PART=32*1024*1024;      // 32 MB parts (R2 needs >= 5 MB except the last)
const PARALLEL=3;

export const api=async<T=any>(url:string,init:RequestInit={}):Promise<T>=>{
 const r=await fetch(url,{credentials:'same-origin',...init,headers:{'x-requested-with':'wb',...(init.body&&!(init.body instanceof Blob)?{'content-type':'application/json'}:{}),...init.headers}});
 const data=(await r.json().catch(()=>({}))) as {error?:string};
 if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
 return data as T;
};

// One part as an XMLHttpRequest so the browser reports real bytes sent (fetch cannot), which keeps the progress bar honest.
const putPart=(url:string,blob:Blob,onBytes:(n:number)=>void)=>new Promise<{partNumber:number;etag:string}>((resolve,reject)=>{
 const x=new XMLHttpRequest();x.open('PUT',url);x.withCredentials=true;x.setRequestHeader('x-requested-with','wb');
 x.upload.onprogress=e=>onBytes(e.loaded);
 x.onload=()=>{try{const d=JSON.parse(x.responseText);x.status<300?resolve(d):reject(new Error(d.error||`Upload failed (${x.status})`))}catch{reject(new Error(`Upload failed (${x.status})`))}};
 x.onerror=()=>reject(new Error('Network error while uploading'));x.send(blob);
});

export async function uploadFile(key:string,file:File,onProgress:(sent:number)=>void){
 const {uploadId}=await api<{uploadId:string}>(`/api/admin/upload?action=create&key=${encodeURIComponent(key)}&type=${encodeURIComponent(file.type||'application/octet-stream')}`,{method:'POST'});
 const total=Math.max(1,Math.ceil(file.size/PART)),parts:{partNumber:number;etag:string}[]=[],sent=new Array(total).fill(0);
 const report=()=>onProgress(Math.min(file.size,sent.reduce((a,b)=>a+b,0)));
 let next=0;
 const worker=async()=>{
  while(next<total){
   const n=++next-1,blob=file.slice(n*PART,(n+1)*PART);
   for(let attempt=0;;attempt++){
    try{
     const r=await putPart(`/api/admin/upload?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&part=${n+1}`,blob,b=>{sent[n]=b;report()});
     parts.push({partNumber:r.partNumber,etag:r.etag});sent[n]=blob.size;report();break;
    }catch(e){sent[n]=0;report();if(attempt>=3){await api(`/api/admin/upload?action=abort&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,{method:'POST'}).catch(()=>{});throw e}
     await new Promise(r=>setTimeout(r,1500*(attempt+1)))}
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(PARALLEL,total)},worker));
 parts.sort((a,b)=>a.partNumber-b.partNumber);
 await api(`/api/admin/upload?action=complete&key=${encodeURIComponent(key)}`,{method:'POST',body:JSON.stringify({uploadId,parts})});
}

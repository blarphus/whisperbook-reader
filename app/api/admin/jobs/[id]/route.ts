import {reply,requireAdmin} from '../../../../../lib/admin/auth';
import {launchJob} from '../../../../../lib/admin/launch';
import {deleteKernel,kernelStatus} from '../../../../../lib/admin/kaggle';
import {deletePrefix,getJob,saveJob,type FileRef,type Job} from '../../../../../lib/admin/store';

const RUNNING=new Set(['inspecting','processing']);

/** If Kaggle says the run ended but the job never reported back, fail it instead of spinning forever. */
async function refresh(job:Job){
 if(!RUNNING.has(job.status)||!job.kernel)return job;
 if(Date.now()-new Date(job.progress?.at||job.updatedAt).getTime()<90_000)return job;
 try{
  const {status,failure}=await kernelStatus(job.kernel);
  if(['ERROR','CANCEL_ACKNOWLEDGED','CANCEL_REQUESTED'].includes(status)||(status==='COMPLETE'&&Date.now()-new Date(job.updatedAt).getTime()>180_000)){
   job.status='failed';
   job.error=`The Kaggle run ended (${status.toLowerCase()}) before finishing. ${failure}`.trim()+(job.kernelUrl?` See its log: ${job.kernelUrl}`:'');
   await saveJob(job);
  }
 }catch{/* keep waiting */}
 return job;
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireAdmin(request);if(denied)return denied;
 const job=await getJob((await params).id);
 if(!job)return reply({error:'Not found'},404);
 return reply({job:await refresh(job)});
}

const fileRef=(f:any,id:string):FileRef|undefined=>{
 if(!f||typeof f.key!=='string'||!f.key.startsWith(`inbox/${id}/`))return undefined;
 return {key:f.key,name:String(f.name||'').slice(0,200),size:Number(f.size)||0,type:String(f.type||'')};
};

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireAdmin(request);if(denied)return denied;
 const id=(await params).id,job=await getJob(id);
 if(!job)return reply({error:'Not found'},404);
 const b=(await request.json().catch(()=>({}))) as any,origin=new URL(request.url).origin;
 try{
  switch(b.action){
   case 'files':{
    job.files={audio:fileRef(b.files?.audio,id),epub:fileRef(b.files?.epub,id),cover:fileRef(b.files?.cover,id)}
    if(Array.isArray(b.files?.audioParts)){const parts=b.files.audioParts.slice(0,40).map((x:unknown)=>fileRef(x,id));if(parts.some((x:unknown)=>!x))return reply({error:'Invalid audio file list.'},400);job.files.audioParts=parts as FileRef[]}
    if(!job.files.audio)return reply({error:'The audiobook is needed.'},400);
    job.status='uploaded';job.error=undefined;await saveJob(job);break;
   }
   case 'inspect':
    if(!job.files.audio)return reply({error:'Upload the files first.'},400);
    await launchJob(job,'inspect',origin);break;
   case 'process':
    if(job.status!=='inspected')return reply({error:'Check the chapters first.'},400);
    if(b.chaptersVerified!==true)return reply({error:'Confirm the chapter list is correct first.'},400);
    if(Array.isArray(b.sectionIndices))job.sectionIndices=b.sectionIndices.map(Number).filter(Number.isInteger).slice(0,500);
    await launchJob(job,'process',origin);break;
   case 'retry':
    job.status=job.chapters?'inspected':'uploaded';job.error=undefined;job.progress=undefined;await saveJob(job);break;
   case 'cancel':
    if(job.kernel)await deleteKernel(job.kernel);
    job.status='cancelled';await saveJob(job);await deletePrefix(`inbox/${id}/`);break;
   default:return reply({error:'Unknown action'},400);
  }
 }catch(e){
  job.status=job.status==='inspecting'?'uploaded':job.status==='processing'?'inspected':job.status;
  job.error=e instanceof Error?e.message:String(e);await saveJob(job);
  return reply({error:job.error,job},502);
 }
 return reply({job});
}

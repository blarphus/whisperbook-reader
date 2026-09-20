import {getEnv} from './env';

const API='https://api.kaggle.com/v1/kernels.KernelsApiService';
export const kaggleUser=()=>getEnv('KAGGLE_USERNAME')||'josh123benja';

async function call(method:string,body:unknown){
 const token=getEnv('KAGGLE_API_TOKEN');
 if(!token)throw new Error('KAGGLE_API_TOKEN is not configured');
 const r=await fetch(`${API}/${method}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 const text=await r.text();
 let data:any={};try{data=JSON.parse(text)}catch{}
 if(!r.ok||(data.code&&data.code>=400))throw new Error(`Kaggle ${method} failed (${r.status}): ${(data.message||text).slice(0,300)}`);
 return data;
}

/** Starts a private Kaggle script with a GPU (or CPU) and internet. Returns the kernel slug and URL. */
export async function pushKernel(opts:{name:string;code:string;gpu:boolean;datasets:string[]}){
 const slug=`${kaggleUser()}/${opts.name}`;
 const data=await call('SaveKernel',{slug,newTitle:opts.name,text:opts.code,language:'python',kernelType:'script',isPrivate:true,enableGpu:opts.gpu,enableTpu:false,enableInternet:true,datasetDataSources:opts.datasets,competitionDataSources:[],kernelDataSources:[],modelDataSources:[],categoryIds:[]});
 if(data.error)throw new Error(`Kaggle rejected the job: ${data.error}`);
 return {slug,url:data.url||`https://www.kaggle.com/code/${slug}`,invalid:[...(data.invalidDatasetSources||[])]};
}
export async function kernelStatus(slug:string):Promise<{status:string;failure:string}>{
 const [userName,kernelSlug]=slug.split('/');
 const data=await call('GetKernelSessionStatus',{userName,kernelSlug});
 return {status:String(data.status||'').replace(/^KernelWorkerStatus\./,'').toUpperCase(),failure:String(data.failureMessage||'')};
}
/** Deleting the kernel also stops a running session; used for cancel and for cleanup after a job. */
export async function deleteKernel(slug:string){
 const [userName,kernelSlug]=slug.split('/');
 await call('DeleteKernel',{userName,kernelSlug}).catch(()=>{});
}

import {bucket} from './env';
import type {RemoteBook} from '../remote-catalog';

export type FileRef={key:string;name:string;size:number;type:string};
export type Job={
 id:string;bookId:string;createdAt:string;updatedAt:string;
 status:'draft'|'uploaded'|'inspecting'|'inspected'|'processing'|'review'|'done'|'failed'|'cancelled';
 title:string;author:string;narrator:string;classes:string[];
 files:{audio?:FileRef;epub?:FileRef;cover?:FileRef};
 sectionIndices?:number[];tokenHash?:string;kernel?:string;kernelUrl?:string;
 chapters?:{title:string;start:number;end:number}[];inspect?:Record<string,unknown>;
 progress?:{stage:string;pct:number;message:string;at:string};
 result?:Record<string,unknown>;error?:string;
};

export const randomHex=(bytes:number)=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const slugify=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);

async function readJson<T>(key:string):Promise<T|null>{
 const o=await bucket().get(key);
 return o?(await o.json() as T):null;
}
const writeJson=(key:string,value:unknown,cacheControl='no-store')=>bucket().put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json',cacheControl}});

export const getJob=(id:string)=>readJson<Job>(`jobs/${id}.json`);
export async function saveJob(job:Job){job.updatedAt=new Date().toISOString();await writeJson(`jobs/${job.id}.json`,job)}
export async function listJobs(limit=25):Promise<Job[]>{
 const listed=await bucket().list({prefix:'jobs/',limit:200});
 const keys=listed.objects.filter((o:any)=>o.key.endsWith('.json')).sort((a:any,b:any)=>+new Date(b.uploaded)-+new Date(a.uploaded)).slice(0,limit);
 const jobs=await Promise.all(keys.map((o:any)=>readJson<Job>(o.key)));
 return jobs.filter(Boolean) as Job[];
}
/** Deletes every object under a prefix (used for the temporary inbox and for removing a book). */
export async function deletePrefix(prefix:string){
 let cursor:string|undefined;
 do{
  const page=await bucket().list({prefix,cursor,limit:500});
  if(page.objects.length)await bucket().delete(page.objects.map((o:any)=>o.key));
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
}

// ---- the list of books added from the admin page ----
export type Catalog={version:1;updated?:string;books:RemoteBook[]};
export async function readCatalog():Promise<Catalog>{return (await readJson<Catalog>('catalog.json'))??{version:1,books:[]}}
export async function writeCatalog(cat:Catalog){cat.updated=new Date().toISOString();await writeJson('catalog.json',cat,'public, max-age=30')}

export async function readOverrides():Promise<Record<string,string[]>>{return (await readJson<Record<string,string[]>>('class-overrides.json'))??{}}
export const writeOverrides=(o:Record<string,string[]>)=>writeJson('class-overrides.json',o,'public, max-age=30');

import {catalog} from '../../../../lib/catalog';
import {reply,requireAdmin} from '../../../../lib/admin/auth';
import {listJobs,randomHex,saveJob,slugify,type Job} from '../../../../lib/admin/store';

export async function GET(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 return reply({jobs:await listJobs()});
}

export async function POST(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const b=(await request.json().catch(()=>({}))) as Partial<Job>&{bookId?:string};
 const title=String(b.title||'').trim().slice(0,200),author=String(b.author||'').trim().slice(0,200);
 if(!title||!author)return reply({error:'A title and author are required.'},400);
 const bookId=slugify(String(b.bookId||title));
 if(bookId.length<3)return reply({error:'Could not make a book ID from that title.'},400);
 if(catalog.some(x=>x.id===bookId))return reply({error:`"${bookId}" already exists as a built-in book. Use a different title.`},409);
 const now=new Date().toISOString();
 const job:Job={id:randomHex(6),bookId,createdAt:now,updatedAt:now,status:'draft',title,author,narrator:String(b.narrator||'').trim().slice(0,200),
  classes:(Array.isArray(b.classes)?b.classes:[]).map(String).slice(0,10),files:{}};
 await saveJob(job);
 return reply({job});
}

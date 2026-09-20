import {reply,requireAdmin} from '../../../../lib/admin/auth';
import {deleteKernel} from '../../../../lib/admin/kaggle';
import {deletePrefix,getJob,readCatalog,readOverrides,saveJob,writeCatalog,writeOverrides} from '../../../../lib/admin/store';
import {catalog} from '../../../../lib/catalog';
import {CLASSES,defaultClasses} from '../../../../lib/class-rules';
import {clearCatalogCache} from '../../../../lib/remote-catalog-server';

export async function GET(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 return reply({books:await allBooks()});
}

// Every book on the site: the ones built into the code (class lists can still be overridden) and the ones added here.
async function allBooks(){
 const [cat,overrides]=await Promise.all([readCatalog(),readOverrides()]);
 const built=catalog.map(b=>({id:b.id,title:b.title,author:b.author,narrator:b.narrator,duration:b.duration,chapterCount:b.chapterCount??b.chapters?.length,cover:b.cover,builtIn:true,classes:overrides[b.id]??defaultClasses(b.id)}));
 return [...built,...cat.books.map(b=>({...b,classes:overrides[b.id]??b.classes??[],builtIn:false}))];
}

export async function POST(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const b=(await request.json().catch(()=>({}))) as {id?:string;action?:string;classes?:string[];jobId?:string};
 const cat=await readCatalog(),book=cat.books.find(x=>x.id===b.id);
 clearCatalogCache();
 if(b.action==='classes'&&catalog.some(x=>x.id===b.id)){
  const o=await readOverrides();o[b.id!]=(b.classes||[]).filter(c=>CLASSES.includes(c));await writeOverrides(o);
  return reply({books:await allBooks()});
 }
 if(!book)return reply({error:'That book is not in the added-books list.'},404);
 if(b.action==='publish'||b.action==='classes'){
  if(Array.isArray(b.classes)){book.classes=b.classes.map(String).filter(c=>CLASSES.includes(c));const o=await readOverrides();if(b.id&&o[b.id]){delete o[b.id];await writeOverrides(o)}}
  if(b.action==='publish'){(book as any).hidden=false;delete (book as any).needsReview}
 }else if(b.action==='cover'){
  const u=String((b as any).coverUrl||'');
  if(!/^https:\/\/media\.studentbookreader\.com\/covers\/[A-Za-z0-9._-]+(\?v=[A-Za-z0-9]+)?$/.test(u))return reply({error:'Invalid cover address.'},400);
  book.cover=u;
 }else if(b.action==='hide')(book as any).hidden=true;
 else if(b.action==='remove'){
  cat.books=cat.books.filter(x=>x.id!==book.id);
  await Promise.all([deletePrefix(`audio/${book.id}/`),deletePrefix(`reader/${book.id}/`),deletePrefix(`covers/${book.id}`)]);
 }else return reply({error:'Unknown action'},400);
 await writeCatalog(cat);
 if(b.jobId){const job=await getJob(b.jobId);if(job&&b.action==='publish'){job.status='done';await saveJob(job);if(job.kernel)await deleteKernel(job.kernel)}}
 return reply({books:await allBooks()});
}

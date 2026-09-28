import {reply,requireAdmin} from '../../../../lib/admin/auth';
import {readCatalog,writeCatalog} from '../../../../lib/admin/store';
import {clearCatalogCache} from '../../../../lib/remote-catalog-server';

export async function POST(request:Request){
 const denied=await requireAdmin(request);if(denied)return denied;
 const b=await request.json().catch(()=>null) as any;
 const id=String(b?.id||'');
 if(!/^[a-z0-9-]{3,60}$/.test(id)||!b||typeof b.title!=='string'||typeof b.author!=='string'||!Array.isArray(b.chapters)||!Array.isArray(b.markers))return reply({error:'Invalid book metadata.'},400);
 const chapters=b.chapters.map((c:any)=>({title:String(c.title),start:Number(c.start),end:Number(c.end)}));
 if(!chapters.length||chapters.some((c:any)=>!c.title||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start))return reply({error:'Invalid chapter timings.'},400);
 const prepared=String(b.prepared||''),audioExtension=String(b.audioExtension||'m4b');
 if(prepared!==`reader/${id}/${String(b.assetRevision||'')}.json.gz`||!/^[a-f0-9]{16}$/.test(String(b.assetRevision||'')))return reply({error:'Invalid reader package reference.'},400);
 if(!/^[a-z0-9]{2,5}$/.test(audioExtension))return reply({error:'Invalid audio extension.'},400);
 const cat=await readCatalog();
 const markers=b.markers.map((m:any)=>({title:String(m.title),start:Number(m.start),end:Number(m.end)}));
 if(markers.some((m:any)=>!m.title||!Number.isFinite(m.start)||!Number.isFinite(m.end)||m.start<0||m.end<=m.start))return reply({error:'Invalid marker timings.'},400);
 const entry={id,title:b.title,author:b.author,narrator:String(b.narrator||''),duration:Number(b.duration),introEnd:Number(b.introEnd)||chapters[0].start,creditsStart:Number(b.creditsStart)||Number(b.duration),audioOnlyIntroduction:Boolean(b.audioOnlyIntroduction),version:1,markers,chapters,assetRevision:String(b.assetRevision),cover:String(b.cover||`https://media.studentbookreader.com/covers/${id}.jpg`),chapterCount:chapters.length,classes:Array.isArray(b.classes)?b.classes.map(String):[],prepared,audioExtension,addedAt:new Date().toISOString(),hidden:false};
 if(!Number.isFinite(entry.duration)||entry.duration<=0)return reply({error:'Invalid duration.'},400);
 cat.books=[...cat.books.filter(x=>x.id!==id),entry as any];await writeCatalog(cat);clearCatalogCache();
 return reply({book:entry});
}

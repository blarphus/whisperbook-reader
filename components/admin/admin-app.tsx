'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api,uploadFile} from './upload';

import {CLASSES} from '../../lib/class-rules';
type Job={id:string;bookId:string;status:string;title:string;author:string;narrator:string;classes:string[];chapters?:{title:string;start:number;end:number}[];
 inspect?:{duration?:number;codec?:string;epub?:{sections:number;words:number;titles:string[]};notes?:string[]};
 progress?:{stage:string;pct:number;message:string;at:string;eta?:number;pos?:number;item?:number};result?:any;error?:string;kernelUrl?:string;createdAt:string};
type Book={id:string;title:string;author:string;classes?:string[];hidden?:boolean;needsReview?:boolean;chapterCount?:number;duration:number;cover?:string;builtIn?:boolean};

const clock=(t:number)=>{t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`};
const STATUS:Record<string,string>={draft:'Not started',uploaded:'Files uploaded',inspecting:'Checking files…',inspected:'Chapters ready to confirm',processing:'Processing on Kaggle…',review:'Ready to review',done:'Published',failed:'Failed',cancelled:'Cancelled'};
type FileRefT={key:string;name:string;size:number;type:string};
const etaText=(p?:{eta?:number;at:string})=>{if(!p||p.eta==null)return '';const left=Math.max(0,p.eta-(Date.now()-new Date(p.at).getTime())/1000);return left<90?' · about a minute left':left<5400?` · about ${Math.round(left/60)} min left`:` · about ${(left/3600).toFixed(1)} h left`};
const ext=(name:string)=>(name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1]||'bin').toLowerCase();

export function AdminApp(){
 const [signedIn,setSignedIn]=useState<boolean|null>(null);
 useEffect(()=>{if(location.protocol==='http:'&&!/^(localhost|127\.)/.test(location.hostname)){location.replace(location.href.replace('http:','https:'));return}
  api<{signedIn:boolean}>('/api/admin/login').then(r=>setSignedIn(r.signedIn)).catch(()=>setSignedIn(false))},[]);
 if(signedIn===null)return <main className="admin"><p className="admin-muted">Loading…</p></main>;
 return signedIn?<Dashboard onSignOut={()=>{void api('/api/admin/login',{method:'DELETE'}).finally(()=>setSignedIn(false))}}/>:<Login onDone={()=>setSignedIn(true)}/>;
}

function Login({onDone}:{onDone:()=>void}){
 const [pw,setPw]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');
  try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:pw})});onDone()}catch(err){setError(err instanceof Error?err.message:'Could not sign in')}finally{setBusy(false)}};
 return <main className="admin admin-narrow"><form className="admin-card" onSubmit={submit}>
  <h1>Admin</h1><p className="admin-muted">Sign in to add books to the library.</p>
  <input type="password" autoFocus autoComplete="current-password" placeholder="Password" value={pw} onChange={e=>setPw(e.target.value)} aria-label="Password"/>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <button className="admin-primary" disabled={busy||!pw}>{busy?'Checking…':'Sign in'}</button>
 </form></main>;
}

function Dashboard({onSignOut}:{onSignOut:()=>void}){
 const [jobs,setJobs]=useState<Job[]>([]),[books,setBooks]=useState<Book[]>([]),[active,setActive]=useState<string|null>(null),[error,setError]=useState('');
 const [tab,setTab]=useState<string>('all'),[query,setQuery]=useState(''),[menu,setMenu]=useState<{book:Book;x:number;y:number}|null>(null),[adding,setAdding]=useState(''),[fresh,setFresh]=useState(false);
 const load=useCallback(async()=>{
  try{const [j,b]=await Promise.all([api<{jobs:Job[]}>('/api/admin/jobs'),api<{books:Book[]}>('/api/admin/books')]);setJobs(j.jobs);setBooks(b.books)}catch(e){setError(e instanceof Error?e.message:'Could not load')}
 },[]);
 useEffect(()=>{void load()},[load]);
 const running=jobs.filter(j=>['inspecting','processing'].includes(j.status));
 useEffect(()=>{if(tab==='add'&&!active&&!fresh&&running.length)setActive(running[0].id)},[tab,active,fresh,running]);
 const shownId=fresh?null:(active||running[0]?.id);
 const others=running.filter(j=>!(tab==='add'&&j.id===shownId));
 useEffect(()=>{if(!running.length)return;const t=setInterval(()=>void load(),6000);return()=>clearInterval(t)},[running.length,load]);
 useEffect(()=>{if(!menu)return;const close=()=>setMenu(null),key=(e:KeyboardEvent)=>{if(e.key==='Escape')close()};
  window.addEventListener('click',close);window.addEventListener('scroll',close,true);window.addEventListener('keydown',key);window.addEventListener('resize',close);
  return()=>{window.removeEventListener('click',close);window.removeEventListener('scroll',close,true);window.removeEventListener('keydown',key);window.removeEventListener('resize',close)}},[menu]);
 const bookAction=async(id:string,action:string,classes?:string[],jobId?:string)=>{
  if(action==='remove'&&!confirm('Remove this book and delete its audio files from storage? This cannot be undone.'))return;
  try{const r=await api<{books:Book[]}>('/api/admin/books',{method:'POST',body:JSON.stringify({id,action,classes,jobId})});setBooks(r.books);void load()}catch(e){setError(e instanceof Error?e.message:'Failed')}
 };
 const toggleClass=(b:Book,c:string)=>{const cur=b.classes||[];void bookAction(b.id,'classes',cur.includes(c)?cur.filter(x=>x!==c):[...cur,c])};
 const q=query.trim().toLowerCase(),match=(b:Book)=>!q||`${b.title} ${b.author}`.toLowerCase().includes(q);
 const inTab=(b:Book)=>tab==='all'||(b.classes||[]).includes(tab);
 const shown=books.filter(b=>inTab(b)&&match(b));
 const pending=jobs.filter(j=>!['done','cancelled'].includes(j.status)).length;
 const candidates=CLASSES.includes(tab)&&adding.trim()?books.filter(b=>!(b.classes||[]).includes(tab)&&`${b.title} ${b.author}`.toLowerCase().includes(adding.trim().toLowerCase())).slice(0,6):[];
 return <main className="admin admin-wide">
  <header className="admin-head"><div><h1>Library admin</h1><a className="admin-muted" href="/">← Back to the library</a></div><button onClick={onSignOut}>Sign out</button></header>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <nav className="admin-tabs" role="tablist">
   {[['all','Full catalogue',books.length],...CLASSES.map(c=>[c,c,books.filter(b=>(b.classes||[]).includes(c)).length] as [string,string,number])].map(([id,label,n])=>
    <button key={id} role="tab" aria-selected={tab===id} className={tab===id?'on':''} onClick={()=>{setTab(id as string);setQuery('');setAdding('')}}>{label}<span>{n}</span></button>)}
   <button role="tab" aria-selected={tab==='add'} className={`add${tab==='add'?' on':''}`} onClick={()=>setTab('add')}>+ Add a book{pending>0&&<span>{pending}</span>}</button>
  </nav>
  {others.length>0&&<section className="admin-card admin-running" aria-live="polite"><h2>{tab==='add'?'Also running':`Working on ${others.length===1?'1 book':`${others.length} books`}`}</h2>
   {others.map(j=><div key={j.id} className="admin-progress"><div><span><b>{j.title}</b> — {j.progress?.message||'Starting…'}{etaText(j.progress)}</span><b>{(j.progress?.pct??0).toFixed(2)}%</b></div><progress max={100} value={j.progress?.pct??0}/>
    <button onClick={()=>{setActive(j.id);setTab('add');window.scrollTo({top:0,behavior:'smooth'})}}>Details</button></div>)}</section>}
  {tab==='add'?<>
   {(active||running.length>0)&&<div className="admin-actions">{fresh?<button onClick={()=>setFresh(false)}>← Back to the running book</button>:<button className="admin-primary" onClick={()=>{setFresh(true);setActive(null)}}>+ Start another book</button>}</div>}
   <Wizard key={fresh?'new':(active||'new')} jobId={fresh?null:active} onChange={()=>void load()} onClose={()=>{setActive(null);setFresh(false);void load()}}/>
   <section className="admin-card"><h2>Recent uploads</h2>
    {jobs.filter(j=>j.status!=='cancelled').length===0?<p className="admin-muted">Nothing yet.</p>:<ul className="admin-list">{jobs.filter(j=>j.status!=='cancelled').map(j=><li key={j.id}>
     <div><strong>{j.title}</strong> <span className="admin-muted">{new Date(j.createdAt).toLocaleString()}</span><div className="admin-tags"><span className={`tag ${j.status==='failed'||j.status==='draft'?'bad':j.status==='done'?'ok':''}`}>{j.status==='draft'?'Upload didn’t finish — nothing was received':STATUS[j.status]||j.status}</span></div></div>
     <div className="admin-actions">{j.status==='draft'&&<button onClick={async()=>{try{await api(`/api/admin/jobs/${j.id}`,{method:'POST',body:JSON.stringify({action:'cancel'})});void load()}catch(e){setError(e instanceof Error?e.message:'Failed')}}}>Discard</button>}{!['done','cancelled','draft'].includes(j.status)&&<button onClick={()=>{setActive(j.id);window.scrollTo({top:0,behavior:'smooth'})}}>Continue</button>}</div></li>)}</ul>}
   </section></>:<>
   <div className="admin-toolbar">
    <input className="admin-search" type="search" placeholder={tab==='all'?'Search all books…':`Search ${tab}…`} value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search books"/>
    {CLASSES.includes(tab)&&<div className="admin-adder"><input type="search" placeholder={`Add a book to ${tab}…`} value={adding} onChange={e=>setAdding(e.target.value)} aria-label="Add a book to this class"/>
     {candidates.length>0&&<ul>{candidates.map(b=><li key={b.id}><button onClick={()=>{toggleClass(b,tab);setAdding('')}}><b>{b.title}</b><span>{b.author}</span><i>Add</i></button></li>)}</ul>}
     {adding.trim()&&candidates.length===0&&<ul><li className="none">No other book matches.</li></ul>}</div>}
   </div>
   <p className="admin-muted admin-hint">Right-click a book (or press its ⋯ button) to choose which classes show it.</p>
   {shown.length===0?<p className="admin-muted">{books.length?'No books here.':'Loading…'}</p>:<ul className="admin-grid">{shown.map(b=>
    <li key={b.id} className={b.hidden?'hiddenbook':''} onContextMenu={e=>{e.preventDefault();setMenu({book:b,x:e.clientX,y:e.clientY})}}>
     <div className="cover">{b.cover?<img src={b.cover} alt="" loading="lazy"/>:<span>{b.title.slice(0,1)}</span>}</div>
     <div className="meta"><strong>{b.title}</strong><span>{b.author}</span><span>{b.chapterCount??'?'} chapters · {clock(b.duration)}</span>
      <div className="admin-tags">{b.hidden&&<span className="tag warn">Hidden{b.needsReview?' · needs review':''}</span>}{(b.classes||[]).length===0&&!b.hidden&&<span className="tag bad">In no class</span>}{tab==='all'&&(b.classes||[]).map(c=><span className="tag" key={c}>{c}</span>)}</div></div>
     <button className="dots" aria-label={`Options for ${b.title}`} onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setMenu({book:b,x:r.left,y:r.bottom})}}>⋯</button>
    </li>)}</ul>}
  </>}
  {menu&&(()=>{const b=books.find(x=>x.id===menu.book.id)||menu.book;return <div className="admin-menu" role="menu" style={{left:Math.min(menu.x,window.innerWidth-300),top:Math.min(menu.y,window.innerHeight-330)}} onClick={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()}>
   <div className="title">{b.title}</div><div className="label">Show in these classes</div>
   {CLASSES.map(c=><label key={c}><input type="checkbox" checked={(b.classes||[]).includes(c)} onChange={()=>toggleClass(b,c)}/> {c}</label>)}
   <hr/><a href={`/#read/${b.id}`} target="_blank" rel="noreferrer" role="menuitem">Open the book</a>
   {!b.builtIn&&(b.hidden?<button role="menuitem" onClick={()=>{void bookAction(b.id,'publish',b.classes);setMenu(null)}}>Publish</button>:<button role="menuitem" onClick={()=>{void bookAction(b.id,'hide');setMenu(null)}}>Hide from students</button>)}
   {!b.builtIn&&<button role="menuitem" className="danger" onClick={()=>{setMenu(null);void bookAction(b.id,'remove')}}>Remove…</button>}
  </div>})()}
 </main>;
}

// One row per audiobook chapter. While transcribing, each row fills as the narration reaches it; splitting and uploading then tick chapters off in order.
function ChapterProgress({chapters,p,duration}:{chapters:{title:string;start:number;end:number}[];p?:Job['progress'];duration?:number}){
 if(!p||!chapters.length)return null;
 const rows=chapters.map((c,i)=>{
  let pct=0,label='Waiting';
  const pos=p.pos??(p.stage==='transcribe'&&duration?(p.pct-20)/40*duration:undefined);
  if(p.stage==='transcribe'&&pos!=null){pct=Math.max(0,Math.min(100,100*(pos-c.start)/Math.max(1,c.end-c.start)));label=pct>=100?'Transcribed':pct>0?'Transcribing':'Waiting'}
  else if(['align','split','upload'].includes(p.stage)){pct=100;label='Transcribed';
   if(p.stage==='split'||p.stage==='upload'){const done=p.item??0;label=p.stage==='split'?(i<done?'Audio cut':'Transcribed'):(i<done?'Uploaded':'Audio cut')}}
  return {title:c.title,pct,label}});
 return <details className="admin-chapprog" open><summary>Progress by chapter</summary><ul>{rows.map((r,i)=><li key={i} className={r.pct>=100?'done':''}><span>{r.title}</span><progress max={100} value={r.pct}/><em>{r.pct>0&&r.pct<100?`${r.pct.toFixed(1)}%`:r.label}</em></li>)}</ul></details>;
}

function Wizard({jobId,onChange,onClose}:{jobId:string|null;onChange:()=>void;onClose:()=>void}){
 const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[upload,setUpload]=useState<{label:string;pct:number}|null>(null);
 const [form,setForm]=useState({title:'',author:'',narrator:'',classes:['English 9']});
 const files=useRef<{audio?:File[];epub?:File;cover?:File}>({}),[picked,setPicked]=useState({audio:'',epub:'',cover:''}),[verified,setVerified]=useState(false),[publishClasses,setPublishClasses]=useState<string[]>([]);
 const started=useRef(Date.now());

 const refresh=useCallback(async(id:string)=>{try{const {job:j}=await api<{job:Job}>(`/api/admin/jobs/${id}`);setJob(j);return j}catch(e){setError(e instanceof Error?e.message:'Could not load');return null}},[]);
 useEffect(()=>{if(jobId)void refresh(jobId).then(j=>{if(j)setPublishClasses(j.classes)})},[jobId,refresh]);
 useEffect(()=>{
  if(!job||!['inspecting','processing'].includes(job.status))return;
  const t=setInterval(()=>void refresh(job.id).then(()=>onChange()),3000);return()=>clearInterval(t);
 },[job?.id,job?.status,refresh,onChange]);

 const act=async(action:string,extra:object={})=>{
  if(!job)return;setBusy(true);setError('');
  try{const r=await api<{job:Job}>(`/api/admin/jobs/${job.id}`,{method:'POST',body:JSON.stringify({action,...extra})});setJob(r.job);started.current=Date.now();onChange()}
  catch(e){setError(e instanceof Error?e.message:'Failed');void refresh(job.id)}finally{setBusy(false)}
 };

 const start=async(e:React.FormEvent)=>{
  e.preventDefault();const f=files.current;
  if(!f.audio?.length){setError('Choose the audiobook.');return}
  setBusy(true);setError('');
  let createdId='';
  try{
   const {job:created}=await api<{job:Job}>('/api/admin/jobs',{method:'POST',body:JSON.stringify(form)});
   createdId=created.id;setJob(created);
   const refs:{audio?:FileRefT;audioParts?:FileRefT[];epub?:FileRefT;cover?:FileRefT}={};
   const queue:{kind:'audio'|'epub'|'cover';file:File;name:string;what:string}[]=[
    ...f.audio.map((file,i)=>({kind:'audio' as const,file,name:f.audio!.length>1?`audio-${String(i+1).padStart(2,'0')}.${ext(file.name)}`:`audio.${ext(file.name)}`,what:f.audio!.length>1?`audiobook file ${i+1} of ${f.audio!.length}`:'the audiobook'})),
    ...(f.epub?[{kind:'epub' as const,file:f.epub,name:'book.epub',what:'the ebook'}]:[]),...(f.cover?[{kind:'cover' as const,file:f.cover,name:`cover.${ext(f.cover.name)}`,what:'the cover'}]:[])];
   const all=queue.reduce((n,x)=>n+x.file.size,0);let done=0;const t0=Date.now();
   for(const {kind,file,name,what} of queue){
    const key=`inbox/${created.id}/${name}`;
    await uploadFile(key,file,sent=>{const got=done+sent,secs=(Date.now()-t0)/1000,rate=got/Math.max(secs,.5),left=rate>0?(all-got)/rate:0;
     setUpload({label:`Uploading ${what} · ${(got/2**20).toFixed(0)} of ${(all/2**20).toFixed(0)} MB${secs>3?` · ${left>90?Math.round(left/60)+' min':Math.round(left)+' s'} left`:''}`,pct:100*got/all})});
    done+=file.size;const ref={key,name:file.name,size:file.size,type:file.type};
    if(kind==='audio')(refs.audioParts??=[]).push(ref);else refs[kind]=ref;
   }
   refs.audio=refs.audioParts![0];if(refs.audioParts!.length===1)delete refs.audioParts;
   setUpload({label:'Saving…',pct:100});
   await api(`/api/admin/jobs/${created.id}`,{method:'POST',body:JSON.stringify({action:'files',files:refs})});
   const r=await api<{job:Job}>(`/api/admin/jobs/${created.id}`,{method:'POST',body:JSON.stringify({action:'inspect'})});
   setJob(r.job);setPublishClasses(r.job.classes);onChange();
  }catch(err){setError(err instanceof Error?err.message:'Upload failed');if(createdId)void refresh(createdId)}finally{setBusy(false);setUpload(null)}
 };

 const elapsed=Math.floor((Date.now()-started.current)/60000);
 const pick=(kind:'epub'|'cover')=>(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];files.current[kind]=f;setPicked(p=>({...p,[kind]:f?.name||''}))};
 const pickAudio=(e:React.ChangeEvent<HTMLInputElement>)=>{const list=[...(e.target.files||[])].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));files.current.audio=list;setPicked(p=>({...p,audio:list.length>1?`${list.length} files, in this order: ${list.map(x=>x.name).join(' → ')}`:list[0]?.name||''}))};
 const toggle=(list:string[],c:string)=>list.includes(c)?list.filter(x=>x!==c):[...list,c];

 // ---- new book form
 if(!job)return <form className="admin-card" onSubmit={start}>
  <h2>Add a book</h2>
  <p className="admin-muted">Upload the audiobook and the ebook. The chapters are checked first, then the site transcribes and aligns everything on a Kaggle GPU. Nothing is shown to students until you publish it.</p>
  <label>Title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="The Hunger Games"/></label>
  <label>Author<input required value={form.author} onChange={e=>setForm({...form,author:e.target.value})} placeholder="Suzanne Collins"/></label>
  <label><span>Narrator <span className="admin-muted">(optional)</span></span><input value={form.narrator} onChange={e=>setForm({...form,narrator:e.target.value})} placeholder="Tatiana Maslany"/></label>
  <fieldset><legend>Show it in these classes</legend>{CLASSES.map(c=><label className="admin-check" key={c}><input type="checkbox" checked={form.classes.includes(c)} onChange={()=>setForm({...form,classes:toggle(form.classes,c)})}/> {c}</label>)}
   <p className="admin-muted">You can change these any time from the catalogue.</p></fieldset>
  <label><span>Audiobook <span className="admin-muted">(.m4b with chapter marks, .mp3, .opus; choose several files if it comes in parts)</span></span><input type="file" required multiple accept=".m4b,.m4a,.mp3,.opus,.ogg,audio/*" onChange={pickAudio}/>{picked.audio&&<small>{picked.audio}</small>}</label>
  <label><span>Ebook <span className="admin-muted">(.epub; optional — without one the text is the transcript)</span></span><input type="file" accept=".epub,application/epub+zip" onChange={pick('epub')}/>{picked.epub&&<small>{picked.epub}</small>}</label>
  <label><span>Cover image <span className="admin-muted">(optional; otherwise the audiobook’s artwork is used)</span></span><input type="file" accept="image/*" onChange={pick('cover')}/></label>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  {upload&&<div className="admin-progress"><div><span>{upload.label}</span><b>{upload.pct.toFixed(2)}%</b></div><progress max={100} value={upload.pct}/></div>}
  <button className="admin-primary" disabled={busy}>{busy?'Working…':'Upload and check chapters'}</button>
 </form>;

 // ---- an existing job
 const s=job.status,p=job.progress;
 return <section className="admin-card">
  <h2>{job.title} <span className="admin-muted">— {STATUS[s]||s}</span></h2>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  {job.error&&s!=='review'&&<p className="admin-error" role="alert" style={{whiteSpace:'pre-wrap'}}>{job.error}</p>}
  {upload&&<div className="admin-progress"><div><span>{upload.label}</span><b>{upload.pct.toFixed(2)}%</b></div><progress max={100} value={upload.pct}/></div>}

  {(s==='inspecting'||s==='processing')&&<div className="admin-progress"><div><span>{p?.message||'Starting…'}{etaText(p)}</span><b>{(p?.pct??0).toFixed(2)}%</b></div><progress max={100} value={p?.pct??0}/>
   <p className="admin-muted">{s==='processing'?'This usually takes 30–60 minutes for a full-length book. You can close this page; come back and press Continue.':'This usually takes a minute or two.'} {elapsed>0&&`Elapsed: ${elapsed} min. `}{job.kernelUrl&&<a href={job.kernelUrl} target="_blank" rel="noreferrer">See the Kaggle run</a>}</p>
   <button onClick={()=>act('cancel')} disabled={busy}>Cancel</button></div>}
  {s==='processing'&&job.chapters&&<ChapterProgress chapters={job.chapters} p={p} duration={job.inspect?.duration}/>}

  {s==='inspected'&&job.chapters&&<div>
   <p>The audiobook has <b>{job.chapters.length} chapters</b> ({clock(job.inspect?.duration||0)}).{job.inspect?.epub&&<> The ebook has <b>{job.inspect.epub.sections} sections</b> and {job.inspect.epub.words.toLocaleString()} words.</>}</p>
   {(job.inspect?.notes||[]).map((n,i)=><p className="admin-warn" key={i}>{n}</p>)}
   <div className="admin-two"><div><h3>Audio chapters</h3><ol className="admin-chapters">{job.chapters.map((c,i)=><li key={i}><span>{c.title}</span><time>{clock(c.start)}</time></li>)}</ol></div>
    {job.inspect?.epub&&<div><h3>Ebook sections</h3><ol className="admin-chapters">{(job.inspect.epub.titles||[]).map((t,i)=><li key={i}><span>{t}</span></li>)}</ol></div>}</div>
   <label className="admin-check"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I checked these chapter names and times against the official edition, and they’re correct.</label>
   <div className="admin-actions"><button className="admin-primary" disabled={!verified||busy} onClick={()=>act('process',{chaptersVerified:true})}>Transcribe and align</button><button onClick={()=>act('cancel')} disabled={busy}>Cancel</button></div></div>}

  {s==='review'&&job.result&&<div>
   {job.result.mode==='transcript'?<p>Built the reading text from the transcript: <b>{job.result.bookWords?.toLocaleString()} words</b> in {job.result.chapters} chapters ({job.result.hours} h). There is no ebook to compare against, so listen to a few spots and check names.</p>:<p>Matched <b>{(job.result.coverage*100).toFixed(1)}%</b> of the ebook’s words to the audio ({job.result.matchedWords?.toLocaleString()} of {job.result.bookWords?.toLocaleString()}). Chapters: {job.result.chapters}. Length: {job.result.hours} h.</p>}
   {job.result.needsReview?<p className="admin-warn"><b>Needs a look before publishing.</b> The match was below your usual 97.5%, or some sections matched poorly. Open the book below and listen to the weak spots.</p>:<p className="admin-ok">Looks in line with your other books.</p>}
   {job.result.weakSections?.length>0&&<><h3>Sections that matched poorly</h3><ul className="admin-list">{job.result.weakSections.map((w:any,i:number)=><li key={i}><span>{w.title}</span><span className="admin-muted">{(w.coverage*100).toFixed(0)}% · {w.unmatched} gaps</span></li>)}</ul></>}
   <fieldset><legend>Show it in these classes</legend>{CLASSES.map(c=><label className="admin-check" key={c}><input type="checkbox" checked={publishClasses.includes(c)} onChange={()=>setPublishClasses(toggle(publishClasses,c))}/> {c}</label>)}</fieldset>
   <div className="admin-actions"><a className="admin-link" href={`/#read/${job.bookId}`} target="_blank" rel="noreferrer">Open the book to check it</a>
    <button className="admin-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/api/admin/books',{method:'POST',body:JSON.stringify({id:job.bookId,action:'publish',classes:publishClasses,jobId:job.id})});await refresh(job.id);onChange()}catch(e){setError(e instanceof Error?e.message:'Failed')}finally{setBusy(false)}}}>Publish</button>
    <button onClick={onClose}>Keep it hidden for now</button></div></div>}

  {s==='done'&&<p className="admin-ok">Published. <a href={`/#read/${job.bookId}`}>Open it</a>.</p>}
  {(s==='failed'||s==='uploaded')&&<div className="admin-actions">
   {s==='uploaded'&&<button className="admin-primary" disabled={busy} onClick={()=>act('inspect')}>Check the chapters</button>}
   {s==='failed'&&<button className="admin-primary" disabled={busy} onClick={()=>act('retry')}>Try again</button>}<button onClick={()=>act('cancel')} disabled={busy}>Discard</button></div>}
  {['done','cancelled','failed'].includes(s)&&<button onClick={onClose}>Add another book</button>}
 </section>;
}

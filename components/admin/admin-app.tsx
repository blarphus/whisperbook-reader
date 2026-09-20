'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api,uploadFile} from './upload';

import {CLASSES} from '../../lib/class-rules';
type Job={id:string;bookId:string;status:string;title:string;author:string;narrator:string;classes:string[];chapters?:{title:string;start:number;end:number}[];
 inspect?:{duration?:number;codec?:string;epub?:{sections:number;words:number;titles:string[]};notes?:string[]};
 progress?:{stage:string;pct:number;message:string;at:string};result?:any;error?:string;kernelUrl?:string;createdAt:string};
type Book={id:string;title:string;author:string;classes?:string[];hidden?:boolean;needsReview?:boolean;chapterCount?:number;duration:number;cover?:string;builtIn?:boolean};

const clock=(t:number)=>{t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`};
const STATUS:Record<string,string>={draft:'Not started',uploaded:'Files uploaded',inspecting:'Checking files…',inspected:'Chapters ready to confirm',processing:'Processing on Kaggle…',review:'Ready to review',done:'Published',failed:'Failed',cancelled:'Cancelled'};
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
 const [tab,setTab]=useState<string>('all'),[query,setQuery]=useState(''),[menu,setMenu]=useState<{book:Book;x:number;y:number}|null>(null),[adding,setAdding]=useState('');
 const load=useCallback(async()=>{
  try{const [j,b]=await Promise.all([api<{jobs:Job[]}>('/api/admin/jobs'),api<{books:Book[]}>('/api/admin/books')]);setJobs(j.jobs);setBooks(b.books)}catch(e){setError(e instanceof Error?e.message:'Could not load')}
 },[]);
 useEffect(()=>{void load()},[load]);
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
  {tab==='add'?<>
   <Wizard key={active||'new'} jobId={active} onChange={()=>void load()} onClose={()=>{setActive(null);void load()}}/>
   <section className="admin-card"><h2>Recent uploads</h2>
    {jobs.length===0?<p className="admin-muted">Nothing yet.</p>:<ul className="admin-list">{jobs.map(j=><li key={j.id}>
     <div><strong>{j.title}</strong> <span className="admin-muted">{new Date(j.createdAt).toLocaleString()}</span><div className="admin-tags"><span className={`tag ${j.status==='failed'?'bad':j.status==='done'?'ok':''}`}>{STATUS[j.status]||j.status}</span></div></div>
     <div className="admin-actions">{!['done','cancelled'].includes(j.status)&&<button onClick={()=>{setActive(j.id);window.scrollTo({top:0,behavior:'smooth'})}}>Continue</button>}</div></li>)}</ul>}
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

function Wizard({jobId,onChange,onClose}:{jobId:string|null;onChange:()=>void;onClose:()=>void}){
 const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[upload,setUpload]=useState<{label:string;pct:number}|null>(null);
 const [form,setForm]=useState({title:'',author:'',narrator:'',classes:['English 9']});
 const files=useRef<{audio?:File;epub?:File;cover?:File}>({}),[picked,setPicked]=useState({audio:'',epub:'',cover:''}),[verified,setVerified]=useState(false),[publishClasses,setPublishClasses]=useState<string[]>([]);
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
  if(!f.audio||!f.epub){setError('Choose both the audiobook and the ebook.');return}
  setBusy(true);setError('');
  let createdId='';
  try{
   const {job:created}=await api<{job:Job}>('/api/admin/jobs',{method:'POST',body:JSON.stringify(form)});
   createdId=created.id;setJob(created);
   const refs:Record<string,{key:string;name:string;size:number;type:string}>={};
   const entries=(Object.entries(f) as [string,File|undefined][]).filter((e):e is [string,File]=>Boolean(e[1])),all=entries.reduce((n,[,x])=>n+x.size,0);let done=0;const t0=Date.now();
   for(const [kind,file] of entries){
    const name=kind==='audio'?`audio.${ext(file.name)}`:kind==='epub'?'book.epub':`cover.${ext(file.name)}`,key=`inbox/${created.id}/${name}`;
    const what=kind==='audio'?'the audiobook':kind==='epub'?'the ebook':'the cover';
    await uploadFile(key,file,sent=>{const got=done+sent,secs=(Date.now()-t0)/1000,rate=got/Math.max(secs,.5),left=rate>0?(all-got)/rate:0;
     setUpload({label:`Uploading ${what} · ${(got/2**20).toFixed(0)} of ${(all/2**20).toFixed(0)} MB${secs>3?` · ${left>90?Math.round(left/60)+' min':Math.round(left)+' s'} left`:''}`,pct:100*got/all})});
    done+=file.size;refs[kind]={key,name:file.name,size:file.size,type:file.type};
   }
   setUpload({label:'Saving…',pct:100});
   await api(`/api/admin/jobs/${created.id}`,{method:'POST',body:JSON.stringify({action:'files',files:refs})});
   const r=await api<{job:Job}>(`/api/admin/jobs/${created.id}`,{method:'POST',body:JSON.stringify({action:'inspect'})});
   setJob(r.job);setPublishClasses(r.job.classes);onChange();
  }catch(err){setError(err instanceof Error?err.message:'Upload failed');if(createdId)void refresh(createdId)}finally{setBusy(false);setUpload(null)}
 };

 const elapsed=Math.floor((Date.now()-started.current)/60000);
 const pick=(kind:'audio'|'epub'|'cover')=>(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];files.current[kind]=f;setPicked(p=>({...p,[kind]:f?.name||''}))};
 const toggle=(list:string[],c:string)=>list.includes(c)?list.filter(x=>x!==c):[...list,c];

 // ---- new book form
 if(!job)return <form className="admin-card" onSubmit={start}>
  <h2>Add a book</h2>
  <p className="admin-muted">Upload the audiobook and the ebook. The chapters are checked first, then the site transcribes and aligns everything on a Kaggle GPU. Nothing is shown to students until you publish it.</p>
  <label>Title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="The Hunger Games"/></label>
  <label>Author<input required value={form.author} onChange={e=>setForm({...form,author:e.target.value})} placeholder="Suzanne Collins"/></label>
  <label><span>Narrator <span className="admin-muted">(optional)</span></span><input value={form.narrator} onChange={e=>setForm({...form,narrator:e.target.value})} placeholder="Tatiana Maslany"/></label>
  <fieldset><legend>Show it in these classes</legend>{CLASSES.map(c=><label className="admin-check" key={c}><input type="checkbox" checked={form.classes.includes(c)} onChange={()=>setForm({...form,classes:toggle(form.classes,c)})}/> {c}</label>)}
   <p className="admin-muted">Honors English 10 and Writing for the 21st Century show every book, as they do now.</p></fieldset>
  <label><span>Audiobook <span className="admin-muted">(.m4b with chapter marks, .mp3, .opus)</span></span><input type="file" required accept=".m4b,.m4a,.mp3,.opus,.ogg,audio/*" onChange={pick('audio')}/>{picked.audio&&<small>{picked.audio}</small>}</label>
  <label><span>Ebook <span className="admin-muted">(.epub)</span></span><input type="file" required accept=".epub,application/epub+zip" onChange={pick('epub')}/>{picked.epub&&<small>{picked.epub}</small>}</label>
  <label><span>Cover image <span className="admin-muted">(optional; otherwise the audiobook’s artwork is used)</span></span><input type="file" accept="image/*" onChange={pick('cover')}/></label>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  {upload&&<div className="admin-progress"><div><span>{upload.label}</span><b>{upload.pct.toFixed(0)}%</b></div><progress max={100} value={upload.pct}/></div>}
  <button className="admin-primary" disabled={busy}>{busy?'Working…':'Upload and check chapters'}</button>
 </form>;

 // ---- an existing job
 const s=job.status,p=job.progress;
 return <section className="admin-card">
  <h2>{job.title} <span className="admin-muted">— {STATUS[s]||s}</span></h2>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  {job.error&&s!=='review'&&<p className="admin-error" role="alert" style={{whiteSpace:'pre-wrap'}}>{job.error}</p>}
  {upload&&<div className="admin-progress"><div><span>{upload.label}</span><b>{upload.pct.toFixed(0)}%</b></div><progress max={100} value={upload.pct}/></div>}

  {(s==='inspecting'||s==='processing')&&<div className="admin-progress"><div><span>{p?.message||'Starting…'}</span><b>{p?.pct?.toFixed(0)??0}%</b></div><progress max={100} value={p?.pct??0}/>
   <p className="admin-muted">{s==='processing'?'This usually takes 30–60 minutes for a full-length book. You can close this page; come back and press Continue.':'This usually takes a minute or two.'} {elapsed>0&&`Elapsed: ${elapsed} min. `}{job.kernelUrl&&<a href={job.kernelUrl} target="_blank" rel="noreferrer">See the Kaggle run</a>}</p>
   <button onClick={()=>act('cancel')} disabled={busy}>Cancel</button></div>}

  {s==='inspected'&&job.chapters&&<div>
   <p>The audiobook has <b>{job.chapters.length} chapters</b> ({clock(job.inspect?.duration||0)}).{job.inspect?.epub&&<> The ebook has <b>{job.inspect.epub.sections} sections</b> and {job.inspect.epub.words.toLocaleString()} words.</>}</p>
   {(job.inspect?.notes||[]).map((n,i)=><p className="admin-warn" key={i}>{n}</p>)}
   <div className="admin-two"><div><h3>Audio chapters</h3><ol className="admin-chapters">{job.chapters.map((c,i)=><li key={i}><span>{c.title}</span><time>{clock(c.start)}</time></li>)}</ol></div>
    <div><h3>Ebook sections</h3><ol className="admin-chapters">{(job.inspect?.epub?.titles||[]).map((t,i)=><li key={i}><span>{t}</span></li>)}</ol></div></div>
   <label className="admin-check"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I checked these chapter names and times against the official edition, and they’re correct.</label>
   <div className="admin-actions"><button className="admin-primary" disabled={!verified||busy} onClick={()=>act('process',{chaptersVerified:true})}>Transcribe and align</button><button onClick={()=>act('cancel')} disabled={busy}>Cancel</button></div></div>}

  {s==='review'&&job.result&&<div>
   <p>Matched <b>{(job.result.coverage*100).toFixed(1)}%</b> of the ebook’s words to the audio ({job.result.matchedWords?.toLocaleString()} of {job.result.bookWords?.toLocaleString()}). Chapters: {job.result.chapters}. Length: {job.result.hours} h.</p>
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

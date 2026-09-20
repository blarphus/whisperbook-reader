'use client';
import {useEffect,useMemo,useState} from 'react';
import {Search} from 'lucide-react';
import {Sheet,SheetContent,SheetHeader,SheetTitle} from '@/components/ui/sheet';
import {clock,floorIndex,type Book,type Chapter} from '@/lib/reader';

const MAX_RESULTS=300;
const decode=(s:string)=>s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&(?:apos|rsquo);/g,'’').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
const normalize=(w:string)=>w.toLowerCase().replace(/[’‘]/g,"'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g,'');

type Indexed={display:string[];norm:string[]};
// Each word is a <span data-word="n">; keep the text after it (with its punctuation) so snippets read naturally.
function indexChapter(chapter:Chapter):Indexed{
 const parts=decode(chapter.html.replace(/<span class="word" data-word="(\d+)">/g,'\u0001$1\u0002').replace(/<\/span>/g,'').replace(/<[^>]+>/g,' ')).split('\u0001').slice(1);
 const display:string[]=[],norm:string[]=[];
 for(const part of parts){const k=part.indexOf('\u0002'),i=Number(part.slice(0,k)),text=part.slice(k+1).replace(/\s+/g,' ').trim();display[i]=text;norm[i]=normalize(text.split(' ')[0])}
 return{display,norm};
}

type Result={chapter:number;index:number;marks:Set<number>;from:number;to:number;more:boolean};
const matches=(word:string|undefined,token:string)=>Boolean(word)&&(word===token||(token.length>=4&&word!.startsWith(token)));

// Exact phrase first (a single word is just a one-word phrase). If a multi-word phrase never appears together,
// fall back to sentences that contain every word.
function search(book:Book,indexed:Indexed[],query:string){
 const tokens=query.split(/\s+/).map(normalize).filter(Boolean);
 const results:Result[]=[];let total=0,fallback=false;
 if(!tokens.length||tokens.join('').length<2)return{results,total,tokens,fallback};
 book.chapters.forEach((chapter,ci)=>{
  const {display,norm}=indexed[ci];
  for(let i=0;i+tokens.length<=norm.length;i++){
   if(!tokens.every((t,k)=>matches(norm[i+k],t)))continue;
   total++;
   if(results.length<MAX_RESULTS){const marks=new Set<number>();for(let k=0;k<tokens.length;k++)marks.add(i+k);results.push({chapter:ci,index:i,marks,from:Math.max(0,i-10),to:Math.min(display.length,i+tokens.length+10),more:true})}
  }
 });
 if(total===0&&tokens.length>1){
  fallback=true;
  book.chapters.forEach((chapter,ci)=>{
   const {norm}=indexed[ci];
   for(const [from,to] of chapter.sentences){
    const marks=new Set<number>();
    const hit=tokens.every(t=>{let found=false;for(let j=from;j<to;j++)if(matches(norm[j],t)){marks.add(j);found=true}return found});
    if(!hit)continue;
    total++;
    if(results.length<MAX_RESULTS)results.push({chapter:ci,index:Math.min(...marks),marks,from,to:Math.min(to,from+70),more:false});
   }
  });
 }
 return{results,total,tokens,fallback};
}

export function SearchPanel({book,open,onOpenChange,onJump}:{book:Book|null;open:boolean;onOpenChange:(open:boolean)=>void;onJump:(time:number)=>void}){
 const [input,setInput]=useState(''),[query,setQuery]=useState('');
 useEffect(()=>{const id=setTimeout(()=>setQuery(input),150);return()=>clearTimeout(id)},[input]);
 const indexed=useMemo(()=>open&&book?book.chapters.map(indexChapter):null,[open,book]);
 const found=useMemo(()=>book&&indexed?search(book,indexed,query):null,[book,indexed,query]);
 const chapters=found?new Set(found.results.map(r=>r.chapter)).size:0;
 const jump=(r:Result)=>{const chapter=book!.chapters[r.chapter],cue=chapter.cues[r.index]?.[0];onJump(Number.isFinite(cue)&&cue>0?cue:chapter.start);};
 return <Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="search-sheet">
   <SheetHeader><SheetTitle>Search</SheetTitle></SheetHeader>
   <div className="search-controls">
    <label className="search-box"><Search size={18} aria-hidden="true"/><input autoFocus type="search" value={input} onChange={e=>setInput(e.target.value)} placeholder="Search this book" aria-label="Search this book" spellCheck={false} autoComplete="off"/></label>
   </div>
   <div className="search-summary" aria-live="polite">{!found||!found.tokens.length||found.tokens.join('').length<2?'Type a word or phrase to find every place it appears.':found.total===0?'No matches.':`${found.fallback?`No exact phrase found. ${found.total} ${found.total===1?'sentence contains':'sentences contain'} all of these words`:`${found.total} ${found.total===1?'match':'matches'}`} · ${chapters} ${chapters===1?'chapter':'chapters'}${found.results.length>=MAX_RESULTS?` · showing the first ${MAX_RESULTS}`:''}`}</div>
   <div className="search-results">
    {found?.results.map((r,n)=>{const chapter=book!.chapters[r.chapter],{display}=indexed![r.chapter],heading=n===0||found.results[n-1].chapter!==r.chapter;
     return <div key={`${r.chapter}-${r.index}`}>
      {heading&&<div className="search-chapter">{chapter.title||`Chapter ${r.chapter+1}`}</div>}
      <button className="search-result" onClick={()=>jump(r)}>
       <span className="search-snippet">{r.from>0&&r.more&&'… '}{Array.from({length:r.to-r.from},(_,k)=>r.from+k).map(j=><span key={j}>{r.marks.has(j)?<mark>{display[j]}</mark>:display[j]}{' '}</span>)}{r.more&&r.to<display.length&&'…'}</span>
       <span className="search-time">{clock(chapter.cues[r.index]?.[0]||chapter.start)}</span>
      </button>
     </div>})}
   </div>
  </SheetContent>
 </Sheet>;
}

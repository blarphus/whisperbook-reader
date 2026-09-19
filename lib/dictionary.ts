// Client-side lookup over the WordNet shards built by scripts/build-dictionary.mjs.
export type Pos='n'|'v'|'a'|'r';
export type Sense={pos:Pos;definition:string;example?:string};
import {isBlockedWord,isExplicitSense} from './blocklist';
export type Entry={word:string;lemma:string;senses:Sense[];hidden?:boolean};
type Shard=Record<string,[Pos,string,string?][]>;
export const posName:Record<Pos,string>={n:'noun',v:'verb',a:'adjective',r:'adverb'};

const shards=new Map<string,Promise<Shard>>();
let exceptions:Promise<Record<string,string[]>>|null=null;
const load=<T,>(file:string,fallback:T)=>fetch(`/dict/${file}.json`).then(r=>r.ok?r.json() as Promise<T>:fallback).catch(()=>fallback);
const shardKey=(w:string)=>(w.length>1?w.slice(0,2):w+'_').replace(/[^a-z]/g,'_');
const shard=(w:string)=>{const key=shardKey(w);let s=shards.get(key);if(!s){s=load<Shard>(key,{});shards.set(key,s)}return s};
export const preloadDictionary=()=>{exceptions??=load<Record<string,string[]>>('exc',{})};

// [suffix, replacement, parts of speech the base form may contribute]
const rules:[string,string,string][]=[['ies','y','nv'],['ves','f','n'],['ves','fe','n'],['ses','s','nv'],['xes','x','nv'],['zes','z','nv'],['ches','ch','nv'],['shes','sh','nv'],['men','man','n'],['es','','nv'],['es','e','nv'],['s','','nv'],['ing','','v'],['ing','e','v'],['ed','','v'],['ed','e','v'],['est','','ar'],['est','e','ar'],['er','','ar'],['er','e','ar'],['ly','','a']];
function ruleForms(w:string){const out:[string,string][]=[];for(const [suffix,replacement,parts] of rules){if(w.length>suffix.length+1&&w.endsWith(suffix)){const stem=w.slice(0,-suffix.length)+replacement;out.push([stem,parts]);if(/^(ing|ed|er|est)$/.test(suffix)&&/([^aeiou])\1$/.test(stem))out.push([stem.slice(0,-1),parts])}}return out}
const clean=(w:string)=>w.toLowerCase().replace(/[’‘]/g,"'").replace(/(?:'s|s')$/,'').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,'');
const sentence=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);

export async function lookup(raw:string):Promise<Entry|null>{
 const word=clean(raw);if(!word)return null;
 preloadDictionary();
 const irregular=(await exceptions!)[word]||[];
 if(isBlockedWord(word)||irregular.some(isBlockedWord)||ruleForms(word).some(([form])=>isBlockedWord(form)))return{word,lemma:word,senses:[],hidden:true};
 const find=async(w:string)=>(await shard(w))[w];
 const sources:[string,Shard[string]][]=[];
 for(const w of [word,...irregular]){const s=await find(w);if(s)sources.push([w,s])}
 // Regular inflections (turned -> turn): add the base word's matching senses even when the surface form has its own entry.
 let fromRules=0;
 for(const [w,parts] of ruleForms(word)){
  if(fromRules>=2||sources.some(([x])=>x===w))continue;
  const s=(await find(w))?.filter(([pos])=>parts.includes(pos));
  if(s?.length){sources.push([w,s]);fromRules++}
 }
 if(!sources.length)return null;
 const each=sources.length===1?12:6;
 const senses=sources.flatMap(([,s])=>s.slice(0,each)).filter(([,definition,example])=>!isExplicitSense(definition,example)).slice(0,12).map(([pos,definition,example]):Sense=>({pos,definition:sentence(definition),example}));
 if(!senses.length)return{word,lemma:word,senses:[],hidden:true};
 const lemma=(sources.find(([w])=>w!==word)||sources[0])[0];
 return{word,lemma,senses};
}

/** Asks the server (which asks Jev) which sense fits the clicked word: a 0-based index, -1 when none fits, or null to fall back. */
export async function chooseSense(entry:Entry,sentence:string):Promise<number|null>{
 if(entry.hidden||!entry.senses.length)return 0;
 try{
  const response=await fetch('/api/define',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(4000),body:JSON.stringify({sentence,definitions:entry.senses.map(s=>`${posName[s.pos]}: ${s.definition}`)})});
  if(!response.ok)return null;
  const {number,none}=(await response.json()) as {number?:number;none?:boolean};
  if(none)return -1;
  return number!==undefined&&Number.isInteger(number)&&number>=1&&number<=entry.senses.length?number-1:null;
 }catch{return null}
}

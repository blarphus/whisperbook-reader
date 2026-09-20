// Client-side lookup. Two dictionaries, both split into small shards:
//  - /dict-simple: Simple English Wiktionary (plain-language definitions; CC BY-SA), scripts/build-simple-dictionary.py
//  - /dict: WordNet (fallback for harder words), scripts/build-dictionary.mjs
export type Pos='n'|'v'|'a'|'r'|'p'|'pr'|'c'|'i'|'d';
export type Sense={pos:Pos;definition:string;example?:string};
import {isBlockedWord,isExplicitSense} from './blocklist';
export type Entry={word:string;lemma:string;senses:Sense[];simple:Sense[];hidden?:boolean};
export type Shown={senses:Sense[];simple:boolean};
type Shard=Record<string,[Pos,string,string?][]>;
export const posName:Record<Pos,string>={n:'noun',v:'verb',a:'adjective',r:'adverb',p:'preposition',pr:'pronoun',c:'conjunction',i:'interjection',d:'determiner'};
export const posShort:Record<Pos,string>={n:'noun',v:'verb',a:'adj',r:'adv',p:'prep',pr:'pron',c:'conj',i:'interj',d:'det'};

const shards=new Map<string,Promise<Shard>>();
let exceptions:Promise<Record<string,string[]>>|null=null;
const load=<T,>(path:string,fallback:T)=>fetch(`/${path}.json`).then(r=>r.ok?r.json() as Promise<T>:fallback).catch(()=>fallback);
const shardKey=(w:string)=>(w.length>1?w.slice(0,2):w+'_').replace(/[^a-z]/g,'_');
const shard=(dir:string,w:string)=>{const key=`${dir}/${shardKey(w)}`;let s=shards.get(key);if(!s){s=load<Shard>(key,{});shards.set(key,s)}return s};
export const preloadDictionary=()=>{exceptions??=load<Record<string,string[]>>('dict/exc',{})};

// [suffix, replacement, parts of speech the base form may contribute]
const rules:[string,string,string][]=[['ies','y','nv'],['ves','f','n'],['ves','fe','n'],['ses','s','nv'],['xes','x','nv'],['zes','z','nv'],['ches','ch','nv'],['shes','sh','nv'],['men','man','n'],['es','','nv'],['es','e','nv'],['s','','nv'],['ing','','v'],['ing','e','v'],['ed','','v'],['ed','e','v'],['est','','ar'],['est','e','ar'],['er','','ar'],['er','e','ar'],['ly','','a']];
function ruleForms(w:string){const out:[string,string][]=[];for(const [suffix,replacement,parts] of rules){if(w.length>suffix.length+1&&w.endsWith(suffix)){const stem=w.slice(0,-suffix.length)+replacement;out.push([stem,parts]);if(/^(ing|ed|er|est)$/.test(suffix)&&/([^aeiou])\1$/.test(stem))out.push([stem.slice(0,-1),parts])}}return out}
const clean=(w:string)=>w.toLowerCase().replace(/[’‘]/g,"'").replace(/(?:'s|s')$/,'').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,'');
const sentence=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
// WordNet examples belong to a whole synonym group, so only keep one that actually contains this word (or an inflection of it).
const stem=(w:string)=>w.length>4?w.slice(0,-2):w.length>3?w.slice(0,-1):w;
const usesWord=(example:string|undefined,...words:string[])=>Boolean(example)&&words.some(w=>example!.toLowerCase().includes(stem(w)));

// Gathers the senses for a word (and its base forms) from one dictionary.
async function collect(dir:string,word:string,irregular:string[],own:boolean){
 const find=async(w:string)=>(await shard(dir,w))[w];
 const sources:[string,Shard[string]][]=[];
 for(const w of [word,...irregular]){const s=await find(w);if(s)sources.push([w,s])}
 // Regular inflections (turned -> turn): add the base word's matching senses even when the surface form has its own entry.
 let fromRules=0;
 for(const [w,parts] of ruleForms(word)){
  if(fromRules>=2||sources.some(([x])=>x===w))continue;
  const s=(await find(w))?.filter(([pos])=>parts.includes(pos));
  if(s?.length){sources.push([w,s]);fromRules++}
 }
 // Simple Wiktionary examples were already checked to contain the word; WordNet's belong to a synonym group and need the check.
 const senses=sources.flatMap(([w,s])=>s.map(([pos,definition,example]):[Pos,string,string?]=>[pos,definition,own||usesWord(example,w,word)?example:undefined])).filter(([,definition,example])=>!isExplicitSense(definition,example)).map(([pos,definition,example]):Sense=>({pos,definition:sentence(definition),example}));
 return{found:sources.length>0,lemma:(sources.find(([w])=>w!==word)||sources[0])?.[0],senses};
}

export async function lookup(raw:string):Promise<Entry|null>{
 const word=clean(raw);if(!word)return null;
 preloadDictionary();
 const irregular=(await exceptions!)[word]||[];
 if(isBlockedWord(word)||irregular.some(isBlockedWord)||ruleForms(word).some(([form])=>isBlockedWord(form)))return{word,lemma:word,senses:[],simple:[],hidden:true};
 const [simple,wordnet]=await Promise.all([collect('dict-simple',word,irregular,true),collect('dict',word,irregular,false)]);
 if(!simple.found&&!wordnet.found)return null;
 if(!simple.senses.length&&!wordnet.senses.length)return{word,lemma:word,senses:[],simple:[],hidden:true};
 const lemma=[simple.lemma,wordnet.lemma].find(l=>l&&l!==word)??word;
 return{word,lemma,senses:wordnet.senses,simple:simple.senses};
}

/** Asks the server (which asks Jev) which of these senses fit the clicked word: 0-based indexes (best first; a runner-up is added only when Jev is unsure), [] when none fits, or null when the request failed. */
async function ask(senses:Sense[],sentence:string):Promise<number[]|null>{
 try{
  const response=await fetch('/api/define',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(4000),body:JSON.stringify({sentence,definitions:senses.map(s=>`${posName[s.pos]}: ${s.definition}`)})});
  if(!response.ok)return null;
  const {number,none,confidence,ranked}=(await response.json()) as {number?:number;none?:boolean;confidence?:number|null;ranked?:{number:number;p:number}[]};
  if(none)return [];
  if(number===undefined||!Number.isInteger(number)||number<1||number>senses.length)return null;
  const picks=[number-1];
  if((confidence??1)<0.5)for(const r of ranked??[])if(r.number!==number&&r.p>=0.2&&r.number<=senses.length&&picks.length<2)picks.push(r.number-1);
  return picks;
 }catch{return null}
}

/** Simple definitions first; WordNet's fuller (harder) list only when none of the simple ones fits. */
export async function chooseSense(entry:Entry,sentence:string):Promise<Shown>{
 if(entry.simple.length){
  const picks=await ask(entry.simple,sentence);
  if(picks===null)return{senses:[entry.simple[0]],simple:true};
  if(picks.length)return{senses:picks.map(i=>entry.simple[i]),simple:true};
 }
 if(entry.senses.length){
  const picks=await ask(entry.senses,sentence);
  if(picks===null)return{senses:[entry.senses[0]],simple:false};
  return{senses:picks.map(i=>entry.senses[i]),simple:false};
 }
 return{senses:[],simple:false};
}

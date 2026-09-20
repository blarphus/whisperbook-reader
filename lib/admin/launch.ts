import {r2Origin} from '../drive';
import {pushKernel} from './kaggle';
import {randomHex,saveJob,type Job} from './store';

const TOOLS_DATASET='josh123benja/wb-tools';   // pipeline.py + the alignment scripts (see tools/pipeline/README)

async function sha256Hex(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export const hashToken=sha256Hex;

/** Starts the Kaggle pipeline for a job. mode 'inspect' is a quick CPU run; 'process' is the GPU run. */
export async function launchJob(job:Job,mode:'inspect'|'process',origin:string){
 const token=randomHex(24);
 job.tokenHash=await sha256Hex(token);
 const cfg={
  jobId:job.id,mode,base:origin,token,bookId:job.bookId,title:job.title,author:job.author,narrator:job.narrator,classes:job.classes,
  media:r2Origin,audio:job.files.audio&&{url:`${r2Origin}/${job.files.audio.key}`,name:job.files.audio.name},
  epub:job.files.epub&&{url:`${r2Origin}/${job.files.epub.key}`,name:job.files.epub.name},
  sectionIndices:job.sectionIndices,
  cover:job.files.cover&&{url:`${r2Origin}/${job.files.cover.key}`,name:job.files.cover.name},
 };
 const b64=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cfg))));
 const code=[
  'import base64, glob, json, sys, os',
  `JOB = json.loads(base64.b64decode("${b64}").decode())`,
  `hits = glob.glob("/kaggle/input/**/pipeline.py", recursive=True)`,
  'assert hits, "pipeline.py is missing from the attached wb-tools dataset"',
  'sys.path.insert(0, os.path.dirname(hits[0]))',
  'import pipeline',
  'pipeline.main(JOB)',
 ].join('\n');
 const pushed=await pushKernel({name:`wb-${mode}-${job.id}`,code,gpu:mode==='process',datasets:[TOOLS_DATASET]});
 if(pushed.invalid.length)throw new Error(`Kaggle could not attach ${pushed.invalid.join(', ')}`);
 job.kernel=pushed.slug;job.kernelUrl=pushed.url;
 job.status=mode==='inspect'?'inspecting':'processing';
 job.progress={stage:mode,pct:0,message:mode==='inspect'?'Starting on Kaggle…':'Waiting for a Kaggle GPU…',at:new Date().toISOString()};
 job.error=undefined;
 await saveJob(job);
}

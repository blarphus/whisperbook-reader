import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/drive-audio-sw.js',import.meta.url),'utf8');
function fixture(fetch){
 const context=vm.createContext({fetch,URL,Request,Response,ReadableStream,AbortController,Uint8Array,atob,setTimeout,self:{addEventListener(){},registration:{scope:'https://reader.test/'},location:{origin:'https://reader.test'}}});
 vm.runInContext(source,context);return context;
}
const request=()=>new Request('https://reader.test/drive-audio/eragon',{headers:{Range:'bytes=0-3'}});
let calls=0;
const recovery=fixture(async url=>{
 calls++;if(calls===1)throw Error('Temporary network failure');
 if(calls===2)return new Response('',{status:503});
 assert.equal(url.searchParams.get('start'),'0');assert.equal(url.searchParams.get('end'),'3');
 return Response.json({start:0,end:3,total:937347313,data:'AQIDBA=='});
});
recovery.request=request();
const recovered=await vm.runInContext('streamAudio(request,"eragon")',recovery);
assert.equal(recovered.status,206);assert.equal(recovered.headers.get('Content-Range'),'bytes 0-3/937347313');
assert.deepEqual([...new Uint8Array(await recovered.arrayBuffer())],[1,2,3,4]);assert.equal(calls,3);

recovery.request=new Request('https://reader.test/drive-audio/eragon',{headers:{Range:'bytes=1048576-10616831'}});
const metadata=await vm.runInContext('streamAudio(request,"eragon")',recovery);
assert.equal(metadata.headers.get('Content-Range'),'bytes 1048576-10616831/937347313');
assert.equal(metadata.headers.get('Cache-Control'),'no-store');await metadata.body.cancel();
recovery.request=new Request('https://reader.test/drive-audio/eragon',{headers:{Range:'bytes=0-937347312'}});
const bounded=await vm.runInContext('streamAudio(request,"eragon")',recovery);
assert.equal(bounded.headers.get('Content-Length'),String(16*1024*1024));await bounded.body.cancel();

let corruptCalls=0;
const corrupt=fixture(async()=>{corruptCalls++;return Response.json({start:0,end:3,total:123,data:'AQIDBA=='})});corrupt.request=request();
const rejected=await vm.runInContext('streamAudio(request,"eragon")',corrupt);
await assert.rejects(rejected.arrayBuffer());assert.equal(corruptCalls,3);

let cancelledCalls=0;
let firstAttempt;
const attempted=new Promise(resolve=>{firstAttempt=resolve});
const cancellation=fixture(async()=>{cancelledCalls++;firstAttempt();throw Error('Temporary failure')});cancellation.request=request();
const cancelled=await vm.runInContext('streamAudio(request,"eragon")',cancellation);
const reader=cancelled.body.getReader();const pending=reader.read();await attempted;await reader.cancel();await pending;
await new Promise(resolve=>setTimeout(resolve,700));assert.equal(cancelledCalls,1);
console.log('Drive range retries, corruption rejection, and cancellation passed.');

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../app/api/media/[...path]/route.ts';

async function request(path,headers={}){
 const url=new URL(`https://reader.test/api/media/${path}`);
 return GET(new Request(url,{headers}),{params:Promise.resolve({path:url.pathname.slice('/api/media/'.length).split('/')})});
}

test('media route proxies allow-listed audio ranges and preserves streaming headers',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   assert.equal(url,'https://media.studentbookreader.com/audio/sample-book/segment-000.m4a');
   assert.equal(new Headers(options.headers).get('range'),'bytes=0-1023');
   return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'audio/mp4','Content-Range':'bytes 0-2/3','Content-Length':'3','Accept-Ranges':'bytes','Cache-Control':'public, max-age=31536000'}});
 });
 const response=await request('audio/sample-book/segment-000.m4a',{Range:'bytes=0-1023'});
 assert.equal(response.status,206);
 assert.equal(response.headers.get('content-range'),'bytes 0-2/3');
 assert.equal(response.headers.get('accept-ranges'),'bytes');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]));
 t.mock.restoreAll();
});

test('media route accepts covers and rejects unapproved keys without fetching',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected upstream fetch')});
 t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>new Response('cover',{status:200,headers:{'Content-Type':'image/jpeg'}}));
 assert.equal((await request('covers/sample-book.jpg?v=1')).status,200);
 t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected upstream fetch')});
 assert.equal((await request('reader/sample-book/data.json.gz')).status,404);
 assert.equal((await request('audio/../other/segment-000.m4a')).status,404);
 assert.equal((await request('covers/sample-book.jpg')).status,502);
 t.mock.restoreAll();
});

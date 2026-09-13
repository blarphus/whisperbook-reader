import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../app/api/book/[asset]/route.ts';

async function request(range, asset='audio') {
  return GET(new Request('https://reader.test/api/book/'+asset, {headers:range?{Range:range}:{}}), {params:Promise.resolve({asset})});
}

test('browser open-ended requests return bounded, byte-identical partial audio', async t=>{
  const bytes=new Uint8Array([0,1,2,3,255]);
  for(const start of [0,8388608,760000000]) {
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.equal(new Headers(options.headers).get('range'),`bytes=${start}-${start+8388607}`);
      return new Response(bytes,{status:206,headers:{'Content-Type':'audio/mp4','Content-Length':'5','Content-Range':`bytes ${start}-${start+4}/773787995`,'Accept-Ranges':'bytes'}});
    });
    const response=await request(`bytes=${start}-`);
    assert.equal(response.status,206);
    assert.equal(response.headers.get('content-range'),`bytes ${start}-${start+4}/773787995`);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    t.mock.restoreAll();
  }
});

test('explicit and suffix ranges pass through without alteration',async t=>{
  for(const range of ['bytes=0-1','bytes=773787900-773787994','bytes=-1024']) {
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.equal(new Headers(options.headers).get('range'),range);
      return new Response('ok',{status:206});
    });
    assert.equal((await request(range)).status,206);
    t.mock.restoreAll();
  }
});

test('invalid ranges do not reach Drive and unsatisfiable ranges stay 416',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected fetch')});
  for(const range of ['bytes=-','bytes=0-1,3-4','bytes=999999999999999999999-']) assert.equal((await request(range)).status,416);
  t.mock.restoreAll();
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:416,headers:{'Content-Range':'bytes */773787995'}}));
  const response=await request('bytes=773787995-');
  assert.equal(response.status,416);
  assert.equal(response.headers.get('content-range'),'bytes */773787995');
});

test('only configured books and assets can reach Drive',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected fetch')});
 for(const url of ['https://reader.test/api/book/audio?book=unknown','https://reader.test/api/book/audio?book=__proto__','https://reader.test/api/book/constructor']){
  const asset=new URL(url).pathname.split('/').pop();
  assert.equal((await GET(new Request(url),{params:Promise.resolve({asset})})).status,404);
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSaved,saveProgress,storageKey} from '../lib/reader.ts';

test('book progress stays independent and existing Carl progress survives',t=>{
 const data=new Map([[storageKey,JSON.stringify({'dungeon-crawler-carl':{position:379,rate:1.5,highlight:'word',updatedAt:1}})]]);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}});
 assert.equal(readSaved().position,379);
 assert.equal(saveProgress({position:15000,rate:1.25,highlight:'sentence',updatedAt:2},'the-car'),true);
 assert.equal(readSaved().position,379);
 assert.equal(readSaved('the-car',15452).position,15000);
 assert.equal(readSaved('eragon',58980).position,0);
 assert.equal(readSaved('the-car',100).position,100);
 assert.equal(readSaved('the-car',15452).rate,1.25);
});

test('unavailable storage reports failure and corrupt saved data recovers',t=>{
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>'{bad',setItem:()=>{throw new Error('Unavailable')}}});
 assert.equal(readSaved('eragon',58980).position,0);
 assert.equal(saveProgress({position:1,rate:1,highlight:'word',updatedAt:2},'eragon'),false);
});

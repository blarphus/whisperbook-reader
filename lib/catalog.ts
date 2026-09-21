import carl from './book.json';
import car from './the-car.json';
import scythe from './scythe.json';
import eragon from './eragon.json';
import hailMary from './project-hail-mary.json';
import mercy from './just-mercy.json';
import martian from './the-martian.json';
import oneUs from './one-of-us-is-lying.json';
import mazeRunner from './the-maze-runner.json';
import badBeginning from './bad-beginning.json';
import harryPotter from './harry-potter.json';
import lightningThief from './the-lightning-thief.json';
import { readerURL } from './storage';
export type BookMetadata={id:string;title:string;author:string;narrator:string;duration:number;chapterCount?:number;cover:string;chapters:{title:string;start:number;end:number}[];markers:{title:string;start:number;end:number}[]};
const assetRevisions:Record<string,string>={'the-car':car.assetRevision,scythe:scythe.assetRevision,eragon:eragon.assetRevision,'project-hail-mary':hailMary.assetRevision,'just-mercy':mercy.assetRevision};
export const catalog:BookMetadata[]=[{...carl,narrator:'Jeff Hays',cover:'/cover.jpg'},{...car,chapterCount:22,narrator:'Luke Daniels',cover:'/covers/the-car.jpg'},{...scythe,chapterCount:40,narrator:'Greg Tremblay',cover:'/covers/scythe.jpg'},{...eragon,chapterCount:60,narrator:'Gerard Doyle',cover:'/covers/eragon.jpg'},{...hailMary,chapterCount:30,narrator:'Ray Porter',cover:'/covers/project-hail-mary.jpg'},{...mercy,chapterCount:16,narrator:'Bryan Stevenson',cover:'/covers/just-mercy.jpg'},{...martian,chapterCount:26,narrator:'R. C. Bray, Wil Wheaton',cover:'/covers/the-martian.jpg'},{...oneUs,chapterCount:31,narrator:'Kim Mai Guest, MacLeod Andrews, Shannon McManus, Robbie Daymond',cover:'/covers/one-of-us-is-lying.jpg'},{...mazeRunner,chapterCount:62,narrator:'Audiobook narration',cover:'/covers/the-maze-runner.jpg'},
{...badBeginning,chapterCount:3,narrator:'Tim Curry',cover:'/covers/the-bad-beginning.jpg?v=2'},
{...harryPotter,chapterCount:17,narrator:'Jim Dale',cover:'/covers/harry-potter-philosophers-stone.jpg?v=2'},
{...lightningThief,chapterCount:22,narrator:'Jesse Bernstein',cover:'/covers/lightning-thief.jpg'}];
export function assetURL(id:string,asset:string){return readerURL(id,asset)}

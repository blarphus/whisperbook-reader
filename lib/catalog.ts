import carl from './book.json';
import car from './the-car.json';
import scythe from './scythe.json';
import eragon from './eragon.json';
import hailMary from './project-hail-mary.json';
import mercy from './just-mercy.json';
import { driveURL } from './drive';
export type BookMetadata={id:string;title:string;author:string;narrator:string;duration:number;chapterCount?:number;cover:string;chapters:{title:string;start:number;end:number}[];markers:{title:string;start:number;end:number}[]};
const assetRevisions:Record<string,string>={'the-car':car.assetRevision,scythe:scythe.assetRevision,eragon:eragon.assetRevision,'project-hail-mary':hailMary.assetRevision,'just-mercy':mercy.assetRevision};
export const catalog:BookMetadata[]=[{...carl,narrator:'Jeff Hays',cover:'/cover.jpg'},{...car,chapterCount:22,narrator:'Luke Daniels',cover:assetURL('the-car','cover')},{...scythe,chapterCount:40,narrator:'Greg Tremblay',cover:assetURL('scythe','cover')},{...eragon,chapterCount:60,narrator:'Gerard Doyle',cover:assetURL('eragon','cover')},{...hailMary,chapterCount:30,narrator:'Ray Porter',cover:assetURL('project-hail-mary','cover')},{...mercy,chapterCount:16,narrator:'Bryan Stevenson',cover:assetURL('just-mercy','cover')}];
export function assetURL(id:string,asset:string){return driveURL(id,asset)}

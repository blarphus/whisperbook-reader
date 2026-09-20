// Which classes see which books. Books built into the site follow these defaults until an admin overrides them
// (overrides live in R2 as class-overrides.json and are edited from /admin).
export const CLASSES=['English 9','Honors English 10','Writing for the 21st Century','What Mr. Benjamin is Reading'];
const ENGLISH_9=new Set(['harry-potter','bad-beginning','the-maze-runner','scythe','the-martian','one-of-us-is-lying','the-lightning-thief']);
export const defaultClasses=(id:string)=>ENGLISH_9.has(id)?['English 9','Honors English 10','Writing for the 21st Century']:['Honors English 10','Writing for the 21st Century'];
export type ClassOverrides=Record<string,string[]>;

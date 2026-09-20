import {env} from 'cloudflare:workers';

/** Secrets/vars from the Worker (production) or .env.local (dev). */
export function getEnv(name:string):string|undefined{
 const v=(env as Record<string,any>)?.[name];
 return typeof v==='string'&&v?v:process.env[name]||undefined;
}

/** The R2 bucket bound as MEDIA (see scripts/patch-wrangler.mjs). */
export function bucket():any{
 const b=(env as Record<string,any>)?.MEDIA;
 if(!b)throw new Error('The R2 binding MEDIA is not available in this environment.');
 return b;
}
export const hasBucket=()=>Boolean((env as Record<string,any>)?.MEDIA);

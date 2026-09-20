import {getEnv} from './env';

const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const COOKIE='wb_admin';
const SESSION_MS=12*3600*1000;

async function hmac(data:string){
 const secret=getEnv('ADMIN_SESSION_KEY');
 if(!secret)throw new Error('ADMIN_SESSION_KEY is not configured');
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(data))));
}
async function sha256(s:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
export function safeEqual(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0}

export async function passwordMatches(candidate:string){
 const real=getEnv('ADMIN_PASSWORD');
 if(!real||!candidate)return false;
 return safeEqual(await sha256(candidate),await sha256(real));
}
export async function sessionCookie(secure:boolean){
 const exp=String(Date.now()+SESSION_MS);
 return `${COOKIE}=${exp}.${await hmac(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}${secure?'; Secure':''}`;
}
export const clearCookie=(secure:boolean)=>`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`;

export async function isAdmin(request:Request){
 const raw=(request.headers.get('cookie')||'').split(/;\s*/).find(c=>c.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!raw)return false;
 const [exp,sig]=raw.split('.');
 if(!exp||!sig||Number(exp)<Date.now())return false;
 return safeEqual(enc.encode(await hmac(exp)),enc.encode(sig));
}

const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
export const reply=json;

/** Returns an error Response if the caller is not a logged-in admin (state-changing calls must also send x-requested-with). */
export async function requireAdmin(request:Request):Promise<Response|null>{
 if(!(await isAdmin(request)))return json({error:'Not signed in'},401);
 if(request.method!=='GET'&&request.method!=='HEAD'&&request.headers.get('x-requested-with')!=='wb')return json({error:'Bad request'},400);
 return null;
}

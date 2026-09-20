import {clearCookie,passwordMatches,reply,sessionCookie,isAdmin} from '../../../../lib/admin/auth';

let failures=0,windowStart=0;
export async function GET(request:Request){return reply({signedIn:await isAdmin(request)})}

export async function POST(request:Request){
 if(request.headers.get('x-requested-with')!=='wb')return reply({error:'Bad request'},400);
 if(Date.now()-windowStart>15*60_000){failures=0;windowStart=Date.now()}
 if(failures>=8)return reply({error:'Too many attempts. Try again in a few minutes.'},429);
 const {password}=(await request.json().catch(()=>({}))) as {password?:string};
 await new Promise(r=>setTimeout(r,400));
 if(!(await passwordMatches(password||''))){failures++;return reply({error:'Incorrect password'},401)}
 failures=0;
 return reply({signedIn:true},200,{'set-cookie':await sessionCookie(new URL(request.url).protocol==='https:')});
}
export async function DELETE(request:Request){
 return reply({signedIn:false},200,{'set-cookie':clearCookie(new URL(request.url).protocol==='https:')});
}

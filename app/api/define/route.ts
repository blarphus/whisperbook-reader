// Asks Jev (TypeSafe AI, https://docs.typesafe.ai) which numbered definition fits a word in context.
// Keys stay on the server. Use Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
// or TypeSafe/Vercel (TYPESAFE_API_KEY, optionally TYPESAFE_API_BASE / TYPESAFE_MODEL).
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function POST(request:Request){
 const key=process.env.TYPESAFE_API_KEY;
 let body:{sentence?:unknown;definitions?:unknown};
 try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 const {sentence,definitions}=body;
 if(typeof sentence!=='string'||!/~[^~]+~/.test(sentence)||sentence.length>800)return json({error:'Invalid sentence'},400);
 if(!Array.isArray(definitions)||definitions.length<1||definitions.length>20||definitions.some(d=>typeof d!=='string'||!d||d.length>500))return json({error:'Invalid definitions'},400);
 const criteria=Object.fromEntries([...(definitions as string[]),'none of the above: none of these definitions fits how the word is used here'].map((d,i)=>[String(i+1),d]));
 const question={type:'choice',instructions:'The sentence uses one word between tildes (~). Which numbered definition matches the meaning of that word as it is used in this sentence?',criteria};
 const cfAccount=process.env.CLOUDFLARE_ACCOUNT_ID,cfToken=process.env.CLOUDFLARE_API_TOKEN;
 const target=cfAccount&&cfToken
  ?{url:`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run`,token:cfToken,body:{model:'typesafe/jev',input:{state:sentence,questions:{definition:question}}}}
  :key?{url:`${(process.env.TYPESAFE_API_BASE||'https://api.typesafe.ai').replace(/\/$/,'')}/v1/systemone`,token:key,body:{model:process.env.TYPESAFE_MODEL||'jev-latest',state:sentence,questions:{definition:question}}}
  :null;
 if(!target)return json({error:'Jev is not configured'},503);
 try{
  const response=await fetch(target.url,{method:'POST',signal:AbortSignal.timeout(6000),headers:{'content-type':'application/json',authorization:`Bearer ${target.token}`},body:JSON.stringify(target.body)});
  if(!response.ok)return json({error:'Jev request failed'},502);
  type Answers={definition?:{choice?:unknown;confidence?:number}};
  const data=(await response.json()) as {answers?:Answers;result?:{answers?:Answers;result?:{answers?:Answers}}};
  const answer=(data.answers??data.result?.answers??data.result?.result?.answers)?.definition;
  const number=Number(answer?.choice);
  if(!Number.isInteger(number)||number<1||number>definitions.length+1)return json({error:'Unexpected answer'},502);
  if(number===definitions.length+1)return json({none:true,confidence:answer?.confidence??null});
  return json({number,confidence:answer?.confidence??null});
 }catch{return json({error:'Jev unreachable'},502)}
}

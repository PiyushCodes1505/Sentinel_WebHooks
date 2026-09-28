import { randomUUID } from "node:crypto";
import { initDatabase, query } from "@/lib/db";
import { json } from "@/lib/http";

type Context={params:Promise<{mode:string}>};
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request,{params}:Context){
  await initDatabase();
  const {mode}=await params;
  const supported=["success","fail","slow","timeout","status-400","status-500","status-429"];
  const selected=supported.includes(mode)?mode:"success";
  const rawBody=await request.text();
  const headers=Object.fromEntries(request.headers.entries());
  await query(`INSERT INTO test_receiver_requests(id,mode,method,path,headers,body) VALUES($1,$2,$3,$4,$5,$6)`,[randomUUID(),selected,request.method,new URL(request.url).pathname,headers,rawBody.slice(0,10000)]);

  if(selected === "slow") await delay(2500);
  if(selected === "timeout") await delay(8000);
  if(selected === "status-400"||selected === "fail") return new Response(JSON.stringify({ok:false,error:"Simulated bad request"}),{status:400,headers:{"content-type":"application/json"}});
  if(selected === "status-500") return new Response(JSON.stringify({ok:false,error:"Simulated server failure"}),{status:500,headers:{"content-type":"application/json"}});
  if(selected === "status-429") return new Response(JSON.stringify({ok:false,error:"Simulated rate limit"}),{status:429,headers:{"content-type":"application/json","retry-after":"2"}});
  if(selected === "timeout") return new Response(JSON.stringify({ok:true,simulated:"slow receiver"}),{status:200,headers:{"content-type":"application/json"}});
  return json({ok:true,received:true,mode:selected,eventId:headers["x-sentinel-event-id"]});
}

function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

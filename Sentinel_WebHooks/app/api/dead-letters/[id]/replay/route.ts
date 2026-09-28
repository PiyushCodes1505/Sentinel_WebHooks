import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { enqueueEvent } from "@/lib/queue";
import { config } from "@/lib/config";

type Context={params:Promise<{id:string}>};
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(_request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const result=await query(`UPDATE events SET status='pending',attempt_count=0,max_attempts=$2,last_error=NULL,dead_reason=NULL,next_attempt_at=NOW(),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1 AND status='dead' RETURNING id`,[id,config.maxAttempts]);
    if(!result.rows[0])return errorResponse("Dead-lettered event not found",404);
    try{await enqueueEvent(id,`replay:${Date.now()}`);}catch(error){console.error("Replay queue publish failed",error);}
    return json({ok:true,id,status:"pending"});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to replay event");}
}

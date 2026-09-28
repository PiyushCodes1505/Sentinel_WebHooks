import { randomUUID } from "node:crypto";
import { initDatabase, query } from "@/lib/db";
import { json, errorResponse, readJson } from "@/lib/http";
import { eventSchema } from "@/lib/validators";
import { enqueueEvent } from "@/lib/queue";
import { config } from "@/lib/config";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request){
  try{
    await initDatabase();
    const url=new URL(request.url);
    const requestedLimit=Number(url.searchParams.get("limit")||50);
    const limit=Number.isFinite(requestedLimit)?Math.min(100,Math.max(1,Math.floor(requestedLimit))):50;
    const result=await query(`
      SELECT ev.id,ev.type,ev.status,ev.attempt_count,ev.max_attempts,ev.next_attempt_at,ev.last_error,ev.dead_reason,ev.created_at,ev.updated_at,
             ep.id AS endpoint_id,ep.name AS endpoint_name,ep.url AS endpoint_url
        FROM events ev JOIN webhook_endpoints ep ON ep.id=ev.endpoint_id
       ORDER BY ev.created_at DESC LIMIT $1`,[limit]);
    return json({ok:true,events:result.rows});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load events");}
}

export async function POST(request:Request){
  try{
    await initDatabase();
    const input=eventSchema.parse(await readJson(request));
    const idempotencyKey=(request.headers.get("idempotency-key")||"").trim()||null;
    if(idempotencyKey&&idempotencyKey.length>200)return errorResponse("Idempotency-Key is too long.",400);

    const endpoint=await query<{id:string;enabled:boolean}>(`SELECT id,enabled FROM webhook_endpoints WHERE id=$1`,[input.endpointId]);
    if(!endpoint.rows[0])return errorResponse("Endpoint not found",404);
    if(!endpoint.rows[0].enabled)return errorResponse("Endpoint is disabled",409);

    if(idempotencyKey){
      const existing=await query(`SELECT id,type,status,attempt_count FROM events WHERE endpoint_id=$1 AND idempotency_key=$2`,[input.endpointId,idempotencyKey]);
      if(existing.rows[0])return json({ok:true,duplicate:true,event:existing.rows[0]});
    }

    const id=randomUUID();
    try{
      await query(
        `INSERT INTO events(id,endpoint_id,type,payload,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
         VALUES($1,$2,$3,$4,'pending',0,$5,NOW(),$6)`,
        [id,input.endpointId,input.type,input.payload,config.maxAttempts,idempotencyKey],
      );
    }catch(error){
      if(String(error).includes("events_endpoint_idempotency_idx")&&idempotencyKey){
        const duplicate=await query(`SELECT id,type,status,attempt_count FROM events WHERE endpoint_id=$1 AND idempotency_key=$2`,[input.endpointId,idempotencyKey]);
        return json({ok:true,duplicate:true,event:duplicate.rows[0]});
      }
      throw error;
    }

    let queued=true;
    let queueMessageId:string|null=null;
    try{
      const queuedResult=await enqueueEvent(id);
      queueMessageId=queuedResult.messageId??null;
    }catch(error){
      queued=false;
      console.error("Queue publish failed",error);
    }

    return json({ok:true,event:{id,type:input.type,status:"pending",queued,queueMessageId}},{status:202});
  }catch(error){
    return errorResponse(error instanceof Error?error.message:"Invalid event",400);
  }
}

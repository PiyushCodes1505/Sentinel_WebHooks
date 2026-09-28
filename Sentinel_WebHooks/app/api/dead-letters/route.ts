import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
  try{
    await initDatabase();
    const result=await query(`
      SELECT ev.id,ev.type,ev.status,ev.attempt_count,ev.max_attempts,ev.dead_reason,ev.last_error,ev.created_at,ev.updated_at,
             ep.name AS endpoint_name,ep.url AS endpoint_url
        FROM events ev JOIN webhook_endpoints ep ON ep.id=ev.endpoint_id
       WHERE ev.status='dead'
       ORDER BY ev.updated_at DESC`);
    return json({ok:true,events:result.rows});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load dead letters");}
}

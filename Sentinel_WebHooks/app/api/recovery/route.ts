import { initDatabase, query } from "@/lib/db";
import { enqueueEvent } from "@/lib/queue";
import { json, errorResponse } from "@/lib/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request){
  const secret=request.headers.get("x-recovery-secret");
  if(process.env.NODE_ENV === "production" && secret !== (process.env.RECOVERY_SECRET ?? "change-me")) return errorResponse("Unauthorized",401);
  try{
    await initDatabase();
    const result=await query(`SELECT id FROM events WHERE status IN ('pending','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()) ORDER BY created_at ASC LIMIT 50`);
    let queued=0;
    for(const row of result.rows){
      try{await enqueueEvent(row.id,`recovery:${row.id}`);queued++;}catch(error){console.error("Recovery enqueue failed",row.id,error);}
    }
    return json({ok:true,scanned:result.rows.length,queued});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Recovery failed");}
}

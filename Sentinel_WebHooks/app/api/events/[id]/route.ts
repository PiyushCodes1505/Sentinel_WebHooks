import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

type Context={params:Promise<{id:string}>};

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(_request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const event=await query(`
      SELECT ev.*,ep.name AS endpoint_name,ep.url AS endpoint_url
        FROM events ev JOIN webhook_endpoints ep ON ep.id=ev.endpoint_id
       WHERE ev.id=$1`,[id]);
    if(!event.rows[0])return errorResponse("Event not found",404);
    const attempts=await query(`SELECT * FROM delivery_attempts WHERE event_id=$1 ORDER BY attempt_number ASC`,[id]);
    return json({ok:true,event:event.rows[0],attempts:attempts.rows});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load event");}
}

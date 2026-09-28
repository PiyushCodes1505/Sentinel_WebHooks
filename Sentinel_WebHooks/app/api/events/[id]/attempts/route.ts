import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

type Context={params:Promise<{id:string}>};
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(_request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const result=await query(`SELECT * FROM delivery_attempts WHERE event_id=$1 ORDER BY attempt_number ASC`,[id]);
    return json({ok:true,attempts:result.rows});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load attempts");}
}

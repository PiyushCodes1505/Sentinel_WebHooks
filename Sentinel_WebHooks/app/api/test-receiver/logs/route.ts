import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
  try{
    await initDatabase();
    const result=await query(`SELECT id,mode,method,path,headers,body,received_at FROM test_receiver_requests ORDER BY received_at DESC LIMIT 50`);
    return json({ok:true,requests:result.rows});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load receiver logs");}
}

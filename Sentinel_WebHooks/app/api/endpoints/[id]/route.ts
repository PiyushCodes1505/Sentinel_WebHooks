import { initDatabase, query } from "@/lib/db";
import { json, errorResponse, readJson } from "@/lib/http";
import { endpointSchema } from "@/lib/validators";
import { validateDestinationUrl } from "@/lib/security";

type Context={params:Promise<{id:string}>};

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(_request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const result=await query(`SELECT id,name,url,enabled,created_at,updated_at FROM webhook_endpoints WHERE id=$1`,[id]);
    if(!result.rows[0])return errorResponse("Endpoint not found",404);
    return json({ok:true,endpoint:result.rows[0]});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load endpoint");}
}

export async function PATCH(request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const body=await readJson(request) as {name?:string;url?:string;enabled?:boolean};
    if(body.name===undefined&&body.url===undefined&&body.enabled===undefined)return errorResponse("At least one field is required.",400);
    const current=await query(`SELECT id,name,url,enabled FROM webhook_endpoints WHERE id=$1`,[id]);
    if(!current.rows[0])return errorResponse("Endpoint not found",404);
    const name=body.name??current.rows[0].name;
    const url=body.url? (await validateDestinationUrl(endpointSchema.shape.url.parse(body.url))).toString() : current.rows[0].url;
    const enabled=body.enabled??current.rows[0].enabled;
    if(typeof name!=="string"||name.trim().length<2)return errorResponse("Name must contain at least 2 characters.",400);
    const result=await query(`UPDATE webhook_endpoints SET name=$2,url=$3,enabled=$4,updated_at=NOW() WHERE id=$1 RETURNING id,name,url,enabled,created_at,updated_at`,[id,name.trim(),url,enabled]);
    return json({ok:true,endpoint:result.rows[0]});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to update endpoint",400);}
}

export async function DELETE(_request:Request,{params}:Context){
  try{
    await initDatabase();
    const {id}=await params;
    const result=await query(`DELETE FROM webhook_endpoints WHERE id=$1 RETURNING id`,[id]);
    if(!result.rows[0])return errorResponse("Endpoint not found",404);
    return json({ok:true});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to delete endpoint");}
}

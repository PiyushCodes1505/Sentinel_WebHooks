import { randomUUID } from "node:crypto";
import { initDatabase, query } from "@/lib/db";
import { generateSecret } from "@/lib/crypto";
import { json, errorResponse, readJson } from "@/lib/http";
import { validateDestinationUrl } from "@/lib/security";
import { endpointSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await initDatabase();
    const result=await query(`
      SELECT e.id,e.name,e.url,e.enabled,e.created_at,e.updated_at,
             COUNT(ev.id)::int AS event_count
        FROM webhook_endpoints e
        LEFT JOIN events ev ON ev.endpoint_id=e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC
    `);
    return json({ok:true,endpoints:result.rows});
  } catch(error) {
    return errorResponse(error instanceof Error?error.message:"Failed to load endpoints");
  }
}

export async function POST(request: Request) {
  try {
    await initDatabase();
    const input=endpointSchema.parse(await readJson(request));
    const url=await validateDestinationUrl(input.url);
    const id=randomUUID();
    const secret=generateSecret();
    const result=await query(
      `INSERT INTO webhook_endpoints(id,name,url,secret) VALUES($1,$2,$3,$4) RETURNING id,name,url,enabled,created_at,updated_at`,
      [id,input.name,url.toString(),secret],
    );
    return json({ok:true,endpoint:{...result.rows[0],secret}},{status:201});
  } catch(error) {
    const message=error instanceof Error?error.message:"Invalid endpoint";
    return errorResponse(message,message.toLowerCase().includes("valid")?400:500);
  }
}

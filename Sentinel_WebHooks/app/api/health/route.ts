import { initDatabase, query } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await initDatabase();
    await query("SELECT 1");
    return json({ok:true,status:"healthy",database:"connected",queue:"configured"});
  } catch (error) {
    return json({ok:false,status:"degraded",error:error instanceof Error?error.message:"Unknown error"},{status:503});
  }
}

import { initDatabase, query } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
  try{
    await initDatabase();
    const [counts,latency,queue] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='delivered')::int AS delivered,COUNT(*) FILTER(WHERE status='retrying')::int AS retrying,COUNT(*) FILTER(WHERE status='dead')::int AS dead,COUNT(*) FILTER(WHERE status IN ('pending','delivering'))::int AS pending FROM events`),
      query(`SELECT COALESCE(ROUND(AVG(latency_ms))::int,0) AS average_latency_ms,COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int,0) AS p95_latency_ms FROM delivery_attempts WHERE latency_ms IS NOT NULL`),
      query(`SELECT COUNT(*)::int AS attempts_today FROM delivery_attempts WHERE started_at >= NOW() - INTERVAL '24 hours'`),
    ]);
    const c=counts.rows[0]||{total:0,delivered:0,retrying:0,dead:0,pending:0};
    const successRate=Number(c.total) ? Math.round((Number(c.delivered)/Number(c.total))*1000)/10 : 0;
    return json({ok:true,metrics:{...c,success_rate:successRate,...(latency.rows[0]||{}),...(queue.rows[0]||{})}});
  }catch(error){return errorResponse(error instanceof Error?error.message:"Failed to load metrics");}
}

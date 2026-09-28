import { randomUUID } from "node:crypto";
import { query } from "./db";
import { config } from "./config";
import { buildSignature } from "./crypto";
import { DestinationValidationError, validateDestinationUrl } from "./security";
import type { RetryClassification } from "./types";
import { computeRetryDelaySeconds } from "./retry";

type EventRow = {
  id: string;
  endpoint_id: string;
  type: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  dead_reason: string | null;
  idempotency_key: string | null;
  created_at: string;
  url: string;
  secret: string;
  enabled: boolean;
};

export class RetryableDeliveryError extends Error {
  retryAfterSeconds?: number;
  retryDelaySeconds?: number;
  constructor(message: string,retryAfterSeconds?: number) {
    super(message);
    this.name="RetryableDeliveryError";
    this.retryAfterSeconds=retryAfterSeconds;
    this.retryDelaySeconds=retryAfterSeconds;
  }
}

export async function processEvent(eventId: string,workerId: string,deliveryCount=1) {
  const claim=await query<EventRow & {previous_locked_at:string|null}>(
    `WITH candidate AS (
       SELECT e.id,e.locked_at AS previous_locked_at,w.url,w.secret,w.enabled
         FROM events e
         JOIN webhook_endpoints w ON w.id=e.endpoint_id
        WHERE e.id=$1
          AND w.enabled=TRUE
          AND (
            e.status IN ('pending','retrying')
            OR (e.status='delivering' AND e.locked_at IS NOT NULL AND e.locked_at < NOW() - ($3::text || ' seconds')::interval)
          )
        FOR UPDATE OF e SKIP LOCKED
     )
     UPDATE events e
        SET status='delivering',locked_at=NOW(),locked_by=$2,updated_at=NOW()
       FROM candidate c
      WHERE e.id=c.id
      RETURNING e.*,c.url,c.secret,c.enabled,c.previous_locked_at`,
    [eventId,workerId,config.staleLockSeconds],
  );
  const event=claim.rows[0];
  if(!event){
    const current=await query<{status:string;locked_at:string|null}>(`SELECT status,locked_at FROM events WHERE id=$1`,[eventId]);
    const state=current.rows[0];
    if(!state || state.status==='delivered' || state.status==='dead') return {skipped:true,reason:"already-finished"};
    if(state.status==='delivering') throw new RetryableDeliveryError("Event is currently being processed by another worker",1);
    return {skipped:true,reason:"endpoint-disabled-or-unavailable"};
  }

  if(event.previous_locked_at){
    await query(`UPDATE delivery_attempts SET status='retrying',error_message='Previous worker claim expired; event was recovered.',finished_at=NOW() WHERE event_id=$1 AND status='in_flight'`,[event.id]);
  }

  const attemptNumber=Math.max(Number(event.attempt_count||0)+1,Number(deliveryCount||1));
  const attemptId=randomUUID();
  const started=Date.now();

  const attemptInsert=await query<{id:string}>(
    `INSERT INTO delivery_attempts(id,event_id,attempt_number,status,started_at) VALUES($1,$2,$3,'in_flight',NOW())
     ON CONFLICT(event_id,attempt_number) DO UPDATE SET status='in_flight',started_at=NOW(),finished_at=NULL
     RETURNING id`,
    [attemptId,event.id,attemptNumber],
  );
  const effectiveAttemptId=attemptInsert.rows[0]?.id ?? attemptId;

  let classification: RetryClassification={retryable:false,reason:"Unknown failure"};
  let httpStatus:number|undefined;
  let latency=0;
  let responseExcerpt="";
  let errorMessage="";

  try {
    const target=await validateDestinationUrl(event.url);
    const rawBody=JSON.stringify({
      id:event.id,
      type:event.type,
      createdAt:event.created_at,
      payload:event.payload,
    });
    const timestamp=Math.floor(Date.now()/1000).toString();
    const signature=buildSignature(event.secret,timestamp,rawBody);

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),config.deliveryTimeoutMs);
    const startedRequest=Date.now();
    let response:Response;
    try {
      response=await fetch(target.toString(),{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "user-agent":"Sentinel-Webhooks/1.0",
          "x-sentinel-event-id":event.id,
          "x-sentinel-event-type":event.type,
          "x-sentinel-timestamp":timestamp,
          "x-sentinel-signature":`t=${timestamp},v1=${signature}`,
        },
        body:rawBody,
        redirect:"manual",
        signal:controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    latency=Date.now()-startedRequest;
    httpStatus=response.status;
    responseExcerpt=(await response.text()).slice(0,2000);
    classification=classifyResponse(response);
    if(classification.retryable) {
      throw new RetryableDeliveryError(classification.reason,classification.retryAfterSeconds);
    }
    if(response.ok) {
      await completeAttemptAndEvent(effectiveAttemptId,event.id,attemptNumber,"delivered",httpStatus,latency,responseExcerpt,null);
      return {status:"delivered",attemptNumber,httpStatus,latency};
    }

    await completeAttemptAndEvent(effectiveAttemptId,event.id,attemptNumber,"dead",httpStatus,latency,responseExcerpt,classification.reason);
    await markDead(event.id,attemptNumber,classification.reason);
    return {status:"dead",attemptNumber,httpStatus,latency};
  } catch(error) {
    if(error instanceof RetryableDeliveryError) {
      errorMessage=error.message;
      classification={retryable:true,reason:error.message,retryAfterSeconds:error.retryAfterSeconds};
    } else if(error instanceof DestinationValidationError) {
      errorMessage=error.message;
      classification={retryable:false,reason:error.message};
      await completeAttemptAndEvent(effectiveAttemptId,event.id,attemptNumber,"dead",httpStatus,latency,responseExcerpt,errorMessage);
      await markDead(event.id,attemptNumber,errorMessage);
      return {status:"dead",attemptNumber,errorMessage};
    } else if(error instanceof Error) {
      errorMessage=error.name === "AbortError" ? `Request timed out after ${config.deliveryTimeoutMs}ms` : error.message;
      classification={retryable:true,reason:errorMessage};
    } else {
      errorMessage="Unknown delivery error";
      classification={retryable:true,reason:errorMessage};
    }

    latency=latency||Date.now()-started;
    if(attemptNumber>=event.max_attempts) {
      await completeAttemptAndEvent(effectiveAttemptId,event.id,attemptNumber,"dead",httpStatus,latency,responseExcerpt,errorMessage);
      await markDead(event.id,attemptNumber,errorMessage);
      return {status:"dead",attemptNumber,errorMessage};
    }

    const retryDelaySeconds=computeRetryDelaySeconds(attemptNumber,classification.retryAfterSeconds);
    await completeAttemptAndEvent(effectiveAttemptId,event.id,attemptNumber,"retrying",httpStatus,latency,responseExcerpt,errorMessage);
    await query(
      `UPDATE events SET status='retrying',attempt_count=$2,last_error=$3,updated_at=NOW(),next_attempt_at=NOW()+($4::text || ' seconds')::interval WHERE id=$1`,
      [event.id,attemptNumber,errorMessage,retryDelaySeconds],
    );
    throw new RetryableDeliveryError(errorMessage,retryDelaySeconds);
  }
}

function classifyResponse(response: Response): RetryClassification {
  if(response.status>=200 && response.status<300) return {retryable:false,reason:"acknowledged"};
  if(response.status===429) {
    const retryAfter=response.headers.get("retry-after");
    const seconds=retryAfter ? parseRetryAfter(retryAfter) : undefined;
    return {retryable:true,reason:"Receiver is rate-limiting the request",retryAfterSeconds:seconds};
  }
  if([408,500,502,503,504].includes(response.status)) return {retryable:true,reason:`Receiver returned HTTP ${response.status}`};
  if(response.status>=300 && response.status<400) return {retryable:false,reason:`Redirect response HTTP ${response.status} is not followed`};
  return {retryable:false,reason:`Receiver rejected the event with HTTP ${response.status}`};
}

function parseRetryAfter(value:string) {
  const seconds=Number(value);
  if(Number.isFinite(seconds))return Math.max(0,Math.min(config.maxRetryDelaySeconds,Math.floor(seconds)));
  const date=Date.parse(value);
  if(Number.isNaN(date))return undefined;
  return Math.max(0,Math.min(config.maxRetryDelaySeconds,Math.ceil((date-Date.now())/1000)));
}

async function completeAttemptAndEvent(attemptId:string,eventId:string,attemptNumber:number,status:string,httpStatus:number|undefined,latency:number,responseExcerpt:string|null,errorMessage:string|null) {
  await query(
    `UPDATE delivery_attempts SET status=$1,http_status=$2,latency_ms=$3,response_excerpt=$4,error_message=$5,finished_at=NOW() WHERE id=$6`,
    [status,httpStatus??null,latency,responseExcerpt||null,errorMessage,attemptId],
  );
  if(status==="delivered") {
    await query(`UPDATE events SET status='delivered',attempt_count=$2,last_error=NULL,next_attempt_at=NULL,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1`,[eventId,attemptNumber]);
  }
}

async function markDead(eventId:string,attemptNumber:number,reason:string) {
  await query(`UPDATE events SET status='dead',attempt_count=GREATEST(attempt_count,$2),last_error=$3,dead_reason=$3,next_attempt_at=NULL,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1`,[eventId,attemptNumber,reason]);
}

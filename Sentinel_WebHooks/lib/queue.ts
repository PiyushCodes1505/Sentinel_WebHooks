import { send } from "@vercel/queue";
import { randomUUID } from "node:crypto";
import { processEvent, RetryableDeliveryError } from "./delivery";
import { computeRetryDelaySeconds } from "./retry";
import { config } from "./config";

export const QUEUE_TOPIC = "sentinel-webhooks";

const localTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function enqueueEvent(eventId: string, reason = "initial", delaySeconds = 0) {
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    scheduleLocal(eventId,Math.max(0,delaySeconds),1);
    return { messageId: `local-${randomUUID()}` };
  }

  return send(QUEUE_TOPIC,{eventId,reason},{
    idempotencyKey: `${reason}:${eventId}`,
    retentionSeconds: 604_800,
    delaySeconds: Math.max(0,Math.floor(delaySeconds)),
  });
}

function scheduleLocal(eventId:string,delaySeconds:number,deliveryCount:number){
  const key=`${eventId}:${deliveryCount}`;
  if(localTimers.has(key))return;
  const timer=setTimeout(async()=>{
    localTimers.delete(key);
    try{
      await processEvent(eventId,`local-worker-${process.pid}-${randomUUID()}`,deliveryCount);
    }catch(error){
      if(error instanceof RetryableDeliveryError && deliveryCount<config.maxAttempts){
        const nextDelay=error.retryDelaySeconds ?? computeRetryDelaySeconds(deliveryCount);
        scheduleLocal(eventId,nextDelay,deliveryCount+1);
      }else if(!(error instanceof RetryableDeliveryError)){
        console.error("Local queue worker failed",error);
      }
    }
  },Math.max(0,delaySeconds*1000));
  localTimers.set(key,timer);
}

import { handleCallback } from "@vercel/queue";
import { config } from "@/lib/config";
import { processEvent, RetryableDeliveryError } from "@/lib/delivery";

export const runtime = "nodejs";
export const maxDuration = 240;

export const POST = handleCallback(
  async (message, metadata) => {
    if (!message || typeof message !== "object" || !("eventId" in message)) {
      throw new Error("Invalid queue message: eventId is required");
    }

    const eventId = String((message as { eventId: unknown }).eventId);
    const result = await processEvent(
      eventId,
      `vercel-queue:${metadata.messageId}`,
      metadata.deliveryCount,
    );

    if (result && "skipped" in result && result.skipped) {
      return;
    }
  },
  {
    visibilityTimeoutSeconds: 240,
    retry: (error, metadata) => {
      if (error instanceof RetryableDeliveryError) {
        if (metadata.deliveryCount >= config.maxAttempts) {
          return { acknowledge: true };
        }
        return { afterSeconds: error.retryDelaySeconds ?? config.baseRetryDelaySeconds };
      }

      return undefined;
    },
  },
);

export type EventStatus = "pending" | "delivering" | "retrying" | "delivered" | "dead";

export type RetryClassification = {
  retryable: boolean;
  reason: string;
  retryAfterSeconds?: number;
};

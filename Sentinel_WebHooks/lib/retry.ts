import { config } from "./config";

export function computeRetryDelaySeconds(attemptNumber: number, retryAfterSeconds?: number) {
  const raw = retryAfterSeconds ?? Math.min(config.maxRetryDelaySeconds, config.baseRetryDelaySeconds * 2 ** Math.max(0, attemptNumber - 1));
  const jitter = Math.random() * Math.min(1, raw * 0.25);
  return Math.min(config.maxRetryDelaySeconds, Math.max(1, Math.ceil(raw + jitter)));
}

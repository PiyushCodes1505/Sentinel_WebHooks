export const config = {
  maxAttempts: clampInt(process.env.MAX_ATTEMPTS, 5, 1, 20),
  baseRetryDelaySeconds: clampInt(process.env.BASE_RETRY_DELAY_SECONDS, 1, 1, 3600),
  maxRetryDelaySeconds: clampInt(process.env.MAX_RETRY_DELAY_SECONDS, 300, 1, 86_400),
  deliveryTimeoutMs: clampInt(process.env.DELIVERY_TIMEOUT_MS, 5_000, 1_000, 120_000),
  staleLockSeconds: clampInt(process.env.STALE_LOCK_SECONDS, 120, 15, 3_600),
  recoverySecret: process.env.RECOVERY_SECRET ?? "change-me",
};

function clampInt(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

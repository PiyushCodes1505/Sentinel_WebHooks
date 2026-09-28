import * as z from "zod";

export const endpointSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.url(),
});

export const eventSchema = z.object({
  endpointId: z.uuid(),
  type: z.string().trim().min(1).max(100),
  payload: z.unknown(),
});

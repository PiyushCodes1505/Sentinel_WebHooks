import crypto from "node:crypto";

export function generateSecret() {
  return crypto.randomBytes(24).toString("hex");
}

export function buildSignature(secret: string,timestamp: string,rawBody: string) {
  return crypto.createHmac("sha256",secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function timingSafeEqualHex(a: string,b: string) {
  const left=Buffer.from(a,"hex");
  const right=Buffer.from(b,"hex");
  if(left.length!==right.length)return false;
  return crypto.timingSafeEqual(left,right);
}

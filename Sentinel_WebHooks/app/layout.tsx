import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentinel Webhooks",
  description: "Fault-tolerant webhook delivery with retries, dead letters, idempotency, and HMAC signing.",
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}

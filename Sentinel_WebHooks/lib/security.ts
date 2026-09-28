import dns from "node:dns/promises";
import net from "node:net";

export class DestinationValidationError extends Error {
  constructor(message:string){
    super(message);
    this.name="DestinationValidationError";
  }
}

export async function validateDestinationUrl(input:string){
  let url:URL;
  try{
    url=new URL(input);
  }catch{
    throw new DestinationValidationError("Destination URL is invalid.");
  }

  if(!["http:","https:"].includes(url.protocol)){
    throw new DestinationValidationError("Only HTTP and HTTPS destinations are allowed.");
  }
  if(url.username||url.password){
    throw new DestinationValidationError("Destination credentials are not allowed in the URL.");
  }
  if(url.port && !["80","443"].includes(url.port)){
    throw new DestinationValidationError("Only standard HTTP/HTTPS ports are allowed.");
  }

  const hostname=url.hostname.toLowerCase();
  if(process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_DESTINATIONS !== "false"){
    if(hostname === "localhost" || hostname.endsWith(".localhost") || net.isIP(hostname)){
      if(hostname === "localhost" || hostname.endsWith(".localhost") || isLoopbackIp(hostname)) return url;
    }
  }

  let addresses:string[]=[];
  try{
    addresses=(await dns.lookup(hostname,{all:true,verbatim:true})).map((entry)=>entry.address);
  }catch{
    throw new DestinationValidationError("Destination hostname could not be resolved.");
  }

  if(process.env.NODE_ENV === "production"){
    for(const address of addresses){
      if(isBlockedAddress(address)) throw new DestinationValidationError("Destination resolves to a private or local network address.");
    }
  }

  return url;
}

function isLoopbackIp(ip:string){
  if(net.isIPv4(ip)) return ip.startsWith("127.") || ip === "0.0.0.0";
  if(net.isIPv6(ip)) return ip === "::1" || ip === "::";
  return false;
}

function isBlockedAddress(ip:string){
  if(net.isIPv4(ip)){
    const [a,b,c]=ip.split(".").map(Number);
    return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127);
  }
  if(net.isIPv6(ip)){
    const normalized=ip.toLowerCase();
    if(normalized.startsWith("::ffff:")){
      const mapped=normalized.slice(7);
      if(net.isIPv4(mapped)) return isBlockedAddress(mapped);
    }
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

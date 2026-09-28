"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type Endpoint={id:string;name:string;url:string;enabled:boolean;event_count:number;created_at:string;updated_at:string;secret?:string};
type EventRow={id:string;type:string;status:string;attempt_count:number;max_attempts:number;next_attempt_at:string|null;last_error:string|null;dead_reason:string|null;created_at:string;updated_at:string;endpoint_id:string;endpoint_name:string;endpoint_url:string};
type Attempt={id:string;event_id:string;attempt_number:number;status:string;http_status:number|null;latency_ms:number|null;response_excerpt:string|null;error_message:string|null;started_at:string;finished_at:string|null};
type ReceiverRequest={id:string;mode:string;method:string;path:string;headers:Record<string,string>;body:string;received_at:string};

type Metrics={total:number;delivered:number;retrying:number;dead:number;pending:number;success_rate:number;average_latency_ms:number;p95_latency_ms:number;attempts_today:number};

type Detail={event:EventRow & {payload:unknown};attempts:Attempt[]};

const nav=[
  ["overview","Overview"],
  ["endpoints","Endpoints"],
  ["events","Events"],
  ["dead","Dead Letters"],
  ["receiver","Test Receiver"],
  ["docs","How it works"],
] as const;

const statusClass=(status:string)=>`status status-${status}`;
const fmt=(v:string|null|undefined)=>v?new Date(v).toLocaleString():"—";
const shortId=(v:string)=>v.slice(0,8);

export default function Home(){
  const [view,setView]=useState<(typeof nav)[number][0]>("overview");
  const [metrics,setMetrics]=useState<Metrics>({total:0,delivered:0,retrying:0,dead:0,pending:0,success_rate:0,average_latency_ms:0,p95_latency_ms:0,attempts_today:0});
  const [endpoints,setEndpoints]=useState<Endpoint[]>([]);
  const [events,setEvents]=useState<EventRow[]>([]);
  const [dead,setDead]=useState<EventRow[]>([]);
  const [receiver,setReceiver]=useState<ReceiverRequest[]>([]);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState<string>("");
  const [showEndpointForm,setShowEndpointForm]=useState(false);
  const [showEventForm,setShowEventForm]=useState(false);
  const [newEndpoint,setNewEndpoint]=useState({name:"Demo Receiver",url:""});
  const [newEvent,setNewEvent]=useState({endpointId:"",type:"payment.succeeded",payload:'{\n  "orderId": "ORD-1001",\n  "amount": 2499,\n  "currency": "INR"\n}'});
  const [receiverMode,setReceiverMode]=useState("success");

  const api=useCallback(async(url:string,options?:RequestInit)=>{
    const response=await fetch(url,{...options,headers:{"content-type":"application/json",...(options?.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
    return data;
  },[]);

  const refresh=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const [m,e,ev,d,r]=await Promise.all([
        api("/api/metrics"),api("/api/endpoints"),api("/api/events"),api("/api/dead-letters"),api("/api/test-receiver/logs"),
      ]);
      setMetrics(m.metrics);setEndpoints(e.endpoints);setEvents(ev.events);setDead(d.events);setReceiver(r.requests);
      setNewEndpoint(prev=>({...prev,url:prev.url||`${window.location.origin}/api/test-receiver/success`}));
      if(!newEvent.endpointId && e.endpoints[0])setNewEvent(prev=>({...prev,endpointId:e.endpoints[0].id}));
    }catch(error){showToast(error instanceof Error?error.message:"Unable to load data");}
    finally{if(!silent)setLoading(false);}
  },[api]);

  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(true),5000);return()=>clearInterval(timer);},[refresh]);

  useEffect(()=>{if(!newEndpoint.url)setNewEndpoint(prev=>({...prev,url:`${window.location.origin}/api/test-receiver/success`}));},[newEndpoint.url]);

  const stats=useMemo(()=>[
    ["Total events",metrics.total,"neutral"],
    ["Delivered",metrics.delivered,"good"],
    ["Retrying",metrics.retrying,"warn"],
    ["Dead letters",metrics.dead,"bad"],
  ],[metrics]);

  function showToast(message:string){setToast(message);window.setTimeout(()=>setToast(""),3500);}

  async function createEndpoint(){
    try{
      const result=await api("/api/endpoints",{method:"POST",body:JSON.stringify(newEndpoint)});
      showToast(`Endpoint created. Secret: ${result.endpoint.secret}`);
      setShowEndpointForm(false);await refresh(true);
    }catch(error){showToast(error instanceof Error?error.message:"Failed to create endpoint");}
  }

  async function sendEvent(){
    try{
      const parsed=JSON.parse(newEvent.payload);
      const key=`demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result=await api("/api/events",{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify({endpointId:newEvent.endpointId,type:newEvent.type,payload:parsed})});
      showToast(`Event ${shortId(result.event.id)} accepted. Status: ${result.event.status}.`);
      setShowEventForm(false);setView("events");await refresh(true);
    }catch(error){showToast(error instanceof Error?error.message:"Invalid JSON payload");}
  }

  async function replay(id:string){
    try{await api(`/api/dead-letters/${id}/replay`,{method:"POST"});showToast(`Requeued ${shortId(id)}.`);await refresh(true);}catch(error){showToast(error instanceof Error?error.message:"Replay failed");}
  }

  async function recover(){
    try{const result=await api("/api/recovery",{method:"POST",headers:{"x-recovery-secret":prompt("Recovery secret")||""}});showToast(`Scanned ${result.scanned}; requeued ${result.queued}.`);await refresh(true);}catch(error){showToast(error instanceof Error?error.message:"Recovery failed");}
  }

  async function openDetail(id:string){
    try{const result=await api(`/api/events/${id}`);setDetail(result);}catch(error){showToast(error instanceof Error?error.message:"Unable to load event");}
  }

  const receiverUrl=typeof window!=="undefined"?`${window.location.origin}/api/test-receiver/${receiverMode}`:"";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><div className="brand-name">Sentinel</div><div className="brand-sub">Webhook Reliability</div></div></div>
      <nav className="nav">{nav.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={view===id?"nav-item active":"nav-item"}><span>{icon(id)}</span>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="system-dot"><span/>System operational</div><button className="mini-link" onClick={recover}>Recover pending</button></div>
    </aside>

    <main className="main">
      <header className="topbar"><div><div className="eyebrow">Developer Infrastructure</div><h1>{nav.find(n=>n[0]===view)?.[1]}</h1></div><div className="top-actions"><button className="secondary" onClick={()=>refresh()}>{loading?"Refreshing…":"Refresh"}</button><button className="primary" onClick={()=>setShowEventForm(true)}>Send event</button></div></header>

      {view==="overview"&&<section>
        <div className="hero"><div><div className="badge">AT-LEAST-ONCE DELIVERY</div><h2>Know where every webhook went.</h2><p>Sentinel accepts an event, stores it durably, delivers it asynchronously, and keeps the full delivery trail when the destination fails.</p></div><div className="hero-visual"><div className="pulse-card"><span className="pulse"/><div><strong>{metrics.success_rate}%</strong><small>delivery success</small></div></div><div className="flow-mini"><span>API</span><i>→</i><span>QUEUE</span><i>→</i><span>WORKER</span></div></div></div>
        <div className="stat-grid">{stats.map(([label,value,kind])=><div className={`stat-card ${kind}`} key={label as string}><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>)}</div>
        <div className="grid-2"><Panel title="Recent events" action={<button className="text-btn" onClick={()=>setView("events")}>View all</button>}><EventTable events={events.slice(0,6)} onOpen={openDetail}/></Panel><Panel title="Delivery performance"><div className="performance"><Metric label="Avg latency" value={`${metrics.average_latency_ms||0} ms`}/><Metric label="P95 latency" value={`${metrics.p95_latency_ms||0} ms`}/><Metric label="Attempts / 24h" value={String(metrics.attempts_today||0)}/></div><div className="note-box"><strong>Retry policy</strong><span>Exponential backoff with jitter · configurable max attempts · 429 honors Retry-After</span></div></Panel></div>
        <div className="grid-2"><Panel title="Quick demo"><div className="quick-grid"><button className="quick-action" onClick={()=>{setNewEvent(prev=>({...prev,endpointId:endpoints[0]?.id||""}));setShowEventForm(true);}}><span>↗</span><strong>Send a webhook</strong><small>Create and queue an event</small></button><button className="quick-action" onClick={()=>setView("receiver")}><span>◉</span><strong>Simulate failure</strong><small>Test 500s, timeouts, and 429s</small></button><button className="quick-action" onClick={()=>setView("docs")}><span>?</span><strong>Read the flow</strong><small>Understand the system design</small></button></div></Panel><Panel title="Endpoints"><div className="compact-list">{endpoints.slice(0,4).map(ep=><div className="compact-row" key={ep.id}><div className="endpoint-icon">↗</div><div className="row-main"><strong>{ep.name}</strong><span>{ep.url}</span></div><span className={ep.enabled?"state-on":"state-off"}>{ep.enabled?"Enabled":"Disabled"}</span></div>)}</div></Panel></div>
      </section>}

      {view==="endpoints"&&<section><div className="section-actions"><button className="primary" onClick={()=>setShowEndpointForm(true)}>+ Create endpoint</button><div className="muted">{endpoints.length} endpoint{endpoints.length===1?"":"s"}</div></div><div className="card"><table className="table"><thead><tr><th>Endpoint</th><th>Destination</th><th>Events</th><th>Status</th><th>Created</th><th/></tr></thead><tbody>{endpoints.map(ep=><tr key={ep.id}><td><div className="cell-main"><strong>{ep.name}</strong><small>{shortId(ep.id)}</small></div></td><td><code className="url">{ep.url}</code></td><td>{ep.event_count}</td><td><span className={ep.enabled?"state-on":"state-off"}>{ep.enabled?"Enabled":"Disabled"}</span></td><td>{fmt(ep.created_at)}</td><td><div className="row-actions"><button className="ghost-btn" onClick={async()=>{try{await api(`/api/endpoints/${ep.id}`,{method:"PATCH",body:JSON.stringify({enabled:!ep.enabled})});showToast(`Endpoint ${ep.enabled?"disabled":"enabled"}.`);await refresh(true);}catch(error){showToast(error instanceof Error?error.message:"Update failed");}}}>{ep.enabled?"Disable":"Enable"}</button><button className="ghost-btn" onClick={async()=>{try{await api(`/api/endpoints/${ep.id}`,{method:"DELETE"});showToast("Endpoint deleted.");await refresh(true);}catch(error){showToast(error instanceof Error?error.message:"Delete failed");}}}>Delete</button></div></td></tr>)}</tbody></table></div></section>}

      {view==="events"&&<section><div className="section-actions"><button className="primary" onClick={()=>setShowEventForm(true)}>+ Send event</button><div className="muted">Auto-refreshes every 5 seconds</div></div><div className="card"><EventTable events={events} onOpen={openDetail}/></div></section>}

      {view==="dead"&&<section><div className="section-actions"><div><div className="page-note">Dead letters are retained for inspection and manual replay.</div></div></div><div className="card"><table className="table"><thead><tr><th>Event</th><th>Endpoint</th><th>Reason</th><th>Attempts</th><th>Last update</th><th/></tr></thead><tbody>{dead.map(ev=><tr key={ev.id}><td><button className="linkish" onClick={()=>openDetail(ev.id)}>{shortId(ev.id)}</button><small>{ev.type}</small></td><td>{ev.endpoint_name}</td><td><span className="reason">{ev.dead_reason||ev.last_error||"Unknown failure"}</span></td><td>{ev.attempt_count}/{ev.max_attempts}</td><td>{fmt(ev.updated_at)}</td><td><button className="primary small" onClick={()=>replay(ev.id)}>Replay</button></td></tr>)}</tbody></table>{dead.length===0&&<Empty title="No dead letters" text="Your failed events will appear here after retry exhaustion or a non-retryable response."/>}</div></section>}

      {view==="receiver"&&<section><div className="grid-2"><Panel title="Receiver simulator"><p className="section-copy">Point a Sentinel endpoint at this URL and switch the mode to deliberately produce the response you want to test.</p><div className="field"><label>Mode</label><select value={receiverMode} onChange={e=>setReceiverMode(e.target.value)}><option value="success">200 — Success</option><option value="status-500">500 — Server error</option><option value="status-400">400 — Bad request</option><option value="status-429">429 — Rate limited</option><option value="slow">Slow — 2.5s delay</option><option value="timeout">Timeout — 8s delay</option></select></div><div className="copy-field"><code>{receiverUrl}</code><button onClick={()=>navigator.clipboard.writeText(receiverUrl)}>Copy</button></div><div className="receiver-tip"><strong>Demo:</strong> create an endpoint with this URL, then send an event. Change the mode to 500 and send another event to watch Sentinel retry.</div></Panel><Panel title="Recent received requests"><div className="receiver-log">{receiver.slice(0,10).map(item=><div className="receiver-item" key={item.id}><div className="receiver-top"><span className="mode-dot"/><strong>{item.mode}</strong><time>{fmt(item.received_at)}</time></div><div className="receiver-line"><code>{item.path}</code><span>{item.headers?.["x-sentinel-event-id"]?shortId(item.headers["x-sentinel-event-id"]):"no event id"}</span></div></div>)}{receiver.length===0&&<Empty title="No requests yet" text="Use the simulator URL above as a destination,then send an event."/>}</div></Panel></div></section>}

      {view==="docs"&&<section><div className="docs-grid"><div className="card doc-card"><div className="badge">THE DELIVERY PATH</div><h2>What Sentinel actually does</h2><FlowStep n="01" title="Accept" text="Your application POSTs an event to Sentinel. The event is validated and written to PostgreSQL before the API responds with 202 Accepted."/><FlowStep n="02" title="Queue" text="Sentinel publishes only the event ID to a durable queue. The payload stays in PostgreSQL as the source of truth."/><FlowStep n="03" title="Deliver" text="A queue consumer loads the event, signs the raw payload with HMAC-SHA256, and POSTs it to the destination with a hard timeout."/><FlowStep n="04" title="Retry" text="Temporary failures such as 500, timeouts, connection errors, and 429s are retried with exponential backoff and jitter."/><FlowStep n="05" title="Inspect" text="Every attempt is recorded. After the maximum attempts or a non-retryable response, the event becomes a dead letter that can be replayed manually."/></div><div className="card doc-card"><div className="badge neutral-badge">INTERVIEW NOTES</div><h3>Important design choices</h3><div className="bullet-block"><strong>At-least-once</strong><span>Sentinel prefers retrying an ambiguous result over silently losing an event. That means a receiver may see a duplicate and should deduplicate by event ID.</span></div><div className="bullet-block"><strong>Idempotency</strong><span>Inbound requests use Idempotency-Key so client retries do not create duplicate events. Outbound retries reuse the same event ID.</span></div><div className="bullet-block"><strong>HMAC</strong><span>Each request carries a timestamp plus HMAC-SHA256 signature. HMAC provides integrity/authenticity; HTTPS still protects confidentiality.</span></div><div className="bullet-block"><strong>SSRF</strong><span>The server makes outbound requests to user-provided URLs, so destination validation blocks local/private addresses in production mode and redirects are not followed.</span></div><div className="bullet-block"><strong>Queue vs database</strong><span>The queue coordinates work; PostgreSQL remains the durable source of truth. A recovery endpoint can requeue pending work if publishing fails.</span></div></div></div></section>}

      {showEndpointForm&&<Modal title="Create webhook endpoint" onClose={()=>setShowEndpointForm(false)}><div className="form-grid"><div className="field"><label>Name</label><input value={newEndpoint.name} onChange={e=>setNewEndpoint({...newEndpoint,name:e.target.value})}/></div><div className="field"><label>Destination URL</label><input value={newEndpoint.url} onChange={e=>setNewEndpoint({...newEndpoint,url:e.target.value})} placeholder="https://example.com/webhooks"/></div></div><div className="modal-note">A signing secret is generated server-side and shown once after creation.</div><div className="modal-actions"><button className="secondary" onClick={()=>setShowEndpointForm(false)}>Cancel</button><button className="primary" onClick={createEndpoint}>Create endpoint</button></div></Modal>}

      {showEventForm&&<Modal title="Send webhook event" onClose={()=>setShowEventForm(false)}><div className="form-grid"><div className="field"><label>Endpoint</label><select value={newEvent.endpointId} onChange={e=>setNewEvent({...newEvent,endpointId:e.target.value})}>{endpoints.map(ep=><option key={ep.id} value={ep.id}>{ep.name}</option>)}</select></div><div className="field"><label>Event type</label><input value={newEvent.type} onChange={e=>setNewEvent({...newEvent,type:e.target.value})}/></div><div className="field full"><label>JSON payload</label><textarea value={newEvent.payload} onChange={e=>setNewEvent({...newEvent,payload:e.target.value})}/></div></div><div className="modal-note">The event is accepted asynchronously. The response is 202 once the event has been validated and persisted.</div><div className="modal-actions"><button className="secondary" onClick={()=>setShowEventForm(false)}>Cancel</button><button className="primary" onClick={sendEvent}>Queue event</button></div></Modal>}

      {detail&&<Modal title={`Event ${shortId(detail.event.id)}`} onClose={()=>setDetail(null)} wide><div className="detail-header"><span className={statusClass(detail.event.status)}>{detail.event.status}</span><span>{detail.event.type}</span><span>{fmt(detail.event.created_at)}</span></div><div className="detail-grid"><div><h4>Destination</h4><code className="url">{detail.event.endpoint_url}</code></div><div><h4>Attempts</h4><strong>{detail.event.attempt_count} / {detail.event.max_attempts}</strong></div></div><div className="payload"><h4>Payload</h4><pre>{JSON.stringify(detail.event.payload,null,2)}</pre></div><h4>Delivery timeline</h4><div className="timeline">{detail.attempts.map(at=><div className="timeline-item" key={at.id}><div className="timeline-dot"/><div className="timeline-main"><div className="timeline-top"><strong>Attempt {at.attempt_number}</strong><span className={statusClass(at.status)}>{at.status}</span><time>{fmt(at.started_at)}</time></div><div className="timeline-meta">HTTP {at.http_status??"—"} · {at.latency_ms??"—"} ms</div>{at.error_message&&<div className="timeline-error">{at.error_message}</div>}{at.response_excerpt&&<pre className="response-excerpt">{at.response_excerpt}</pre>}</div></div>)}</div></Modal>}

      {toast&&<div className="toast">{toast}</div>}
    </main>
  </div>
}

function icon(id:string){switch(id){case"overview":return "◒";case"endpoints":return "↗";case"events":return "≡";case"dead":return "⚠";case"receiver":return "◉";default:return "?";}}
function Panel({title,action,children}:{title:string;action?:ReactNode;children:ReactNode}){return <div className="card panel"><div className="panel-head"><h3>{title}</h3>{action}</div>{children}</div>}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
function Empty({title,text}:{title:string;text:string}){return <div className="empty"><strong>{title}</strong><span>{text}</span></div>}
function EventTable({events,onOpen}:{events:EventRow[];onOpen:(id:string)=>void}){return <table className="table"><thead><tr><th>Event</th><th>Endpoint</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead><tbody>{events.map(ev=><tr key={ev.id}><td><button className="linkish" onClick={()=>onOpen(ev.id)}>{shortId(ev.id)}</button><small>{ev.type}</small></td><td>{ev.endpoint_name}</td><td><span className={statusClass(ev.status)}>{ev.status}</span></td><td>{ev.attempt_count}/{ev.max_attempts}</td><td>{fmt(ev.created_at)}</td></tr>)}{events.length===0&&<tr><td colSpan={5}><Empty title="No events yet" text="Send a test event to see the delivery lifecycle here."/></td></tr>}</tbody></table>}
function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){return <div className="overlay" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><div className={wide?"modal wide":"modal"}><div className="modal-head"><h2>{title}</h2><button className="close" onClick={onClose}>×</button></div>{children}</div></div>}
function FlowStep({n,title,text}:{n:string;title:string;text:string}){return <div className="flow-step"><div className="flow-num">{n}</div><div><h3>{title}</h3><p>{text}</p></div></div>}

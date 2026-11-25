import React,{useState,useEffect,useId} from "react";
import {OwnerDocuments} from "@/components/TradingDocuments";
import {api,apiError} from "@/lib/api";
import {previewBlob} from "@/lib/documentPreview";
import {Modal,Input} from "@/components/kit";
import {FileText,FilePenLine,FolderOpen,ChevronLeft} from "lucide-react";
import {toast} from "sonner";

function Folder({label,onClick}){
 const id=useId().replace(/:/g,"");
 return <button type="button" onClick={onClick} className="flex min-w-0 flex-col items-center rounded-xl border border-border bg-[var(--surface)] p-2 text-center hover:border-[var(--gold)]">
 <svg viewBox="0 0 160 120" className="w-full max-w-[170px]" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffe6a0"/><stop offset=".5" stopColor="#c69a3d"/><stop offset="1" stopColor="#78501c"/></linearGradient></defs><ellipse cx="80" cy="106" rx="62" ry="7" fill="#000" opacity=".35"/><path d="M18 30 Q18 24 25 24 H60 L73 36 H136 Q142 36 142 43 V94 H18Z" fill="#8f6829" stroke="#e2be65"/><rect x="48" y="14" width="65" height="73" rx="3" fill="#f8f0d7" transform="rotate(6 80 50)"/>{[30,39,48,57].map(y=><path key={y} d={`M59 ${y} H101`} stroke="#9e9274" strokeWidth="2"/>)}<path d="M12 51 Q12 45 20 45 H142 Q150 45 148 53 L139 98 Q138 103 130 103 H29 Q21 103 20 96Z" fill={`url(#${id})`} stroke="#f3d78a"/><rect x="65" y="67" width="30" height="23" rx="3" fill="#173d32" stroke="#f3d78a"/><path d="M72 74 H88 M72 79 H88 M72 84 H83" stroke="#f3d78a" strokeWidth="2"/></svg>
 <span className="break-words text-sm font-semibold">{label}</span></button>;
}
export default function Invoices(){
 const [action,setAction]=useState(null),[kind,setKind]=useState(""),[docs,setDocs]=useState([]),[party,setParty]=useState(null),[q,setQ]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!kind)return;let active=true;setLoading(true);setDocs([]);api.get("/paper/archive",{params:{kind}}).then(r=>{if(active)setDocs(r.data)}).catch(e=>{if(active)toast.error(apiError(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[kind]);
 const groups=new Map();for(const d of docs){const key=d.party_id||("legacy:"+String(d.party||"Unknown"));if(!groups.has(key))groups.set(key,{name:d.party||"Unknown",rows:[]});groups.get(key).rows.push(d);}
 const open=async d=>{try{const r=await api.get("/paper/"+encodeURIComponent(d.id)+"/pdf",{responseType:"blob"});previewBlob(r.data,(d.party||"Invoice")+"-"+d.number+".pdf")}catch(e){toast.error(apiError(e))}};
 return <main className="mx-auto max-w-3xl p-4"><h1 className="mb-4 font-head text-2xl font-bold gold-text">Invoices</h1>
 <div className="mb-5 grid grid-cols-2 gap-2">{[["manual","New Invoice"],["custom","Custom Invoice"]].map(([k,l])=><button key={k} type="button" onClick={()=>setAction({kind:k,mode:"new"})} className="flex min-w-0 items-center justify-center gap-1 rounded border border-[var(--gold)] px-2 py-3 text-xs font-semibold"><FilePenLine size={16} className="shrink-0 gold-text"/>{l}</button>)}</div>
 <div className="grid grid-cols-2 gap-3">{[["manual","Purchase Invoices"],["custom","Custom Invoices"],["broker","Broker Invoices"],["customer","Customer Invoices"]].map(([k,l])=><Folder key={k} label={l} onClick={()=>{if(k==="manual"||k==="custom")setAction({kind:k,mode:"archive"});else{setParty(null);setQ("");setKind(k)}}}/>)}</div>
 <OwnerDocuments invoiceKind="manual" externalAction={action} hideActions/><OwnerDocuments invoiceKind="custom" externalAction={action} hideActions/>
 <Modal open={!!kind} onClose={()=>{setKind("");setParty(null)}} title={kind==="broker"?"Broker Invoices":"Customer Invoices"} wide>
 {party&&<button className="mb-2 flex items-center gap-1" onClick={()=>{setParty(null);setQ("")}}><ChevronLeft size={16}/>Back</button>}
 <Input placeholder={party?"Search invoice":"Search company"} value={q} onChange={e=>setQ(e.target.value)}/>
 {loading?<p>Loading...</p>:party?<div className="grid gap-2"><h3 className="gold-text font-bold">{groups.get(party)?.name}</h3>{(groups.get(party)?.rows||[]).filter(d=>[d.number,d.date,d.party].join(" ").toLowerCase().includes(q.toLowerCase())).map(d=><button key={d.id} onClick={()=>open(d)} className="flex min-w-0 items-center gap-3 rounded border border-border p-3 text-start"><FileText className="shrink-0 gold-text"/><span className="min-w-0 break-words"><b>{d.party}</b><br/>{d.number} · {d.date}</span></button>)}</div>:<div className="grid grid-cols-2 gap-2">{[...groups].filter(([k,g])=>g.name.toLowerCase().includes(q.toLowerCase())).map(([k,g])=><Folder key={k} label={g.name+" ("+g.rows.length+")"} onClick={()=>{setParty(k);setQ("")}}/>)}</div>}
 {!loading&&!docs.length&&<p className="p-4 text-center text-muted-foreground">No records yet</p>}</Modal></main>
}

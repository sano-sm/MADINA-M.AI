import React,{useState,useEffect,useId} from "react";
import {OwnerDocuments} from "@/components/TradingDocuments";
import {api,apiError} from "@/lib/api";
import {previewBlob} from "@/lib/documentPreview";
import {Modal,Input} from "@/components/kit";
import {FileText,FilePenLine,FolderOpen,ChevronLeft} from "lucide-react";
import {toast} from "sonner";

function Folder({label,onClick,kind="company"}){
 const id=useId().replace(/:/g,"");
 const mark={manual:"¥",custom:"✎",broker:"B",customer:"C",company:"PDF"}[kind];
 return <button type="button" onClick={onClick} className="group relative flex min-h-[100px] min-w-0 items-center gap-1.5 overflow-hidden rounded-[15px] p-2 text-left text-[#fff8e6] transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-300 sm:gap-3 sm:p-4" style={{background:"linear-gradient(145deg,#12423b 0%,#052a28 45%,#031b1b 100%)",border:"2px solid #d9b45d",boxShadow:"inset 0 0 0 2px #102b26,inset 0 0 0 3px #80662e,0 4px 9px #0007"}}>
 <svg viewBox="0 0 86 104" className="w-[34%] max-w-[85px] shrink-0" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff9dd"/><stop offset=".55" stopColor="#f0d58b"/><stop offset="1" stopColor="#bd8735"/></linearGradient><linearGradient id={id+"g"} x2="1" y2="1"><stop stopColor="#27816c"/><stop offset="1" stopColor="#073a33"/></linearGradient></defs>
 <path d="M12 15 H57 L75 33 V94 H12Z" fill="#000" opacity=".3" transform="translate(3 3)"/><path d="M8 22 L24 6 H59 L76 23 V91 Q76 96 70 96 H14 Q8 96 8 90Z" fill={`url(#${id})`} stroke="#ffe5a0" strokeWidth="1.5"/><path d="M8 22 H24 V6 M59 6 V23 H76" fill="#cba45b" stroke="#fff2bf"/>
 <rect x="19" y="25" width="46" height="23" rx="4" fill={`url(#${id}g)`} stroke="#e5c674"/><text x="42" y="42" textAnchor="middle" fontSize={kind==="company"?13:19} fontWeight="bold" fill="#fff6d5">{mark}</text>
 <path d="M20 56 H61 M20 65 H55 M20 74 H43" stroke="#20564a" strokeWidth="3" strokeLinecap="round"/>
 {kind==="custom"?<g transform="rotate(35 65 73)"><rect x="61" y="48" width="8" height="39" rx="3" fill="#0b5144" stroke="#f5cf76"/><path d="M61 87 H69 L65 96Z" fill="#b48130"/></g>:<g><circle cx="65" cy="79" r="14" fill="#103f36" stroke="#f5cf76" strokeWidth="2"/><path d="M58 79 L63 84 L72 74" fill="none" stroke="#ffe3a0" strokeWidth="3" strokeLinecap="round"/></g>}
 </svg><span className="min-w-0 flex-1 break-words text-[12px] font-bold leading-tight sm:text-base">{label}</span><span aria-hidden="true" className="shrink-0 text-lg font-bold text-[#eac46d]">»</span></button>;
}
export default function Invoices(){
 const [action,setAction]=useState(null),[kind,setKind]=useState(""),[docs,setDocs]=useState([]),[party,setParty]=useState(null),[q,setQ]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!kind)return;let active=true;setLoading(true);setDocs([]);api.get("/paper/archive",{params:{kind}}).then(r=>{if(active)setDocs(r.data)}).catch(e=>{if(active)toast.error(apiError(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[kind]);
 const groups=new Map();for(const d of docs){const key=d.party_id||("legacy:"+String(d.party||"Unknown"));if(!groups.has(key))groups.set(key,{name:d.party||"Unknown",rows:[]});groups.get(key).rows.push(d);}
 const open=async d=>{try{const r=await api.get("/paper/"+encodeURIComponent(d.id)+"/pdf",{responseType:"blob"});previewBlob(r.data,(d.party||"Invoice")+"-"+d.number+".pdf")}catch(e){toast.error(apiError(e))}};
 return <main className="mx-auto max-w-3xl p-4"><h1 className="mb-4 font-head text-2xl font-bold gold-text">Invoices</h1>
 <div className="mb-5 grid grid-cols-2 gap-2">{[["manual","New Invoice"],["custom","Custom Invoice"]].map(([k,l])=><button key={k} type="button" onClick={()=>setAction({kind:k,mode:"new"})} className="flex min-w-0 items-center justify-center gap-1 rounded border border-[var(--gold)] px-2 py-3 text-xs font-semibold"><FilePenLine size={16} className="shrink-0 gold-text"/>{l}</button>)}</div>
 <div className="grid grid-cols-2 gap-3">{[["manual","Purchase Invoices"],["custom","Custom Invoices"],["broker","Broker Invoices"],["customer","Customer Invoices"]].map(([k,l])=><Folder key={k} kind={k} label={l} onClick={()=>{if(k==="manual"||k==="custom")setAction({kind:k,mode:"archive"});else{setParty(null);setQ("");setKind(k)}}}/>)}</div>
 <OwnerDocuments invoiceKind="manual" externalAction={action} hideActions/><OwnerDocuments invoiceKind="custom" externalAction={action} hideActions/>
 <Modal open={!!kind} onClose={()=>{setKind("");setParty(null)}} title={kind==="broker"?"Broker Invoices":"Customer Invoices"} wide>
 {party&&<button className="mb-2 flex items-center gap-1" onClick={()=>{setParty(null);setQ("")}}><ChevronLeft size={16}/>Back</button>}
 <Input placeholder={party?"Search invoice":"Search company"} value={q} onChange={e=>setQ(e.target.value)}/>
 {loading?<p>Loading...</p>:party?<div className="grid gap-2"><h3 className="gold-text font-bold">{groups.get(party)?.name}</h3>{(groups.get(party)?.rows||[]).filter(d=>[d.number,d.date,d.party].join(" ").toLowerCase().includes(q.toLowerCase())).map(d=><button key={d.id} onClick={()=>open(d)} className="flex min-w-0 items-center gap-3 rounded border border-border p-3 text-start"><FileText className="shrink-0 gold-text"/><span className="min-w-0 break-words"><b>{d.party}</b><br/>{d.number} · {d.date}</span></button>)}</div>:<div className="grid grid-cols-2 gap-2">{[...groups].filter(([k,g])=>g.name.toLowerCase().includes(q.toLowerCase())).map(([k,g])=><Folder key={k} label={g.name+" ("+g.rows.length+")"} onClick={()=>{setParty(k);setQ("")}}/>)}</div>}
 {!loading&&!docs.length&&<p className="p-4 text-center text-muted-foreground">No records yet</p>}</Modal></main>
}

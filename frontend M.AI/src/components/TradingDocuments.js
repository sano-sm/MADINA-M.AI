import React, { useEffect, useRef, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { Btn, Field, Input, Modal } from "@/components/kit";
import { previewBlob, printWindow } from "@/lib/documentPreview";
import { toast } from "sonner";
import { FileText, FolderOpen, FilePenLine, Plus, Trash2, Check } from "lucide-react";

const today = () => new Date().toLocaleDateString("sv-SE");
const newRow = () => ({date:today(), name:"", chassis:"", gross:""});
const money = n => "¥" + Number(n || 0).toLocaleString();
const failed = e => toast.error(apiError(e));
const bankFields = [["bank_name","Bank name"],["branch","Branch"],["branch_code","Branch code"],["account_number","Account number"],["account_name","Account holder"]];

export function TaxId({value,onChange,disabled=false}) {
  return <Field label="Tax ID"><div className="flex items-center gap-2"><b>T</b>
    <Input disabled={disabled} inputMode="numeric" placeholder="13 digits (optional)" value={(value.tax_id || "").replace(/^T/,"")}
      onChange={e=>{const v=e.target.value.replace(/\D/g,"").slice(0,13); onChange({...value,tax_id:v ? "T"+v : ""});}} /></div></Field>;
}

export function PartyFields({value,onChange,broker}) {
  return <><div className="grid gap-x-3 sm:grid-cols-2">{[["address","Address"],...(broker ? bankFields : []),["notes","Notes"]].map(([k,label]) =>
    <Field key={k} label={label}><Input value={value[k] || ""} onChange={e=>onChange({...value,[k]:e.target.value})} /></Field>)}</div>
    <TaxId value={value} onChange={onChange}/></>;
}

async function readDocument(id) {
  const {data,headers} = await api.get("/paper/"+encodeURIComponent(id)+"/pdf",{responseType:"blob"});
  const name = /filename="([^"]+)"/.exec(headers["content-disposition"] || "")?.[1];
  previewBlob(data,name || "Invoice.pdf");
}

function Statement({party, rows}) {
  function print() {
    const w = printWindow(); if (!w) return;
    const d=w.document; d.open(); d.write("<!doctype html><html><head><title>Customer statement</title><style>body{font:13px Arial;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:6px;text-align:left}h1{color:#163f35}</style></head><body></body></html>"); d.close();
    function element(tag,text,parent=d.body) {const e=d.createElement(tag);e.textContent=text;parent.appendChild(e);return e;}
    element("h1",party.name);element("p",[party.address,party.phone].filter(Boolean).join(" · "));
    element("p","Billed "+money(party.balance.billed)+"   Paid "+money(party.balance.paid)+"   Advance "+money(party.balance.advance)+"   Balance "+money(party.balance.outstanding));
    const table=element("table","");const tr=element("tr","",table);
    ["Date","Record","Description / Chassis","Amount"].forEach(x=>element("th",x,tr));
    const entries=[
      ...(party.invoices||[]).map(x=>[x.sale_date||x.created_at,x.invoice_number,(x.items||[]).map(i=>[i.item_name,i.chassis_number].filter(Boolean).join(" ")).join(", "),x.total]),
      ...rows.filter(x=>!x.key.includes(":")).map(x=>[x.date,"Vehicle",x.name+" "+x.chassis,x.gross]),
      ...(party.tracked_sales||[]).map(x=>[x.sale_date,"Parts",x.name||x.engine_number,x.sale_price]),
      ...(party.part_sales||[]).map(x=>[x.date,"Parts",x.part_name,x.sale_price]),
      ...(party.shipping_costs||[]).map(x=>[x.date,"Shipping",x.container_number,x.amount]),
      ...(party.payments||[]).map(x=>[x.date||x.created_at,"Payment",x.note||x.method,x.amount])
    ];
    for(const [date,type,desc,amt] of entries){const row=element("tr","",table);[String(date||"").slice(0,10),type,desc,money(amt)].forEach(v=>element("td",v||"",row));}
    w.focus();w.print();
  }
  return <Btn variant="dark" onClick={print}>Full account PDF</Btn>;
}

export function IssuePanel({kind,party,fullReport}) {
  const [rows,setRows]=useState(null),[checked,setChecked]=useState([]),[busy,setBusy]=useState(false);
  const key=useRef(""), lock=useRef(false);
  async function open() {
    try {const r=await api.get("/paper/source/"+kind+"/"+party.id);setRows(r.data);setChecked([]);key.current=crypto.randomUUID();} catch(e){failed(e);}
  }
  async function issue(){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const r=await api.post("/paper",{kind,party_id:party.id,selected:checked,request_id:key.current});await readDocument(r.data.id);setRows(null);}
    catch(e){failed(e);}finally{lock.current=false;setBusy(false);}
  }
  function select(ids){setChecked(ids);key.current=crypto.randomUUID();}
  return <><Btn variant="dark" onClick={open}>PDF / Invoice</Btn>
    <Modal open={rows!==null} onClose={()=>setRows(null)} title={party.name} wide>
      {rows && <>{kind==="customer" ? <Statement party={party} rows={rows}/> : <Btn variant="dark" onClick={fullReport}>Full account PDF · مکمل حساب</Btn>}
        <label className="my-3 block"><input type="checkbox" checked={!!rows.length && rows.length===checked.length} onChange={e=>select(e.target.checked?rows.map(r=>r.key):[])} /> All vehicles</label>
        <div className="max-h-80 overflow-auto">{rows.map(r=><label key={r.key} className="block border-b py-2"><input type="checkbox" checked={checked.includes(r.key)} onChange={e=>select(e.target.checked?[...checked,r.key]:checked.filter(k=>k!==r.key))}/> {r.date} · {r.name} · {r.chassis} · {money(r.gross)}</label>)}</div>
        <Btn disabled={busy||!checked.length} onClick={issue}>Create Invoice ({checked.length})</Btn></>}
    </Modal></>;
}

export function OwnerDocuments({compact=false, invoiceKind="manual"}){
  const {settings}=useSettings();
  const [mode,setMode]=useState(""),[seller,setSeller]=useState({name:""}),[rows,setRows]=useState([]),[busy,setBusy]=useState(false);
  const [q,setQ]=useState(""),[sortBy,setSortBy]=useState("date"),[docs,setDocs]=useState([]),[selected,setSelected]=useState([]);const requestId=useRef(""),lock=useRef(false),pressTimer=useRef(null),suppressClick=useRef(false);
  useEffect(()=>{if(mode!=="archive")return;let current=true;const timer=setTimeout(()=>api.get("/paper/archive",{params:{q,kind:invoiceKind==="custom"?"custom":"standard",sort:sortBy}}).then(r=>{if(current){setDocs(r.data);setSelected([]);}}).catch(failed),180);return()=>{current=false;clearTimeout(timer);};},[mode,q,invoiceKind,sortBy]);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get("record");if(id)readDocument(id).catch(failed);},[]);
  function start(){setSeller({name:""});setRows([newRow()]);requestId.current=crypto.randomUUID();setMode("manual");}
  async function save(){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const {data}=await api.post("/paper",{kind:invoiceKind,request_id:requestId.current,seller,rows});await readDocument(data.id);setMode("");}catch(e){failed(e);}finally{lock.current=false;setBusy(false);}
  }
  function toggleSelected(id){setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);}
  function startPress(id){suppressClick.current=false;clearTimeout(pressTimer.current);pressTimer.current=setTimeout(()=>{suppressClick.current=true;toggleSelected(id);},550);}
  function endPress(){clearTimeout(pressTimer.current);}
  async function removeSelected(){
    if(!selected.length)return;
    if(!window.confirm(`Delete ${selected.length} selected invoice${selected.length>1?"s":""}?`))return;
    try{await Promise.all(selected.map(id=>api.delete("/paper/"+encodeURIComponent(id))));setDocs(v=>v.filter(d=>!selected.includes(d.id)));setSelected([]);toast.success("Invoice deleted");}catch(e){failed(e);}
  }
  const total=rows.reduce((n,r)=>n+Number(r.gross||0),0),net=Math.round(total*10/11);
  const newActionCard = "group flex h-[78px] w-[116px] flex-col items-center justify-center rounded-xl border border-[var(--gold)]/50 bg-gradient-to-b from-[#55462b]/40 to-white/[0.02] p-2 text-center shadow-[0_4px_18px_rgba(177,145,73,0.12)] transition hover:-translate-y-1 hover:border-[var(--gold)] hover:shadow-[0_8px_24px_rgba(177,145,73,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  const savedActionCard = "group relative mt-5 flex h-[104px] w-[116px] flex-col items-center justify-center rounded-xl border border-[var(--gold)]/30 bg-gradient-to-br from-[#403925]/50 via-white/[0.04] to-white/[0.01] p-2 text-center shadow-lg transition hover:-translate-y-1 hover:border-[var(--gold)]/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  return <div className={compact ? "grid justify-items-center gap-4" : "mb-4 flex flex-wrap gap-2"}>
    {compact ? <>
      <button type="button" onClick={start} className={newActionCard}><span className="text-[var(--gold)]"><FilePenLine size={26} strokeWidth={1.6} /></span><span className="mt-1 block font-head text-[11px] font-bold leading-tight text-white">{invoiceKind==="custom"?"Custom Invoice":"Purchase Invoice"}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">New</span></button>
      <button type="button" onClick={()=>setMode("archive")} className={savedActionCard}><span aria-hidden="true" className="absolute -top-2 left-3 h-3 w-10 rounded-t-md border border-b-0 border-[var(--gold)]/40 bg-[#66522d]" /><span className="text-[var(--gold)] drop-shadow-[0_2px_5px_rgba(177,145,73,0.3)]"><FolderOpen size={35} strokeWidth={1.5} /></span><span className="mt-2 block font-head text-[11px] font-bold leading-tight text-white">{invoiceKind==="custom"?"Saved Custom Invoices":"Saved Invoices"}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Folder</span></button>
    </> : <><Btn onClick={start}>{invoiceKind==="custom"?"Custom Invoice":"Purchase Invoice"}</Btn><Btn variant="dark" onClick={()=>setMode("archive")}>Saved Invoices</Btn></>}
    <Modal open={mode==="manual"} onClose={()=>setMode("")} title={invoiceKind==="custom"?"New Custom Invoice":"New Purchase Invoice"} wide>
      <p className="my-2">To · {settings?.name} · {settings?.address} · {settings?.phone}</p>
      <form onSubmit={e=>{e.preventDefault();save();}} onChange={()=>{requestId.current=crypto.randomUUID();}}>
      <div className="grid gap-x-3 sm:grid-cols-2">{[["name","From · Seller"],["address","Address"],["phone","Phone"],["bank_details","Bank details (optional)"]].map(([k,label])=><Field key={k} label={label}><Input required={k==="name"} value={seller[k]||""} onChange={e=>setSeller({...seller,[k]:e.target.value})}/></Field>)}<TaxId value={seller} onChange={setSeller}/></div>
      {rows.map((r,i)=><div key={i} className="my-3 grid gap-2 border-t pt-2 sm:grid-cols-4">{[["date","Date","date"],["name","Vehicle","text"],["chassis","Chassis","text"],["gross","Price incl. tax","number"]].map(([k,label,type])=><Field key={k} label={label}><Input type={type} required={k!=="chassis"} min={0} step={1} value={r[k]} onChange={e=>setRows(rows.map((v,j)=>i===j?{...v,[k]:e.target.value}:v))}/></Field>)}{rows.length>1&&<button type="button" onClick={()=>{setRows(rows.filter((_,j)=>j!==i));requestId.current=crypto.randomUUID();}}>Remove vehicle</button>}</div>)}
      <button type="button" onClick={()=>{setRows([...rows,newRow()]);requestId.current=crypto.randomUUID();}}>＋ Add vehicle</button>
      <div className="my-4">Subtotal {money(net)} · Tax (10%) {money(total-net)} · Total {money(total)}</div>
      <button className="gold-gradient rounded p-2 text-black" disabled={busy}>Confirm invoice</button></form>
    </Modal>
    <Modal open={mode==="archive"} onClose={()=>setMode("")} title={invoiceKind==="custom"?"Saved Custom Invoices":"Saved Invoices"} wide><div className="flex items-center gap-2"><Input placeholder="Invoice number, company, vehicle or chassis" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Sort invoices" value={sortBy} onChange={e=>setSortBy(e.target.value)} className="h-10 min-w-0 rounded-md border border-border bg-background px-2 text-xs text-white"><option value="date">Date</option><option value="number">Invoice No.</option></select><button type="button" aria-label="Delete selected invoices" title="Delete selected" disabled={!selected.length} onClick={removeSelected} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition hover:border-red-400 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={17}/></button></div>
      <p className="mt-2 text-[10px] text-muted-foreground">Tap a card to open PDF · press and hold to select</p>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8 sm:gap-3 lg:grid-cols-10">{docs.map(d=>{const isSelected=selected.includes(d.id);return <button type="button" className={`relative flex aspect-[.72] min-w-0 flex-col items-center justify-between overflow-hidden rounded-md border p-1.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--gold)]/80 ${isSelected?"border-red-400 bg-red-500/10 ring-2 ring-red-400/40":"border-slate-300/30 bg-white"}`} key={d.id} onPointerDown={()=>startPress(d.id)} onPointerUp={endPress} onPointerCancel={endPress} onPointerLeave={endPress} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}readDocument(d.id).catch(failed);}}>
        <span className="absolute left-0 top-0 h-1 w-full bg-red-500"/><span className={`mt-1 grid h-8 w-7 place-items-center rounded-sm border text-red-500 ${isSelected?"border-red-400 bg-red-100":"border-slate-300 bg-slate-50"}`}>{isSelected?<Check size={16}/>:<FileText size={17}/>}</span><span className="min-w-0 max-w-full"><span className="block truncate text-[8px] font-bold uppercase tracking-tight text-slate-500">Invoice No.</span><b className="block truncate text-[10px] leading-tight text-slate-900">{d.number || "—"}</b><span className="mt-1 block truncate text-[9px] text-slate-500">{String(d.date || "—").slice(0,10)}</span></span><span className="mb-0.5 text-[7px] font-bold uppercase tracking-wider text-red-500">PDF</span>
      </button>})}</div></Modal></div>;
}

export function SearchRecords({close,navigate,initialQuery=""}){
  const [q,setQ]=useState(initialQuery),[rows,setRows]=useState([]);
  useEffect(()=>{let active=true;setRows([]);if(!q.trim())return;const timer=setTimeout(()=>api.get("/record-search",{params:{q}}).then(r=>{if(active)setRows(r.data);}).catch(failed),200);return()=>{active=false;clearTimeout(timer);};},[q]);
  return <Modal open onClose={close} title="Search records / ریکارڈ تلاش کریں" wide><Input autoFocus placeholder="Name, chassis, invoice, part…" value={q} onChange={e=>setQ(e.target.value)}/>
    {rows.map((r,i)=><button key={i} className="block w-full border-b p-2 text-start" onClick={()=>{close();navigate("/"+r.route+(r.record?"?record="+encodeURIComponent(r.record):""));}}><small className="gold-text">{r.section}</small><br/>{r.label}</button>)}</Modal>;
}

export function Restore(){
  const [copy,setCopy]=useState(true),[result,setResult]=useState(null);
  const [file,setFile]=useState(null),[info,setInfo]=useState(null),[busy,setBusy]=useState(false);
  async function submit(apply){
    if(!file || busy)return;
    if(apply && !window.confirm("Restore "+info.company+" records to "+(copy?"a new separate recovery database?":"this empty test database?")))return;
    const data=new FormData();data.append("file",file);setBusy(true);
    try{const r=await api.post("/owner/restore",data,{params:{confirm:apply?info.digest:"", recovery_copy:copy},__noRetry:true});
      if(apply){setResult(r.data);toast.success("Restored "+r.data.company);setInfo(null);setFile(null);}else setInfo(r.data);
    }catch(e){failed(e);}finally{setBusy(false);}
  }
  return <div className="mt-4 border-t pt-3"><Field label="Restore business backup ZIP"><input disabled={busy} type="file" accept=".zip" onChange={e=>{setFile(e.target.files[0]);setInfo(null);}}/></Field>
    <Btn variant="dark" disabled={!file||busy} onClick={()=>submit(false)}>Preview ZIP</Btn>
    {info&&<div className="my-2"><b>{info.company} · {info.date}</b><label className="my-2 block"><input type="checkbox" checked={copy} onChange={e=>setCopy(e.target.checked)}/> Create a separate recovery database</label><details><summary>Record counts</summary>{Object.entries(info.counts).map(([k,n])=><div key={k}>{k}: {n}</div>)}</details><Btn disabled={busy} onClick={()=>submit(true)}>{copy?"Create recovery copy":"Restore to empty test database"}</Btn></div>}{result&&<p className="my-2">Restored {result.company} · {result.database || "Current test database"}</p>}</div>;
}

import React, { useEffect, useRef, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { Btn, Field, Input, Modal } from "@/components/kit";
import { previewBlob, printWindow } from "@/lib/documentPreview";
import { toast } from "sonner";
import { FileText, FilePenLine, Plus, Trash2, Check } from "lucide-react";
import { AUTO_PART_NAMES } from "@/lib/autoPartsCatalog";

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

export function OwnerDocuments({compact=false, invoiceKind="manual", externalAction=null, hideActions=false}){
  const {settings}=useSettings();
  const [mode,setMode]=useState(""),[seller,setSeller]=useState({name:""}),[rows,setRows]=useState([]),[busy,setBusy]=useState(false);
  const [savedSellers,setSavedSellers]=useState([]),[sellerSearch,setSellerSearch]=useState(""),[sellerPicker,setSellerPicker]=useState(false);
  useEffect(()=>{if(mode!=="manual"||invoiceKind!=="manual")return;let active=true;api.get("/paper/purchase-sellers").then(r=>{if(active)setSavedSellers(r.data||[]);}).catch(failed);return()=>{active=false;};},[mode,invoiceKind]);
  const [autoParts,setAutoParts]=useState(null);
  const [nextAutoNumber,setNextAutoNumber]=useState("");
  const [q,setQ]=useState(""),[sortBy,setSortBy]=useState("date"),[docs,setDocs]=useState([]),[selected,setSelected]=useState([]),[archiveCount,setArchiveCount]=useState(0);const requestId=useRef(""),lock=useRef(false),pressTimer=useRef(null),suppressClick=useRef(false);
  useEffect(()=>{if(mode!=="auto")return;let active=true;api.get("/paper/auto-parts/next-number").then(r=>{if(active)setNextAutoNumber(r.data.number||"");}).catch(()=>{});return()=>{active=false;};},[mode]);
  useEffect(()=>{let active=true;api.get("/paper/archive",{params:{kind:invoiceKind}}).then(r=>{if(active)setArchiveCount(r.data.length);}).catch(()=>{});return()=>{active=false;};},[invoiceKind,mode]);
  useEffect(()=>{if(mode!=="archive")return;let current=true;const timer=setTimeout(()=>api.get("/paper/archive",{params:{q,kind:invoiceKind,sort:sortBy}}).then(r=>{if(current){setDocs(r.data);setSelected([]);}}).catch(failed),180);return()=>{current=false;clearTimeout(timer);};},[mode,q,invoiceKind,sortBy]);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get("record");if(id)readDocument(id).catch(failed);},[]);
  function start(){requestId.current=crypto.randomUUID();if(invoiceKind==="custom"){setNextAutoNumber("");setAutoParts({loading_date:today(),engines:Array.from({length:60},()=>({number:"",price:""})),chassis:Array.from({length:12},()=>({number:"",price:""})),parts:Array.from({length:40},()=>({number:"",price:""}))});setMode("auto");return;}setSeller({name:""});setSellerSearch("");setSellerPicker(false);setRows([newRow()]);setMode("manual");}
  useEffect(()=>{if(externalAction?.kind!==invoiceKind)return;if(externalAction.mode==="new")start();else if(externalAction.mode==="archive")setMode("archive");},[externalAction]);
  async function save(){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const {data}=await api.post("/paper",{kind:invoiceKind,request_id:requestId.current,seller,rows});await readDocument(data.id);setMode("");}catch(e){failed(e);}finally{lock.current=false;setBusy(false);}
  }
  async function saveAutoParts(){
    if(lock.current || !autoParts)return;
    lock.current=true;setBusy(true);
    try {
      const sections={};
      for(const type of ["engines","chassis","parts"])sections[type]=autoParts[type].map(r=>({number:r.number.trim(),price:r.price===""?null:Number(r.price)}));
      const {data}=await api.post("/paper/auto-parts",{request_id:requestId.current,loading_date:autoParts.loading_date,...sections});
      await readDocument(data.id);setMode("");setAutoParts(null);
    } catch(e){failed(e);} finally{lock.current=false;setBusy(false);}
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
  const newActionCard = "group flex h-[56px] w-[96px] items-center justify-center rounded-lg border border-[var(--gold)]/35 bg-white/[0.025] px-1.5 text-center transition hover:border-[var(--gold)]/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  const savedActionCard = "group relative mt-4 h-[79px] w-[101px] cursor-pointer border-0 bg-transparent p-0 text-center transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  return <div className={compact ? "grid justify-items-center gap-4" : "mb-4 flex flex-wrap gap-2"}>
    {hideActions ? null : compact ? <>
      <button type="button" onClick={start} className={newActionCard}><span className="flex flex-col items-start leading-none"><span className="text-[8px] font-light tracking-normal text-muted-foreground">{invoiceKind==="custom"?"Custom":"Purchase"}</span><span className="mt-1 font-head text-[11px] font-semibold tracking-normal text-white">INVOICE</span></span><span className={`${invoiceKind==="custom"?"order-first mr-1":"ml-1"} self-center text-[var(--gold)]`}><FilePenLine size={15} strokeWidth={1.25} /></span></button>
      <button type="button" onClick={()=>setMode("archive")} aria-label={invoiceKind==="custom"?"Open saved custom invoices":"Open saved purchase invoices"} className={savedActionCard}>
        <span aria-hidden="true" className="absolute inset-x-[3px] bottom-[5px] top-[13px] rounded-[8px] border border-[#b89754] bg-gradient-to-b from-[#806a3b] to-[#4a3820] shadow-[0_4px_10px_rgba(0,0,0,0.25)]" />
        <span aria-hidden="true" className="absolute left-[5px] top-[7px] h-[16px] w-[43px] rounded-t-[5px] border border-b-0 border-[#d1ae65] bg-[#806a3b]" />
        {archiveCount>0 && <span aria-hidden="true" className="absolute left-[20px] right-[17px] top-[14px] h-[34px] -rotate-[3deg] rounded-[3px] border border-slate-300 bg-white shadow-sm"><span className="absolute left-2 top-2 h-[2px] w-8 bg-slate-300"/><span className="absolute left-2 top-4 h-[2px] w-6 bg-slate-200"/><span className="absolute right-1 top-1 text-[7px] font-bold text-red-600">PDF</span></span>}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[30px] rounded-b-[9px] rounded-t-[5px] border border-[#d8b875] bg-gradient-to-b from-[#c5a45c] via-[#a58243] to-[#75552b] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_10px_rgba(0,0,0,0.18)]" />
        <span className="absolute inset-x-1 bottom-[9px] flex flex-col items-center leading-tight text-[#241b11]"><span className="font-head text-[10px] font-semibold">{invoiceKind==="custom"?"Saved Custom":"Saved"}</span><span className="font-head text-[11px] font-bold">Invoices</span></span>
      </button>
    </> : <><Btn onClick={start}>{invoiceKind==="custom"?"Custom Invoice":"Purchase Invoice"}</Btn><Btn variant="dark" onClick={()=>setMode("archive")}>Saved Invoices</Btn></>}
    <Modal open={mode==="auto"} onClose={()=>setMode("")} title="New Auto Parts Invoice" wide>
      {autoParts && <AutoPartsEditor value={autoParts} onChange={v=>{setAutoParts(v);requestId.current=crypto.randomUUID();}} company={settings} invoiceNumber={nextAutoNumber} busy={busy} onSave={saveAutoParts}/>}
    </Modal>
    <Modal open={mode==="manual"} onClose={()=>setMode("")} title={invoiceKind==="custom"?"New Custom Invoice":"New Purchase Invoice"} wide>
      <p className="my-2">To · {settings?.name} · {settings?.address} · {settings?.phone}</p>
      <form onSubmit={e=>{e.preventDefault();save();}} onChange={()=>{requestId.current=crypto.randomUUID();}}>
      {invoiceKind==="manual"&&<div className="my-3 space-y-2"><div className="flex gap-2"><button type="button" className="rounded border px-3 py-2" onClick={()=>setSellerPicker(v=>!v)}>Saved Seller / Address</button><button type="button" className="rounded border px-3 py-2" onClick={()=>{setSeller({name:""});setSellerSearch("");setSellerPicker(false);requestId.current=crypto.randomUUID();}}>New Seller</button></div>{sellerPicker&&<><Input placeholder="Search name, address or phone number" value={sellerSearch} onChange={e=>setSellerSearch(e.target.value)}/><div className="max-h-48 overflow-y-auto">{savedSellers.filter(p=>[p.name,p.address,p.phone].some(v=>String(v||"").normalize("NFKC").toLowerCase().includes(sellerSearch.normalize("NFKC").toLowerCase()))).map((p,i)=><button type="button" key={i} className="block w-full border-b p-2 text-left" onClick={()=>{setSeller({name:p.name,address:p.address,phone:p.phone,bank_details:p.bank_details,tax_id:p.tax_id});setSellerPicker(false);requestId.current=crypto.randomUUID();}}><b>{p.name}</b><div className="text-xs">{p.address} {p.phone}</div></button>)}</div></>}</div>}
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

function AutoPartsEditor({value,onChange,company,invoiceNumber,busy,onSave}) {
  const setLine=(type,index,key,val)=>onChange({...value,[type]:value[type].map((r,i)=>i===index?{...r,[key]:val}:r)});
  const sum=["engines","chassis","parts"].reduce((n,type)=>n+value[type].reduce((a,r)=>a+Number(r.price||0),0),0);
  const inputClass="w-full min-w-0 border-0 bg-transparent px-1 py-1 text-[11px] text-white outline-none focus:bg-white/10";
  function list(title,type,start,count) {
    const rows=value[type];
    return <div className="mt-4" key={title}>
      <h3 className="mb-1 text-center font-head text-sm font-bold text-white">{title}</h3>
      <div className="w-full overflow-x-auto"><table className="w-full min-w-[540px] table-fixed border-collapse border border-slate-400/70 text-left" dir="ltr">
        <colgroup><col style={{width:"6%"}}/><col style={{width:"28%"}}/><col style={{width:"16%"}}/><col style={{width:"6%"}}/><col style={{width:"28%"}}/><col style={{width:"16%"}}/></colgroup>
        <thead><tr>{["No.","Engine / Chassis / Part Number","Price (JPY)","No.","Engine / Chassis / Part Number","Price (JPY)"].map((t,i)=><th key={i} className="border border-slate-400/70 bg-white/10 px-1 py-1 text-[9px] font-semibold text-white">{t}</th>)}</tr></thead>
        <tbody>{Array.from({length:count},(_,i)=><tr key={i}>{[0,1].map(side=>{const idx=start+i+side*count;return <React.Fragment key={side}><td className="border border-slate-400/70 text-center text-[10px]">{idx+1}</td><td className="border border-slate-400/70">{type==="parts" ? <SparePartNameInput ariaLabel={"Parts name "+(idx+1)} value={rows[idx]?.number||""} onChange={v=>setLine(type,idx,"number",v)} className={inputClass}/> : <input aria-label={title+" number "+(idx+1)} className={inputClass} value={rows[idx]?.number||""} maxLength={80} onChange={e=>setLine(type,idx,"number",e.target.value)}/>}</td><td className="border border-slate-400/70"><input aria-label={title+" price "+(idx+1)} type="number" min="0" step="1" className={inputClass} value={rows[idx]?.price??""} onChange={e=>setLine(type,idx,"price",e.target.value)}/></td></React.Fragment>})}</tr>)}</tbody>
      </table></div>
    </div>;
  }
  return <div dir="ltr" className="text-left">
    <div className="relative flex flex-wrap items-start justify-between gap-3 border-b border-[var(--gold)]/50 pb-3">
      <div><h2 className="font-head text-lg font-bold text-white">{company?.name||"MADINA TRADING"}</h2><p className="max-w-xs whitespace-pre-line text-xs text-muted-foreground">{company?.address||"Company address from Settings"}</p></div>
      <div className="flex flex-col items-end gap-2"><label className="text-xs text-white">Loading Date <input type="date" className="mt-1 block rounded border border-border bg-background p-2 text-white" value={value.loading_date} onChange={e=>onChange({...value,loading_date:e.target.value})}/></label></div>
      <div className="absolute right-0 top-0 -translate-y-full pb-1 text-right text-[10px] leading-tight text-muted-foreground">Invoice No. <span className="font-head text-xs font-semibold text-white">{invoiceNumber||"Assigned on save"}</span></div>
    </div>
    <div className="mt-2 text-right text-sm font-bold text-white">Grand Total: {money(sum)}</div>
    {Array.from({length:value.engines.length/60},(_,page)=>list("ENGINE LIST — Sheet "+(page+1),"engines",page*60,30))}
    <button type="button" className="mt-3 rounded border border-[var(--gold)]/60 px-3 py-2 text-xs text-white" onClick={()=>onChange({...value,engines:[...value.engines,...Array.from({length:60},()=>({number:"",price:""}))]})}><Plus size={13} className="mr-1 inline"/>New Engine Sheet</button>
    <p className="mt-3 text-xs text-muted-foreground">The following lists print on a separate PDF page.</p>
    {list("CHASSIS LIST","chassis",0,6)}
    {list("PARTS LIST","parts",0,20)}
    <button type="button" disabled={busy} onClick={onSave} className="gold-gradient mt-5 rounded px-4 py-2 font-semibold text-black disabled:opacity-50">{busy?"Saving...":"Confirm & Save PDF"}</button>
  </div>;
}

function SparePartNameInput({value,onChange,className,ariaLabel}) {
  const [focused,setFocused]=useState(false);
  const [active,setActive]=useState(0);
  const query=value.trim().toLowerCase();
  const matches=query ? AUTO_PART_NAMES.filter(name=>name.toLowerCase().startsWith(query)).slice(0,12) : [];
  const show=focused && matches.length>0 && !matches.some(name=>name.toLowerCase()===query);
  const choose=(name)=>{onChange(name);setFocused(false);setActive(0);};
  return <div className="relative min-w-0">
    <input aria-label={ariaLabel} aria-autocomplete="list" autoComplete="off" className={className} value={value} maxLength={80}
      placeholder="Type part name" onFocus={()=>{setFocused(true);setActive(0);}}
      onBlur={()=>setFocused(false)} onChange={e=>{onChange(e.target.value);setActive(0);}}
      onKeyDown={e=>{
        if(!show)return;
        if(e.key==="ArrowDown"){e.preventDefault();setActive(i=>(i+1)%matches.length);}
        else if(e.key==="ArrowUp"){e.preventDefault();setActive(i=>(i+matches.length-1)%matches.length);}
        else if(e.key==="Enter"){e.preventDefault();choose(matches[active]);}
        else if(e.key==="Escape"){setFocused(false);}
      }}/>
    {show && <div role="listbox" aria-label="Spare part suggestions" className="absolute left-0 top-full z-50 max-h-44 min-w-[180px] w-max max-w-[min(85vw,300px)] overflow-y-auto rounded-md border border-[var(--gold)]/60 bg-[#172b25] p-1 shadow-xl">
      {matches.map((name,i)=><button key={name} type="button" role="option" aria-selected={i===active}
        onMouseDown={e=>e.preventDefault()} onClick={()=>choose(name)}
        className={`block w-full rounded px-2 py-2 text-left text-xs text-white ${i===active?"bg-[var(--gold)]/25":"hover:bg-white/10"}`}>{name}</button>)}
    </div>}
  </div>;
}

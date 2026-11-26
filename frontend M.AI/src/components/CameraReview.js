import React, { useEffect, useRef, useState } from "react";
import { Camera, X, ScanLine, Trash2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

// Image bytes are passed only to the browser OCR worker and never sent to the API.
// OCR models are loaded from the public Tesseract distribution. No paid OCR API key.
const fields = ["vehicle_name", "model", "chassis_number", "mileage", "color", "engine_number"];
const today = () => new Date().toLocaleDateString("en-CA");
const blankVehicle = () => ({ vehicle_name:"",model:"",chassis_number:"",mileage:"",color:"",engine_number:"",purchase_date:today(),purchase_price:"",paid_amount:"",payment_method:"",supplier:"",purchase_company:"MTC" });
const number = value => Number(String(value || "").replace(/[,¥￥\s]/g,"")) || 0;
const normalize = s => String(s || "").replace(/[：:]/g,":").trim();
const after = (line, pattern) => {
 const m = normalize(line).match(pattern);
 return m ? (m[1] || "").trim().replace(/^[：:\s]+/,"") : "";
};
function parseVehicle(text) {
 const lines = text.split(/\n/).map(normalize).filter(Boolean);
 const pick = regex => lines.map(line => after(line,regex)).find(Boolean) || "";
 const result = blankVehicle();
 result.chassis_number = pick(/(?:車台番号|車体番号|chassis\s*(?:no|number)?)[\s:]*([A-Z0-9]{2,12}[-ー－][A-Z0-9]{4,14})/i) ||
   ((text.toUpperCase().match(/\b[A-Z0-9]{2,12}[-ー－][A-Z0-9]{5,14}\b/) || [])[0] || "");
 result.model = pick(/(?:型式|model\s*(?:code)?)[\s:]*([A-Z0-9-]{3,24})/i);
 result.vehicle_name = pick(/(?:車名|vehicle\s*name|make)[\s:]*([^\s:]{2,28})/i);
 const km = pick(/(?:走行距離|走行|mileage)[\s:]*([\d,，]{2,10})\s*(?:km|㎞|キロ)?/i);
 result.mileage = km.replace(/[^\d]/g,"");
 result.color = pick(/(?:車体の色|車体色|色|color)[\s:]*([^\s:]{2,20})/i);
 result.engine_number = pick(/(?:原動機番号|エンジン番号|engine\s*(?:no|number))[\s:]*([A-Z0-9-]{3,25})/i);
 return result;
}
function parseParts(text) {
 const lines = text.split(/\n/).map(normalize).filter(Boolean);
 const company = lines.map(x=>after(x,/(?:会社名|販売元|仕入先|supplier|company)[\s:]*([^\s:][^\n]{1,60})/i)).find(Boolean) || "";
 const dateMatch = text.match(/\b(20\d\d)[\/年.\-]\s*(\d{1,2})[\/月.\-]\s*(\d{1,2})日?\b/);
 const date = dateMatch ? [dateMatch[1],dateMatch[2].padStart(2,"0"),dateMatch[3].padStart(2,"0")].join("-") : today();
 const items = lines.filter(x=> !/(合計|小計|消費税|税抜|税込|total|電話|住所)/i.test(x)).map(line=>{
  const m = line.match(/^(.{2,90}?)\s+(\d{1,5})\s+(?:[¥￥]\s*)?([\d,]{2,12})(?:\s|円|$)/);
  if(!m) return null;
  return {name:m[1].trim(),quantity:m[2],unit_cost:m[3].replace(/,/g,""),part_type:/(engine|エンジン|原動機)/i.test(m[1])?"engine":"parts"};
 }).filter(Boolean);
 return {company,date,items};
}
const Input = ({label,value,onChange,type="text",required=false}) => <label className="block text-xs text-gray-200">{label}<input type={type} required={required} value={value ?? ""} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-black/30 p-2 text-sm text-white" /></label>;
export default function CameraReview({onClose}) {
 const { can } = useAuth();
 const [kind,setKind] = useState("");
 const [busy,setBusy] = useState(false);
 const [ready,setReady] = useState(false);
 const [error,setError] = useState("");
 const [vehicle,setVehicle] = useState(blankVehicle);
 const [parts,setParts] = useState({company:"",date:today(),items:[]});
 const [target,setTarget] = useState("broker");
 const [brokers,setBrokers] = useState([]);
 const [brokerId,setBrokerId] = useState("");
 const [saving,setSaving] = useState(false);
 const inputRef = useRef(null);
 const runRef = useRef(0);
 const workerRef = useRef(null);
 useEffect(()=>()=>{runRef.current++;workerRef.current?.terminate?.().catch(()=>{});},[]);
 const close = () => {if(saving)return;runRef.current++;workerRef.current?.terminate?.().catch(()=>{});onClose();};
 const updateVehicle = (key,value) => setVehicle(v=>({...v,[key]:value}));
 const updateItem = (i,key,value) => setParts(p=>({...p,items:p.items.map((x,j)=>i===j?{...x,[key]:value}:x)}));
 const scan = async e => {
  const file=e.target.files?.[0];e.target.value="";
  if(!file)return;
  if(!file.type.startsWith("image/")){setError("Choose an image.");return;}
  if(file.size>15*1024*1024){setError("Image is too large (15MB maximum).");return;}
  const id=++runRef.current;setError("");setReady(false);setBusy(true);
  try {
   const {createWorker}=await import("tesseract.js");
   const worker=await createWorker("jpn+eng",1);
   workerRef.current=worker;
   const {data}=await worker.recognize(file);
   await worker.terminate();workerRef.current=null;
   if(id!==runRef.current)return;
   const recognized=String(data?.text||"");
   if(kind==="vehicle"){setVehicle(parseVehicle(recognized));}
   else {setParts(parseParts(recognized));}
   setReady(true);
   if(!recognized.trim())setError("No readable text found. Fill in details manually or scan again.");
  } catch(err){if(id===runRef.current)setError("Scanner unavailable. Check your internet connection and try again.");}
  finally {if(id===runRef.current)setBusy(false);}
 };
 const choose = async value => {
  setKind(value);setReady(false);setError("");
  if(value==="vehicle"&&can("finance.view")){
   try{const {data}=await api.get("/brokers");setBrokers(data||[]);}catch{setError("Broker list could not be loaded.");}
  }
 };
 const saveVehicle = async () => {
  if(!vehicle.chassis_number.trim()){setError("Enter chassis number before saving.");return;}
  if(!vehicle.vehicle_name.trim()){setError("Enter vehicle name before saving.");return;}
  if(target==="broker"&&!brokerId){setError("Select a registered broker.");return;}
  if(target==="broker"&&!can("finance.edit")){setError("Broker editing permission required.");return;}
  if(target==="direct"&&!can("vehicles.edit")){setError("Vehicle editing permission required.");return;}
  if(target==="direct"&&(!vehicle.supplier.trim()||!vehicle.payment_method)){setError("Enter seller and Cash/Bank payment method.");return;}
  setError("");setSaving(true);
  try {
   if(target==="broker")await api.post("/brokers/"+encodeURIComponent(brokerId)+"/vehicles",{
    purchase_date:vehicle.purchase_date,vehicle_name:vehicle.vehicle_name,model:vehicle.model,chassis_number:vehicle.chassis_number,
    mileage:vehicle.mileage?number(vehicle.mileage):null,color:vehicle.color,engine_number:vehicle.engine_number,
    purchase_price:number(vehicle.purchase_price),paid_amount:number(vehicle.paid_amount),
    payment_method:number(vehicle.paid_amount)>0?vehicle.payment_method||"cash":null
   });
   else await api.post("/vehicles",{
    ...vehicle,mileage:vehicle.mileage?number(vehicle.mileage):null,purchase_price:number(vehicle.purchase_price),
    payment_method:vehicle.payment_method
   });
   toast.success("Vehicle record saved");onClose();
  }catch(e){setError(apiError(e));}finally{setSaving(false);}
 };
 const saveParts = async () => {
  const valid=parts.items.filter(x=>x.name.trim()&&number(x.quantity)>0);
  if(!can("parts.edit")){setError("Parts editing permission required.");return;}
  if(!valid.length){setError("Add at least one part/engine with quantity.");return;}
  setSaving(true);setError("");
  try{
   for(const x of valid){
    if(x.part_type==="engine"){
     await api.post("/tracked-parts",{date:parts.date,part_type:"engine",name:x.name,supplier:parts.company,
      purchase_price:number(x.unit_cost)*number(x.quantity),payment_method:"bank",purchase_company:"MTC"});
    }else{
     await api.post("/parts",{name:x.name,quantity:number(x.quantity),unit_cost:number(x.unit_cost),
      supplier:parts.company,purchase_date:parts.date,purchase_company:"MTC",payment_method:"bank"});
    }
   }
   toast.success("Scanned items saved");onClose();
  }catch(e){setError("Some items may already be saved. Check Parts before retrying. "+apiError(e));}finally{setSaving(false);}
 };
 return <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/90 p-3 text-white">
  <div className="mx-auto w-full max-w-xl rounded-xl border border-yellow-500/30 bg-[#19191c] p-4">
   <div className="flex items-center justify-between gap-2"><b className="flex items-center gap-2"><ScanLine size={18}/> Mobile Document Scanner</b><button onClick={close} aria-label="Close scanner"><X/></button></div>
   <p className="my-2 text-xs text-gray-300">Free Japanese/English OCR in your browser. The image is not uploaded or stored. Review text before Save.</p>
   {!kind?<div className="mt-4 grid grid-cols-2 gap-2">
     <button className="rounded border border-white/20 p-4 text-sm" onClick={()=>choose("vehicle")}><Camera className="mx-auto mb-2"/> Vehicle Document</button>
     <button className="rounded border border-white/20 p-4 text-sm" onClick={()=>choose("parts")}><ScanLine className="mx-auto mb-2"/> Spare Parts List</button>
   </div>:<>
    <div className="mt-3 flex items-center justify-between gap-2"><b>{kind==="vehicle"?"Vehicle Document":"Spare Parts List"}</b><button className="text-xs text-yellow-400" onClick={()=>{runRef.current++;setKind("");setReady(false);}}>Change type</button></div>
    <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={scan} className="sr-only" aria-label="Capture document"/>
    <button disabled={busy||saving} className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-yellow-500 px-3 py-3 font-semibold text-black disabled:opacity-50" onClick={()=>inputRef.current?.click()}><Camera size={18}/>{busy?"Scanning…":"Open Camera / Scan Image"}</button>
    {busy&&<p role="status" className="mt-2 text-sm">Recognizing Japanese / English text on this device…</p>}
    {ready&&kind==="vehicle"&&<div className="mt-4 grid grid-cols-2 gap-3">
      {fields.map(key=><Input key={key} label={{vehicle_name:"Vehicle Name",model:"Model",chassis_number:"Chassis Number",mileage:"Mileage (km)",color:"Color",engine_number:"Engine Number"}[key]} value={vehicle[key]} onChange={v=>updateVehicle(key,v)} />)}
      <Input label="Purchase Date" type="date" value={vehicle.purchase_date} onChange={v=>updateVehicle("purchase_date",v)}/>
      <Input label="Price (¥)" type="number" value={vehicle.purchase_price} onChange={v=>updateVehicle("purchase_price",v)}/>
      <div className="col-span-2 flex gap-2">
       <button className={"flex-1 rounded p-2 "+(target==="broker"?"bg-yellow-500 text-black":"border border-white/20")} onClick={()=>setTarget("broker")}>Vehicle Broker</button>
       <button className={"flex-1 rounded p-2 "+(target==="direct"?"bg-yellow-500 text-black":"border border-white/20")} onClick={()=>setTarget("direct")}>Direct Vehicle</button>
      </div>
      {target==="broker"?<>
       <label className="col-span-2 text-xs">Registered Broker<select value={brokerId} onChange={e=>setBrokerId(e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#19191c] p-2 text-sm"><option value="">Select Broker</option>{brokers.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
       <Input label="Paid Amount (¥)" type="number" value={vehicle.paid_amount} onChange={v=>updateVehicle("paid_amount",v)}/>
       <label className="text-xs">Payment Status<div className="mt-1 rounded border border-white/20 p-2">{number(vehicle.paid_amount)>0?"Paid / Partly Paid":"Unpaid"}</div></label>
       {number(vehicle.paid_amount)>0&&<label className="col-span-2 text-xs">Payment Method<select value={vehicle.payment_method} onChange={e=>updateVehicle("payment_method",e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#19191c] p-2"><option value="">Select</option><option value="cash">Cash</option><option value="bank">Bank</option></select></label>}
      </>:<>
       <div className="col-span-2"><Input label="Seller Name" value={vehicle.supplier} onChange={v=>updateVehicle("supplier",v)}/></div>
       <label className="col-span-2 text-xs">Payment Method<select value={vehicle.payment_method} onChange={e=>updateVehicle("payment_method",e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#19191c] p-2"><option value="">Select</option><option value="cash">Cash</option><option value="bank">Bank</option></select></label>
      </>}
    </div>}
    {ready&&kind==="parts"&&<div className="mt-4 space-y-3">
     <Input label="Company / Supplier" value={parts.company} onChange={v=>setParts(p=>({...p,company:v}))}/>
     <Input label="Date" type="date" value={parts.date} onChange={v=>setParts(p=>({...p,date:v}))}/>
     {parts.items.map((item,i)=><div key={i} className="rounded border border-white/20 p-2">
      <div className="grid grid-cols-2 gap-2">
       <div className="col-span-2"><Input label="Item Name" value={item.name} onChange={v=>updateItem(i,"name",v)}/></div>
       <Input label="Quantity" type="number" value={item.quantity} onChange={v=>updateItem(i,"quantity",v)}/>
       <Input label="Unit Price (¥)" type="number" value={item.unit_cost} onChange={v=>updateItem(i,"unit_cost",v)}/>
       <label className="col-span-2 text-xs">Item Type<select value={item.part_type} onChange={e=>updateItem(i,"part_type",e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#19191c] p-2"><option value="parts">Parts</option><option value="engine">Engine</option></select></label>
      </div><button className="mt-2 flex items-center gap-1 text-xs text-red-300" onClick={()=>setParts(p=>({...p,items:p.items.filter((_,j)=>j!==i)}))}><Trash2 size={13}/> Remove</button>
     </div>)}
     <button className="rounded border border-white/20 p-2 text-xs" onClick={()=>setParts(p=>({...p,items:[...p.items,{name:"",quantity:"1",unit_cost:"",part_type:"parts"}]}))}>+ Add Item</button>
    </div>}
    {ready&&<button disabled={saving} onClick={kind==="vehicle"?saveVehicle:saveParts} className="mt-4 w-full rounded bg-emerald-700 p-3 font-semibold disabled:opacity-40">{saving?"Saving…":"Confirm & Save Record"}</button>}
   </>}
   {error&&<p role="alert" className="mt-3 rounded border border-red-500/30 p-2 text-sm text-red-300">{error}</p>}
  </div>
 </div>;
}

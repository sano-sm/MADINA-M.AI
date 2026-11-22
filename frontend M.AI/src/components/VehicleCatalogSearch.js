import React, { useState } from "react";
import { Search, X, Images } from "lucide-react";
import { api, apiError } from "@/lib/api";

export default function VehicleCatalogSearch({ onClose }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const search = async (e) => {
    e.preventDefault(); if (query.trim().length < 2) return;
    setBusy(true); setError(""); setDone(false);
    try { const res = await api.get("/vehicle-catalog/search", {params:{q:query.trim()}}); setRows(res.data); setDone(true); }
    catch(e) { setError(apiError(e)); setRows([]); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Vehicle model lookup">
    <div className="mx-auto max-w-lg rounded-3xl border border-white/20 bg-[var(--surface-2)] p-4 text-white shadow-2xl">
      <div className="mb-4 flex items-center justify-between"><b>MADINA MAI — Model Search</b><button type="button" aria-label="Close" onClick={onClose}><X size={20}/></button></div>
      <form onSubmit={search} className="mb-3 flex gap-2"><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="NZE121 / PC200-7" className="min-w-0 flex-1 rounded-full border border-white/20 bg-black/20 px-4 py-2 text-white"/><button type="submit" disabled={busy || query.trim().length<2} className="rounded-full bg-white px-4 py-2 text-black" aria-label="Search model"><Search size={20}/></button></form>
      <p className="mb-3 text-xs text-gray-400">Reference only — no vehicle entry or invoice will be created.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {done && !rows.length && <p>No matching model in uploaded catalog.</p>}
      {rows.map((r,i)=><div key={`${r.make}-${r.model_code}-${i}`} className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 text-lg font-bold">{r.make} {r.vehicle_name}</h3>
        {[['Category','Vehicle'],['Make',r.make],['Vehicle Name',r.vehicle_name],['Model Code',r.model_code],['Engine Code',r.engine_code],['Verification',r.verification_status]].map(([label,value])=><div key={label} className="flex justify-between gap-3 border-b border-white/10 py-2 text-sm"><span className="text-gray-400">{label}</span><span className="text-right">{value || '—'}</span></div>)}
        <a className="mt-3 flex items-center justify-center gap-2 rounded-full border border-white/30 px-3 py-2" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent([r.make,r.vehicle_name,r.model_code].filter(Boolean).join(' '))}`}><Images size={17}/>View Photos on Google</a>
      </div>)}
    </div>
  </div>;
}

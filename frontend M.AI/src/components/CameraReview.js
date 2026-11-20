import React, { useEffect, useState } from 'react';
import { Camera, X, Trash2 } from 'lucide-react';
// Privacy-first image preview: no uploads, database writes or persistence.
// Automatic OCR intentionally not claimed: provider must be explicitly integrated.
export default function CameraReview({onClose}) {
 const [url,setUrl]=useState(null);
 const [details,setDetails]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);
 const clear=()=>{if(url)URL.revokeObjectURL(url);setUrl(null);setDetails('');setConfirmed(false)};
 const pick=e=>{clear();const file=e.target.files?.[0];if(file&&file.type.startsWith('image/'))setUrl(URL.createObjectURL(file));e.target.value=''};
 return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={()=>{clear();onClose()}}>
  <div className="w-full max-w-lg rounded-xl border border-yellow-500/30 bg-[#19191c] p-4 text-white" onClick={e=>e.stopPropagation()}>
   <div className="flex justify-between"><b className="flex gap-2"><Camera size={18}/> Camera — Private Review</b><button onClick={()=>{clear();onClose()}} aria-label="Close"><X/></button></div>
   <p className="my-3 text-xs text-gray-300">Image stays in this browser preview. No automatic text extraction or record saving is connected yet. Review and manually copy details; closing clears the image.</p>
   <input aria-label="Select image" type="file" accept="image/*" capture="environment" onChange={pick} className="w-full text-sm"/>
   {url&&<img src={url} alt="Temporary document preview" className="mt-3 max-h-60 w-full object-contain"/>}
   <textarea className="mt-3 min-h-20 w-full rounded bg-black/30 p-2" placeholder="Review or type the extracted details here (not saved)" value={details} onChange={e=>setDetails(e.target.value)}/>
   <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I checked the details (OK)</label>
   <button type="button" disabled={!confirmed} onClick={()=>{clear();onClose()}} className="mt-3 flex items-center gap-2 rounded bg-yellow-500 px-3 py-2 text-black disabled:opacity-40"><Trash2 size={15}/> OK — Clear temporary image</button>
  </div>
 </div>
}

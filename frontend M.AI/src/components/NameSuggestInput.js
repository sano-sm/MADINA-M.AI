import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/kit";

// Read-only suggestions sourced from existing saved records. Selecting a suggestion
// copies only its spelling, not an entity ID. No changes to payments or accounting.
const SOURCES = {
  vehicle: [{ path: "/vehicles", field: "vehicle_name" }, { path: "/broker-vehicles/pending", field: "vehicle_name" }],
  make: [{ path: "/vehicles", field: "make" }],
  model: [{ path: "/vehicles", field: "model" }],
  engine: [{ path: "/vehicles", field: "engine_name" }],
  supplier: [{ path: "/vehicles", field: "supplier" }, { path: "/brokers", field: "name" }],
  broker: [{ path: "/brokers", field: "name" }],
  customer: [{ path: "/customers", field: "name" }],
};

export default function NameSuggestInput({ kind, value, onChange, ...props }) {
  const [saved, setSaved] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const specs = SOURCES[kind] || [];
    Promise.all(specs.map(async ({ path, field }) => {
      try {
        const response = await api.get(path);
        return (Array.isArray(response.data) ? response.data : []).map((row) => row?.[field]).filter((v) => typeof v === "string" && v.trim());
      } catch { return []; } // Optional suggestions must never block data entry.
    })).then((groups) => {
      if (!alive) return;
      const names = new Map();
      groups.flat().forEach((v) => { const clean = v.trim(); const key = clean.toLocaleLowerCase(); if (!names.has(key)) names.set(key, clean); });
      setSaved([...names.values()].sort((a, b) => a.localeCompare(b)));
    });
    return () => { alive = false; };
  }, [kind]);
  const needle = String(value || "").trim().toLocaleLowerCase();
  const options = useMemo(() => needle ? saved.filter((n) => n.toLocaleLowerCase().includes(needle) && n.toLocaleLowerCase() !== needle).slice(0, 8) : [], [saved, needle]);
  const choose = (name) => { onChange({ target: { value: name } }); setOpen(false); };
  return (
    <span className="relative block w-full">
      <Input {...props} value={value ?? ""} autoComplete="off" onChange={onChange}
        onFocus={(e) => { setOpen(true); props.onFocus?.(e); }}
        onBlur={(e) => { setOpen(false); props.onBlur?.(e); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); props.onKeyDown?.(e); }} />
      {open && options.length > 0 && (
        <span role="listbox" aria-label="Previously saved names" className="absolute left-0 right-0 top-full z-[80] mt-1 block max-h-52 overflow-y-auto rounded-sm border border-border bg-[var(--surface-2)] shadow-xl">
          {options.map((name) => (
            <button type="button" role="option" aria-selected="false" key={name}
              onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(name)}
              className="block w-full border-b border-border/50 px-3 py-2 text-start text-sm text-white hover:bg-white/10 focus:bg-white/10">
              {name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

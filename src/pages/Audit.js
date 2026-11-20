import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { PageHeader, Empty, Badge } from "@/components/kit";

export default function Audit() {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get("/audit").then((r) => setRows(r.data)).catch(() => {}); }, []);
  const tone = { create: "green", update: "gold", delete: "red", dismantle: "gold" };
  return (
    <div>
      <PageHeader title={t("audit")} />
      <div className="card-surface overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-[var(--surface-2)] text-xs uppercase text-muted-foreground">
            <tr>{["Action", "Entity", "Details", "User", "Time"].map((h) => <th key={h} className="p-3 text-start font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b border-border hover:bg-white/5">
              <td className="p-3"><Badge tone={tone[r.action] || "gray"}>{r.action}</Badge></td>
              <td className="p-3">{r.entity}</td>
              <td className="p-3 text-muted-foreground">{r.details}</td>
              <td className="p-3">{r.user_name}</td>
              <td className="p-3 text-xs text-muted-foreground">{r.timestamp.slice(0, 16).replace("T", " ")}</td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <Empty text={t("no_data")} />}
      </div>
    </div>
  );
}

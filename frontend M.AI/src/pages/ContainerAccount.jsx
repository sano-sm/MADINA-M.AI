import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Save, Trash2, X, RefreshCw } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import "./ContainerAccount.css";

// This ledger uses ONLY /container-account, never existing invoice, TT or business APIs.
const blank = () => ({
  date: "", company: "MTC", destination: "UAE", container_no: "",
  invoice_no: "", container_amount: "", received_amount: "", tt_date: "", surrender_date: ""
});
const formatYen = (n) => "¥" + Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0,
  maximumFractionDigits: 2
});
const asAmount = (s) => Number(s || 0);
const netOf = (r) => Math.round((asAmount(r.container_amount) - asAmount(r.received_amount)) * 100) / 100;

const headings = [
  "Date", "Company", "Destination", "Container No.", "Invoice No.",
  "Container Amount", "TT Amount", "TT Date", "Balance Due / Overpaid", "Surrender Date"
];
const fieldNames = [
  "date", "company", "destination", "container_no", "invoice_no",
  "container_amount", "received_amount", "tt_date", "balance", "surrender_date"
];

function EditCell({ field, record, onChange }) {
  if (field === "balance") {
    const diff = netOf(record);
    return <span className={diff < 0 ? "ca-red" : "ca-blue"}>{formatYen(Math.abs(diff))}</span>;
  }
  if (field === "company") {
    return <select aria-label="Company" value={record.company} onChange={(e) => onChange(field, e.target.value)}>
      <option value="MTC">MTC</option><option value="TSK">TSK</option>
    </select>;
  }
  if (field === "destination") {
    return <select aria-label="Destination" value={record.destination} onChange={(e) => onChange(field, e.target.value)}>
      <option value="UAE">UAE</option><option value="Pakistan">Pakistan</option>
    </select>;
  }
  const monetary = field === "container_amount" || field === "received_amount";
  const dateField = field === "date" || field === "surrender_date" || field === "tt_date";
  return <input
    aria-label={headings[fieldNames.indexOf(field)]}
    type={monetary ? "number" : dateField ? "date" : "text"}
    min={monetary ? "0" : undefined}
    step={monetary ? "0.01" : undefined}
    maxLength={monetary || dateField ? undefined : 100}
    value={record[field] == null ? "" : record[field]}
    onChange={(e) => onChange(field, e.target.value)}
    placeholder={monetary ? "0" : field === "container_no" ? "Container No." : ""}
  />;
}

function DataRow({ record, editable, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...record }));
  const [busy, setBusy] = useState(false);
  const diff = netOf(record);
  const startEdit = () => { setDraft({ ...record }); setEditing(true); };
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async () => {
    if (!draft.container_no.trim()) return toast.error("Container number is required");
    setBusy(true);
    try { await onSave(record.id, draft); setEditing(false); }
    finally { setBusy(false); }
  };
  return <tr data-testid={"ca-entry-" + record.id}>
    {fieldNames.map((field) => <td key={field} className={field === "container_amount" || field === "received_amount" ? "ca-money-cell" : ""}>
      {editing ? <EditCell field={field} record={draft} onChange={update} /> :
        field === "balance" ?
          <strong className={diff < 0 ? "ca-red" : "ca-blue"}>
            {diff < 0 ? "Overpaid " : ""}{formatYen(Math.abs(diff))}
          </strong> :
        field === "container_amount" || field === "received_amount" ? formatYen(record[field]) :
        record[field] || "—"}
    </td>)}
    <td className="ca-actions">
      {editable && (editing ?
        <div className="ca-action-buttons">
          <button type="button" title="Save" disabled={busy} onClick={save}><Save size={16} /></button>
          <button type="button" title="Cancel" disabled={busy} onClick={() => setEditing(false)}><X size={16} /></button>
        </div> :
        <div className="ca-action-buttons">
          <button type="button" title="Edit" onClick={startEdit}><Pencil size={16} /></button>
          <button type="button" title="Delete" onClick={() => onDelete(record)}><Trash2 size={16} /></button>
        </div>)}
    </td>
  </tr>;
}

export default function ContainerAccount() {
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [data, setData] = useState({ sheets: [], rows: [], summary: null });
  const [activeSheet, setActiveSheet] = useState("");
  const [newRow, setNewRow] = useState(blank);
  const [showEntry, setShowEntry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (first = false) => {
    try {
      const response = await api.get("/container-account");
      const result = response.data;
      setData(result);
      setActiveSheet((previous) => result.sheets.some((s) => s.id === previous)
        ? previous : (result.sheets[0]?.id || ""));
    } catch (error) {
      toast.error(apiError(error));
    } finally { if (first) setLoading(false); }
  }, []);

  useEffect(() => { load(true); }, [load]);

  const summary = data.summary || {
    containers: { "MTC UAE": 0, "TSK UAE": 0, "PAK": 0 },
    container_total: 0, received_total: 0,
    balance_label: "Balance Due", balance_amount: 0, is_overpaid: false
  };
  const entries = useMemo(() => data.rows.filter((item) => item.sheet_id === activeSheet),
    [data.rows, activeSheet]);
  const active = data.sheets.find((sheet) => sheet.id === activeSheet);
  const updateNew = (field, value) => setNewRow((previous) => ({ ...previous, [field]: value }));

  const addSheet = async () => {
    setBusy(true);
    try {
      const response = await api.post("/container-account/sheets");
      await load();
      setActiveSheet(response.data.id);
      setNewRow(blank());
      setShowEntry(false);
      toast.success(response.data.name + " created");
    } catch (error) { toast.error(apiError(error)); }
    finally { setBusy(false); }
  };

  const saveRow = async (rowId, record) => {
    const payload = {
      ...record,
      container_amount: asAmount(record.container_amount),
      received_amount: asAmount(record.received_amount)
    };
    try {
      await api.put("/container-account/rows/" + encodeURIComponent(rowId), payload);
      await load();
      toast.success("Entry updated");
    } catch (error) {
      toast.error(apiError(error));
      throw error;
    }
  };

  const removeRow = async (record) => {
    if (!window.confirm("Delete container " + record.container_no + "?")) return;
    try {
      await api.delete("/container-account/rows/" + encodeURIComponent(record.id));
      await load();
      toast.success("Entry deleted");
    } catch (error) { toast.error(apiError(error)); }
  };

  const addRow = async () => {
    if (!newRow.container_no.trim()) return toast.error("Enter container number");
    if (!Number.isFinite(asAmount(newRow.container_amount)) ||
        !Number.isFinite(asAmount(newRow.received_amount)) ||
        asAmount(newRow.container_amount) < 0 || asAmount(newRow.received_amount) < 0)
      return toast.error("Enter valid non-negative amounts");
    setBusy(true);
    try {
      await api.post("/container-account/sheets/" + encodeURIComponent(activeSheet) + "/rows", {
        ...newRow,
        container_amount: asAmount(newRow.container_amount),
        received_amount: asAmount(newRow.received_amount)
      });
      setNewRow(blank());
      setShowEntry(false);
      await load();
      toast.success("Container saved");
    } catch (error) { toast.error(apiError(error)); }
    finally { setBusy(false); }
  };

  const deleteSheet = async () => {
    if (!active || active.number === 1 || entries.length) return;
    if (!window.confirm("Delete empty " + active.name + "?")) return;
    try {
      await api.delete("/container-account/sheets/" + encodeURIComponent(activeSheet));
      setActiveSheet("");
      await load();
    } catch (error) { toast.error(apiError(error)); }
  };

  return <section className="ca-account" data-testid="container-account">
    <div className="ca-brand">
      <strong>Madina MAI</strong>
      <span>CONTAINER ACCOUNT</span>
    </div>
    <div className="ca-body">
      <div className="ca-heading">
        <h2>Container &amp; Received Amount</h2>
        <p>MTC + TSK <span> | </span> All destinations <span> | </span> All sheets combined</p>
      </div>
      <div className="ca-totals">
        <div className="ca-metric ca-counts">
          <div className="ca-metric-label">CONTAINERS</div>
          <div className="ca-count-grid">
            {["MTC UAE", "TSK UAE", "PAK"].map((key) =>
              <div key={key}><span>{key}</span><strong>{summary.containers[key] || 0}</strong></div>)}
          </div>
        </div>
        <div className="ca-metric ca-amount">
          <div className="ca-metric-label">CONTAINER TOTAL</div>
          <strong>{formatYen(summary.container_total)}</strong>
        </div>
        <div className="ca-metric ca-amount">
          <div className="ca-metric-label">RECEIVED AMOUNT TT</div>
          <strong>{formatYen(summary.received_total)}</strong>
        </div>
        <div className="ca-metric ca-amount">
          <div className="ca-metric-label">{summary.is_overpaid ? "OVERPAID" : "BALANCE DUE"}</div>
          <strong className={summary.is_overpaid ? "ca-red" : "ca-blue"}>
            {formatYen(summary.balance_amount)}
          </strong>
        </div>
      </div>

      <div className="ca-toolbar">
        <label htmlFor="ca-sheets">Sheet</label>
        <select id="ca-sheets" aria-label="Select sheet" value={activeSheet}
          onChange={(e) => { setActiveSheet(e.target.value); setShowEntry(false); setNewRow(blank()); }}>
          {data.sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {editable && <button type="button" onClick={addSheet} disabled={busy} className="ca-btn">
          <Plus size={15} /> New Sheet
        </button>}
        {editable && <button type="button" onClick={() => setShowEntry(true)}
          disabled={!activeSheet || busy} className="ca-btn ca-btn-primary">
          <Plus size={15} /> Add Container
        </button>}
        {editable && active?.number !== 1 && entries.length === 0 &&
          <button type="button" title="Delete empty sheet" aria-label="Delete empty sheet"
            onClick={deleteSheet} className="ca-icon-btn"><Trash2 size={15} /></button>}
        <button type="button" title="Refresh" aria-label="Refresh account" onClick={() => load()}
          className="ca-icon-btn"><RefreshCw size={16} /></button>
      </div>

      <div className="ca-table-scroll">
        <table className="ca-table" dir="ltr">
          <thead><tr>{headings.map((h) => <th key={h}>{h}</th>)}<th>Action</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={11} className="ca-empty">Loading container account...</td></tr> : null}
            {!loading && entries.map((entry) => <DataRow key={entry.id} record={entry}
              editable={editable} onSave={saveRow} onDelete={removeRow} />)}
            {!loading && showEntry && editable &&
              <tr className="ca-new-row">
                {fieldNames.map((field) => <td key={field}>
                  <EditCell field={field} record={newRow} onChange={updateNew} />
                </td>)}
                <td className="ca-actions">
                  <div className="ca-action-buttons">
                    <button type="button" aria-label="Save new container" disabled={busy}
                      onClick={addRow}><Save size={16} /></button>
                    <button type="button" aria-label="Cancel new container" disabled={busy}
                      onClick={() => setShowEntry(false)}><X size={16} /></button>
                  </div>
                </td>
              </tr>}
            {!loading && !entries.length && !showEntry &&
              <tr><td colSpan={11} className="ca-empty">No containers in this sheet. Use Add Container to enter the first one.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="ca-footnote">
        All sheets contribute to the single total above. This account is independent of Container Invoices,
        TT Invoices, BL Amount, and all other website accounts.
      </p>
    </div>
  </section>;
}

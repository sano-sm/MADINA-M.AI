import React from "react";
import { X } from "lucide-react";

export function Modal({ open, onClose, title, children, testid, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-testid={testid}
        className={`card-surface my-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-sm animate-fade-up`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-lg font-head font-bold gold-text">{title}</h3>
          <button onClick={onClose} data-testid="modal-close" className="text-muted-foreground hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block min-w-0 mb-3">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Input(props) {
  return (
    <input {...props}
      style={{ ...(["date", "month", "datetime-local", "time", "week"].includes(props.type) ? { appearance: "none", WebkitAppearance: "none", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", display: "block" } : {}), ...props.style }}
      className={`w-full min-w-0 max-w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--gold)] ${props.className || ""}`} />
  );
}

export function Select({ children, ...props }) {
  return (
    <select {...props}
      className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--gold)]">
      {children}
    </select>
  );
}

export function Btn({ children, variant = "gold", className = "", ...props }) {
  const styles = {
    gold: "gold-gradient text-black hover:brightness-110",
    dark: "bg-[var(--surface-2)] text-white border border-border hover:border-[var(--gold)]",
    danger: "bg-destructive text-white hover:brightness-110",
    ghost: "text-muted-foreground hover:text-white",
  };
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold transition-[filter,background-color,border-color,color] active:scale-95 disabled:opacity-50 ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function PageHeader({ title, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl sm:text-3xl font-head font-black tracking-tight text-white">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Empty({ text }) {
  return <div className="py-16 text-center text-muted-foreground">{text}</div>;
}

export function Badge({ children, tone = "gold" }) {
  const tones = {
    gold: "bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/30",
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    gray: "bg-white/10 text-gray-300 border-white/20",
  };
  return <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function useIsMobile(bp = 768) {
  const [m, setM] = React.useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  React.useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    on();
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

const alignClass = (a) => (a === "end" ? "text-end" : a === "center" ? "text-center" : "text-start");

// Responsive table: real <table> on desktop, stacked cards on mobile.
// columns: [{ label, render(row), align?, cell?, action?, hideOnMobile? }]
export function DataTable({ columns, rows, rowKey, rowTestId, empty }) {
  const isMobile = useIsMobile();
  if (!rows || rows.length === 0)
    return <div className="card-surface rounded-sm"><Empty text={empty} /></div>;

  if (isMobile) {
    const dataCols = columns.filter((c) => !c.action && !c.hideOnMobile);
    const actionCols = columns.filter((c) => c.action);
    return (
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={rowKey(r)} data-testid={rowTestId ? rowTestId(r) : undefined}
            className="card-surface rounded-sm p-4">
            <div className="space-y-2">
              {dataCols.map((c, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</span>
                  <span className={`min-w-0 break-words text-end text-sm text-white ${c.cell || ""}`}>{c.render(r)}</span>
                </div>
              ))}
            </div>
            {actionCols.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                {actionCols.map((c, i) => <React.Fragment key={i}>{c.render(r)}</React.Fragment>)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card-surface overflow-x-auto rounded-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-[var(--surface-2)] text-xs uppercase text-muted-foreground">
          <tr>{columns.map((c, i) => <th key={i} className={`p-3 font-medium ${alignClass(c.align)}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} data-testid={rowTestId ? rowTestId(r) : undefined} className="border-b border-border hover:bg-white/5">
              {columns.map((c, i) => <td key={i} className={`p-3 ${alignClass(c.align)} ${c.cell || ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

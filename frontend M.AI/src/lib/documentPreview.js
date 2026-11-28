// Keep the originating page mounted while a mobile report is open.
import { api, apiError } from "@/lib/api";
import { toast } from "sonner";

function viewer(title) {
  const panel = document.createElement("dialog");
  panel.setAttribute("aria-label",title);
  panel.style.cssText = "position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;background:white;color:#18392e";
  const bar = document.createElement("div");
  bar.style.cssText = "display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center;padding:8px 8px;padding-top:max(8px,env(safe-area-inset-top));background:white;flex-shrink:0;width:100%;box-sizing:border-box";
  const center = document.createElement("div");
  center.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;flex-wrap:wrap";
  const controlStyle = "display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:6px 5px;box-sizing:border-box;font-size:clamp(12px,3.5vw,17px);font-weight:700;line-height:1.2;text-align:center;color:#18392e;background:#f3f6f5;border:1px solid #d3dfda;border-radius:6px;text-decoration:none;cursor:pointer";
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText = "display:block;width:100%;height:100%;min-height:0;border:0;overflow:auto";
  function action(label, fn) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = fn;
    button.style.cssText = controlStyle;
    (label === "Print" ? center : bar).appendChild(button);
  }
  action("✕ Back",() => panel.close());
  bar.appendChild(center);
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.append(bar,frame);
  document.body.appendChild(panel);
  panel.onclose = () => panel.remove();
  panel.showModal();
  return {panel,bar,center,controlStyle,frame,action};
}

export function printWindow() {
  if (!window.matchMedia("(pointer: coarse)").matches) return window.open("", "_blank");
  const {frame,action} = viewer("Print preview");
  action("Print",() => frame.contentWindow.print());
  return frame.contentWindow;
}

export function previewBlob(data, filename) {
  const blob = new Blob([data],{type:"application/pdf"});
  const url = URL.createObjectURL(blob);
  const {panel,frame,center,controlStyle,action} = viewer(filename);
  // Ask native PDF viewers to fit the entire page width on mobile. Browsers that
  // ignore PDF fragments can still use Download PDF to open their own viewer.
  frame.src = url + "#view=FitH&zoom=page-width&toolbar=1";
  action("Print",() => frame.contentWindow.print());
  const link = document.createElement("a");
  link.textContent = "Download PDF";
  link.href = url;
  link.download = filename;
  link.style.cssText = controlStyle;
  center.appendChild(link);
  const file = new File([blob],filename,{type:blob.type});
  if (navigator.canShare?.({files:[file]})) action("Share",() => navigator.share({files:[file]}).catch(()=>{}));
  panel.addEventListener("close",() => URL.revokeObjectURL(url),{once:true});
}

export function mobilePdfLinks(event) {
  const link = event.target.closest?.("a[target='_blank']");
  if (!link || !window.matchMedia("(pointer: coarse)").matches) return;
  const target = new URL(link.href);
  if (!target.pathname.endsWith("/pdf")) return;
  event.preventDefault();
  target.searchParams.delete("token");
  api.get(target.pathname.replace(/^.*\/api\//,"/")+target.search,{responseType:"blob"})
    .then(r=>previewBlob(r.data,"Report.pdf")).catch(e=>toast.error(apiError(e)));
}

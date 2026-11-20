// Keep the originating page mounted while a mobile report is open.
import { api, apiError } from "@/lib/api";
import { toast } from "sonner";

function viewer(title) {
  const panel = document.createElement("dialog");
  panel.setAttribute("aria-label",title);
  panel.style.cssText = "position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;background:white;color:#18392e";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:12px;padding-top:max(12px,env(safe-area-inset-top));background:white";
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText = "display:block;width:100%;height:calc(100% - 58px);border:0";
  function action(label, fn) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = fn;
    bar.appendChild(button);
  }
  action("✕  Back / واپس",() => panel.close());
  panel.append(bar,frame);
  document.body.appendChild(panel);
  panel.onclose = () => panel.remove();
  panel.showModal();
  return {panel,bar,frame,action};
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
  const {panel,frame,bar,action} = viewer(filename);
  frame.src = url;
  action("Print",() => frame.contentWindow.print());
  const link = document.createElement("a");
  link.textContent = "Download PDF";
  link.href = url;
  link.download = filename;
  bar.appendChild(link);
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

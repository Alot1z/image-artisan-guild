// Engine dispatch panel — vintage readout of catalogue engines with checkboxes.
import { useState, useMemo } from "react";
import { Search, Send, Sparkles, Loader2, ExternalLink, UploadCloud, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ENGINES } from "@/lib/engines";
import type { InquiryAsset } from "@/lib/inquiry-store";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

interface Props {
  assets: InquiryAsset[];
  activeId: string | null;
  hostedUrls: Record<string, string>;
  uploading: Record<string, boolean>;
  onEnginesChange: (id: string, engines: string[]) => void;
  onHostedUrlReceived: (id: string, url: string) => void;
  onUploadRequest: (id: string) => Promise<void>;
  onDispatchAll: () => void;
  onDispatchSelected: (engines: string[]) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
}

export function Engines({
  assets,
  activeId,
  hostedUrls,
  uploading,
  onEnginesChange,
  onHostedUrlReceived,
  onUploadRequest,
  onDispatchAll,
  onDispatchSelected,
  prompt,
  onPromptChange,
  notes,
  onNotesChange,
}: Props) {
  const [filter, setFilter] = useState<"all" | "form" | "url">("all");
  const [q, setQ] = useState("");

  const active = assets.find((a) => a.id === activeId) ?? null;
  const chosen = useMemo(() => new Set(active?.engines ?? []), [active]);
  const filtered = useMemo(() => {
    return ENGINES.filter((e) => {
      if (filter === "form" && e.mode !== "form-upload") return false;
      if (filter === "url" && e.mode !== "url-open") return false;
      if (q && !`${e.name} ${e.description}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [filter, q]);

  const toggle = (id: string) => {
    if (!active) return;
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    onEnginesChange(active.id, Array.from(next));
  };

  return (
    <div className="archive-card relative overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div>
          <p className="eyebrow">The Catalogue of Engines</p>
          <p className="font-display text-lg italic">Select the indices to dispatch your inquiry to.</p>
        </div>
        <span className="ribbon-num">{chosen.size}/{ENGINES.length}</span>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-4 py-3">
        <div className="flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] p-0.5">
          {(["all", "form", "url"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-display italic transition",
                filter === f ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]" : "text-[color-mix(in_oklab,var(--ink)_75%,transparent)]",
              )}
            >
              {f === "all" ? "All" : f === "form" ? "Direct Upload" : "URL Open"}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter engines…"
            className="flex-1 bg-transparent text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
          />
        </div>
      </div>

      {/* Engine tiles */}
      <div className="grid max-h-[290px] grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
        {filtered.map((engine) => {
          const on = chosen.has(engine.id);
          return (
            <button
              key={engine.id}
              type="button"
              onClick={() => toggle(engine.id)}
              className={cn(
                "plate-hover group flex items-start gap-3 rounded-md border p-2.5 text-left transition",
                on
                  ? "border-[color-mix(in_oklab,var(--seal)_60%,transparent)] bg-[color-mix(in_oklab,var(--brass)_22%,transparent)] shadow"
                  : "border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)]",
              )}
              disabled={!active}
            >
              <span className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display font-bold",
                on ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]" : "bg-[color-mix(in_oklab,var(--brass)_38%,transparent)] text-[color-mix(in_oklab,var(--ink)_85%,transparent)]",
              )}>
                {engine.mark}
              </span>
              <div className="leading-tight">
                <div className="flex items-center gap-1.5">
                  <p className="font-display text-sm font-semibold">{engine.name}</p>
                  <span className="rounded-sm border border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                    {engine.mode === "form-upload" ? "Upload" : "URL"}
                  </span>
                </div>
                <p className="text-[0.75rem] leading-tight text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">{engine.description}</p>
              </div>
              {on ? <ToggleRight className="ml-auto h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" /> : <ToggleLeft className="ml-auto h-4 w-4 text-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />}
            </button>
          );
        })}
      </div>

      {/* Hosted URL upload + dispatch row */}
      {active && (
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Dispatch</p>
              <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
                Engines that need a hosted URL will require the plate be uploaded first.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!hostedUrls[active.id] && (
                <Button variant="outline" size="sm" onClick={() => onUploadRequest(active.id)} disabled={uploading[active.id]} className="gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
                  {uploading[active.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  Host image for URL engines
                </Button>
              )}
              {hostedUrls[active.id] && (
                <div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] px-3 py-1 text-[0.7rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
                  <ExternalLink className="h-3.5 w-3.5" /> Hosted · ready
                  <button onClick={() => navigator.clipboard?.writeText(hostedUrls[active.id])} className="ml-1 rounded px-1 text-[0.65rem] uppercase tracking-wider text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">copy</button>
                </div>
              )}
              <Button
                disabled={chosen.size === 0}
                onClick={() => onDispatchSelected(Array.from(chosen))}
                className="gap-2 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] font-display text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" />
                Dispatch to {chosen.size} engine{chosen.size === 1 ? "" : "s"}
              </Button>
              {assets.length > 1 && (
                <Button variant="outline" onClick={onDispatchAll} className="gap-2 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
                  <Sparkles className="h-3.5 w-3.5" />
                  Dispatch all plates
                </Button>
              )}
            </div>
          </div>

          {/* Prompt + notes */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="eyebrow">Caption / context</span>
              <input
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="e.g. Smashed-glass vessel, kitchen scene…"
                className="mt-1 block w-full rounded-sm border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] px-3 py-1.5 font-body-serif text-sm italic outline-none"
              />
            </label>
            <label className="block">
              <span className="eyebrow">Archivist's notes</span>
              <input
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Provenance, picked-up-from, date, anything worth remembering."
                className="mt-1 block w-full rounded-sm border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] px-3 py-1.5 font-body-serif text-sm italic outline-none"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Upload an image to Convex storage; resolves with the hosted URL.
 *  Used to give URL-based engines a reachable artifact. */
export function useUploader() {
  const storeImage = useAction(api.inquiries.storeImage);
  return async function upload(dataUrl: string, mimeType: string, fileName?: string): Promise<string> {
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const result = await storeImage({ base64, mimeType, fileName });
    return result.url as string;
  };
}

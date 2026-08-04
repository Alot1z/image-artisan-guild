// History gallery modal — sheet of every inquiry you've undertaken.
// Now with filter chips and a CSS-columns masonry grid.

import { useMemo, useState } from "react";
import { History as HistoryIcon, Star, Trash2, ExternalLink, RotateCcw, X, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ENGINES } from "@/lib/engines";
import { isHostedUrlExpired } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";

interface Props {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  /** Re-host a record's plate through the existing upload path. */
  onRehost?: (entry: HistoryEntry) => Promise<void>;
  onOpen: (entry: HistoryEntry) => void;
}

type FilterKey = "all" | "face" | "exact" | "product" | "anime" | "stock";

const FILTER_CHIPS: { key: FilterKey; label: string; classify: (engines: string[]) => boolean }[] = [
  { key: "all", label: "All", classify: () => true },
  { key: "face", label: "Face", classify: (ids) => ids.some((id) => ENGINES.find((e) => e.id === id)?.feature === "face") },
  { key: "exact", label: "Exact Match", classify: (ids) => ids.some((id) => ["tineye", "tineye-multicolor", "karmadecay", "imageraider", "noop-cc"].includes(id)) },
  { key: "product", label: "E-Commerce", classify: (ids) => ids.some((id) => ENGINES.find((e) => e.id === id)?.feature === "product") },
  { key: "anime", label: "Anime", classify: (ids) => ids.some((id) => ENGINES.find((e) => e.id === id)?.feature === "anime") },
  { key: "stock", label: "Stock", classify: (ids) => ids.some((id) => ENGINES.find((e) => e.id === id)?.feature === "stock") },
];

export function History({ open, entries, onClose, onToggleFavorite, onDelete, onRehost, onOpen }: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  if (!open) return null;

  const filtered = useMemo(() => {
    return entries
      .filter((e) => {
        const classifier = FILTER_CHIPS.find((c) => c.key === filter);
        if (classifier && !classifier.classify(e.engines ?? [])) return false;
        if (q && !`${e.fileName ?? ""} ${e.prompt ?? ""} ${e.notes ?? ""} ${(e.engines ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [entries, q, filter]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = { all: entries.length, face: 0, exact: 0, product: 0, anime: 0, stock: 0 };
    for (const e of entries) {
      for (const c of FILTER_CHIPS) {
        if (c.key !== "all" && c.classify(e.engines ?? [])) out[c.key] += 1;
      }
    }
    return out;
  }, [entries]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
         style={{ background: "color-mix(in oklab, var(--ink) 70%, transparent)" }}>
      <div className="archive-card paper-grain relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl sm:h-auto sm:max-h-[88vh] sm:rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="stamp">III</span>
            <div className="leading-tight">
              <p className="eyebrow">Volume of Inquiries</p>
              <p className="font-display text-2xl italic">Your Records</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search records"
                className="w-44 bg-transparent text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
              />
            </div>
            <Button size="icon" variant="ghost" onClick={onClose} className="text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-5 py-2.5">
          <Filter className="h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
          {FILTER_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[0.7rem] font-display italic transition",
                filter === c.key
                  ? "border-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]"
                  : "border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)]",
              )}
            >
              {c.label} <span className="ml-1 rounded-full bg-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-1.5 text-[0.55rem] text-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)]">{counts[c.key]}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <HistoryIcon className="h-12 w-12 text-[color-mix(in_oklab,var(--ink)_30%,transparent)]" />
              <p className="font-display text-xl italic">No records</p>
              <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                Your inquiries will be archived here. Take a photograph or drop a frame to begin.
              </p>
            </div>
          ) : (
            // CSS-columns masonry — supports uneven thumbnail aspect-ratios nicely.
            <div className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5"
                 style={{ columnFill: "balance" }}>
              {filtered.map((e, i) => {
                const aspect = (() => {
                  if (!e.width || !e.height) return 1;
                  const r = e.height / e.width;
                  return Math.max(0.6, Math.min(1.6, r));
                })();
                return (
                  <article
                    key={e.id}
                    className="plate-hover archive-card group relative mb-3 inline-block w-full overflow-hidden rounded-md p-2 break-inside-avoid"
                  >
                    <button
                      onClick={() => onOpen(e)}
                      className="block w-full overflow-hidden rounded-sm border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_50%,transparent)]"
                    >
                      <div className="relative w-full" style={{ paddingTop: `${aspect * 100}%` }}>
                        {e.thumbnail ? (
                          <img src={e.thumbnail} alt={e.fileName ?? "Record"} className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center font-script text-base italic text-[color-mix(in_oklab,var(--ink)_40%,transparent)]">Missing plate</div>
                        )}
                        {e.favorited && (
                          <span className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] shadow">
                            <Star className="h-3 w-3 fill-current" />
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="mt-2 flex items-start justify-between gap-1 px-1 pb-1">
                      <div className="leading-tight">
                        <p className="line-clamp-1 font-display text-sm font-semibold">{e.fileName ?? "Untitled plate"}</p>
                        <p className="text-[0.65rem] text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">{new Date(e.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="ribbon-num">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    {e.engines && e.engines.length > 0 && (
                      <div className="flex flex-wrap gap-1 px-1 pb-1">
                        {e.engines.slice(0, 4).map((id) => {
                          const eng = ENGINES.find((g) => g.id === id);
                          return (
                            <span key={id} className="rounded-sm border border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                              {eng?.mark ?? id}
                            </span>
                          );
                        })}
                        {e.engines.length > 4 && (
                          <span className="text-[0.55rem] font-display italic text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">+{e.engines.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-1 px-1 pb-1">
                      <button onClick={() => onToggleFavorite(e.id)} title="Favorite" className={cn("rounded p-1 transition", e.favorited ? "text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" : "text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--ink)_75%,transparent)]")}>
                        <Star className={cn("h-3.5 w-3.5", e.favorited && "fill-current")} />
                      </button>
                      {e.hostedUrl && (
                        <>
                          <button
                            onClick={() => window.open(e.hostedUrl, "_blank", "noopener,noreferrer")}
                            title={isHostedUrlExpired(e.hostedAt) ? "Hosted URL expected to have expired (~24h lifetime)" : "Open hosted URL (~24h lifetime)"}
                            className={cn("rounded p-1 transition", isHostedUrlExpired(e.hostedAt) ? "text-[color-mix(in_oklab,var(--ink)_30%,transparent)] hover:text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" : "text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--ink)_75%,transparent)]")}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          {onRehost && isHostedUrlExpired(e.hostedAt) && (
                            <button
                              onClick={() => void onRehost(e)}
                              title="Re-host this record with a fresh URL"
                              className="rounded p-1 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      <button onClick={() => onDelete(e.id)} title="Delete" className="rounded p-1 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-5 py-3 text-[0.7rem] font-display italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
          Records are kept on this device only — IndexedDB lifetime, no server-side history.
        </div>
      </div>
    </div>
  );
}

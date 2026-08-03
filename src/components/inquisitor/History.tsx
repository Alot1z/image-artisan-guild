// History gallery modal — sheet of every inquiry you've undertaken.
import { useState } from "react";
import { History as HistoryIcon, Star, Trash2, ExternalLink, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "@/lib/history";

interface Props {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (entry: HistoryEntry) => void;
}

export function History({ open, entries, onClose, onToggleFavorite, onDelete, onOpen }: Props) {
  const [q, setQ] = useState("");
  if (!open) return null;
  const filtered = entries.filter((e) => {
    if (!q) return true;
    const blob = `${e.fileName ?? ""} ${e.prompt ?? ""} ${e.notes ?? ""}`.toLowerCase();
    return blob.includes(q.toLowerCase());
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_oklab,var(--ink)_70%,transparent)]/80 p-0 sm:items-center sm:p-4">
      <div className="archive-card paper-grain relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl sm:h-auto sm:max-h-[88vh] sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-5 py-4">
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
        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <HistoryIcon className="h-12 w-12 text-[color-mix(in_oklab,var(--ink)_30%,transparent)]" />
              <p className="font-display text-xl italic">No records</p>
              <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">Your inquiries will be archived here. Take a photograph or drop a frame to begin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filtered.map((e, i) => (
                <article
                  key={e.id}
                  className="plate-hover archive-card group relative overflow-hidden rounded-md p-2"
                >
                  <button
                    onClick={() => onOpen(e)}
                    className="block w-full overflow-hidden rounded-sm border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_50%,transparent)]"
                  >
                    <div className="relative aspect-square">
                      {e.thumbnail ? (
                        <img src={e.thumbnail} alt={e.fileName ?? "Record"} className="h-full w-full object-cover transition group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-script text-base italic text-[color-mix(in_oklab,var(--ink)_40%,transparent)]">Missing plate</div>
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
                  <div className="flex items-center justify-end gap-1 px-1 pb-1">
                    <button onClick={() => onToggleFavorite(e.id)} title="Favorite" className={cn("rounded p-1 transition", e.favorited ? "text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" : "text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--ink)_75%,transparent)]")}>
                      <Star className={cn("h-3.5 w-3.5", e.favorited && "fill-current")} />
                    </button>
                    {e.hostedUrl && (
                      <button onClick={() => window.open(e.hostedUrl, "_blank", "noopener,noreferrer")} title="Open hosted URL" className="rounded p-1 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => onDelete(e.id)} title="Delete" className="rounded p-1 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] hover:text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-5 py-3 text-[0.7rem] font-display italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
          Records are kept on this device only. To bind them to your account, sign in from the menu above.
        </div>
      </div>
    </div>
  );
}

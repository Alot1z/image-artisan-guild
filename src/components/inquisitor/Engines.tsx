// Service Browser — tier-grouped, searchable, region-aware reverse-image
// engine dispatcher. The Catalogue of Engines is now organized into the
// four Tiers from the directive and surfaces any GPS-derived regional hints
// the Inquisitor picked up automatically.

import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Globe, MapPin, Search, Send, Sparkles,
  Loader2, ExternalLink, UploadCloud, ToggleLeft, ToggleRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ENGINES, TIER_TITLES, TIER_DESCRIPTIONS,
  type Engine, type Tier, type Region,
} from "@/lib/engines";
import type { GeoPoint } from "@/lib/exif";
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
  geoHint?: GeoPoint | null;
  regionLabel?: string;
}

const FEATURE_LABEL: Record<Engine["feature"], string> = {
  general: "General",
  face: "Face",
  stock: "Stock",
  product: "Product",
  anime: "Anime",
  art: "Art",
  duplicate: "Duplicate",
  ocr: "OCR",
};

export function Engines({
  assets, activeId, hostedUrls, uploading,
  onEnginesChange, onHostedUrlReceived, onUploadRequest,
  onDispatchAll, onDispatchSelected,
  prompt, onPromptChange, notes, onNotesChange,
  geoHint, regionLabel,
}: Props) {
  const [filter, setFilter] = useState<"all" | "form" | "url">("all");
  const [q, setQ] = useState("");
  const [tierOpen, setTierOpen] = useState<Record<Tier, boolean>>({ 1: true, 2: true, 3: false, 4: false });

  const active = assets.find((a) => a.id === activeId) ?? null;
  const chosen = useMemo(() => new Set(active?.engines ?? []), [active]);

  const filtered = useMemo(() => {
    return ENGINES
      .filter((e) => {
        if (filter === "form" && e.mode !== "form-upload") return false;
        if (filter === "url" && e.mode !== "url-open") return false;
        if (q && !`${e.name} ${e.description} ${FEATURE_LABEL[e.feature]}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [filter, q]);

  const grouped = useMemo(() => {
    const out: Record<Tier, Engine[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const e of filtered) out[e.tier].push(e);
    return out;
  }, [filtered]);

  const toggleAllInTier = (tier: Tier) => {
    if (!active) return;
    const inTierIds = grouped[tier].map((e) => e.id);
    const next = new Set(chosen);
    const allOn = inTierIds.every((id) => next.has(id));
    if (allOn) {
      inTierIds.forEach((id) => next.delete(id));
    } else {
      inTierIds.forEach((id) => next.add(id));
    }
    onEnginesChange(active.id, Array.from(next));
  };

  return (
    <div className="archive-card relative overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div>
          <p className="eyebrow">The Catalogue of Engines</p>
          <p className="font-display text-lg italic">Pick the indices that should receive your plate.</p>
        </div>
        <span className="ribbon-num">{chosen.size}/{ENGINES.length}</span>
      </div>

      {/* Regional / GPS hint banner */}
      {active && geoHint && regionLabel && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-[color-mix(in_oklab,var(--ink)_22%,transparent)] px-4 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
            <p className="font-body-serif italic text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
              EXIF reveals origin near <span className="font-display font-semibold not-italic">{regionLabel}</span> (
              {geoHint.lat.toFixed(2)}°, {geoHint.lon.toFixed(2)}°). Regional engines are pre-ticked.
            </p>
          </div>
        </motion.div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-4 py-3">
        <div className="flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] p-0.5">
          {(["all", "form", "url"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-display italic transition",
                filter === f
                  ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]"
                  : "text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_45%,transparent)]",
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
            placeholder={`Filter across ${ENGINES.length} services…`}
            className="flex-1 bg-transparent text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
          />
        </div>
      </div>

      {/* Tier-grouped engine list */}
      <div className="max-h-[420px] overflow-y-auto px-3 py-3">
        {([1, 2, 3, 4] as const).map((tier) => {
          const list = grouped[tier];
          if (list.length === 0) return null;
          const open = tierOpen[tier];
          return (
            <section key={tier} className="mb-3">
              <button
                onClick={() => setTierOpen((p) => ({ ...p, [tier]: !p[tier] }))}
                className="group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition hover:bg-[color-mix(in_oklab,var(--paper-deep)_45%,transparent)]"
              >
                <div>
                  <p className="font-display text-base font-semibold italic">{TIER_TITLES[tier]}</p>
                  <p className="text-[0.7rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">
                    {TIER_DESCRIPTIONS[tier]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ribbon-num">{list.length}</span>
                  {open ? <ChevronDown className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" /> : <ChevronRight className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-1 mb-2 flex items-center justify-between gap-2 px-2">
                      <p className="text-[0.65rem] font-display italic uppercase tracking-wider text-[color-mix(in_oklab,var(--ink)_55%,transparent)]">
                        <Globe className="mr-1 inline h-3 w-3 align-text-bottom" />
                        {list.filter(() => true).length} index{list.length === 1 ? "" : "es"} in this tier
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 rounded-full px-2 text-[0.65rem] font-display italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]"
                        onClick={(e) => { e.stopPropagation(); toggleAllInTier(tier); }}
                        disabled={!active}
                      >
                        {list.every((e) => chosen.has(e.id)) ? "Deselect tier" : `Select tier`}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {list.map((engine) => {
                        const on = chosen.has(engine.id);
                        return (
                          <button
                            key={engine.id}
                            type="button"
                            onClick={() => {
                              if (!active) return;
                              const next = new Set(chosen);
                              if (next.has(engine.id)) next.delete(engine.id); else next.add(engine.id);
                              onEnginesChange(active.id, Array.from(next));
                            }}
                            className={cn(
                              "plate-hover group flex items-start gap-3 rounded-md border p-2.5 text-left transition",
                              on
                                ? "border-[color-mix(in_oklab,var(--seal)_60%,transparent)] bg-[color-mix(in_oklab,var(--brass)_22%,transparent)] shadow"
                                : "border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_75%,transparent)]",
                            )}
                            disabled={!active}
                          >
                            <span className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display font-bold",
                              on
                                ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]"
                                : "bg-[color-mix(in_oklab,var(--brass)_38%,transparent)] text-[color-mix(in_oklab,var(--ink)_85%,transparent)]",
                            )}>
                              {engine.mark}
                            </span>
                            <div className="leading-tight">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-display text-sm font-semibold">{engine.name}</p>
                                <span className="rounded-sm border border-[color-mix(in_oklab,var(--ink)_20%,transparent)] px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                                  {FEATURE_LABEL[engine.feature]}
                                </span>
                                {engine.availability !== "free" && (
                                  <span className={cn(
                                    "rounded-sm border px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider",
                                    engine.availability === "freemium"
                                      ? "border-[color-mix(in_oklab,var(--brass)_60%,transparent)] text-[color-mix(in_oklab,var(--brass)_75%,var(--ink)_25%)]"
                                      : engine.availability === "login"
                                      ? "border-[color-mix(in_oklab,var(--seal)_60%,transparent)] text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)]"
                                      : "border-[color-mix(in_oklab,var(--ink)_30%,transparent)] text-[color-mix(in_oklab,var(--ink)_65%,transparent)]",
                                  )}>
                                    {engine.availability === "freemium" ? "Freemium" : engine.availability === "login" ? "Login" : "Flaky"}
                                  </span>
                                )}
                                {engine.needsHost && (
                                  <span className="text-[0.55rem] italic text-[color-mix(in_oklab,var(--ink)_55%,transparent)]" title="Needs a publicly reachable URL — the Inquisitor will host the plate first">
                                    ◐ host
                                  </span>
                                )}
                              </div>
                              <p className="text-[0.75rem] leading-tight text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">{engine.description}</p>
                            </div>
                            {on
                              ? <ToggleRight className="ml-auto h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
                              : <ToggleLeft className="ml-auto h-4 w-4 text-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-8 text-center">
            <p className="font-display text-base italic text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">
              No engines match that filter — try a different search.
            </p>
          </div>
        )}
      </div>

      {/* Hosted URL upload + dispatch row */}
      {active && (
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Dispatch</p>
              <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
                Engines marked <span className="italic">◐ host</span> need the plate to be uploaded first; the Inquisitor will do that for you.
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

/** Upload an image to Convex storage; resolves with the hosted URL. */
export function useUploader() {
  const storeImage = useAction(api.inquiries.storeImage);
  return async function upload(dataUrl: string, mimeType: string, fileName?: string): Promise<string> {
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const result = await storeImage({ base64, mimeType, fileName });
    return result.url as string;
  };
}

// Re-export the helper used in Inquisitor.tsx to derive coord->region labels.
export const REGION_LABEL_HINTS: Record<Region, string> = {
  global: "global",
  "east-asia": "East-Asian engines (Baidu, Sogou, Naver)",
  russia: "Russian engines (Yandex, Mail.ru, FindClone)",
  europe: "European engines (Ecosia)",
  americas: "American engines",
  mena: "MENA engines",
};

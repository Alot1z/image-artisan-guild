// Service Browser — tier-grouped, searchable, region-aware reverse-image
// engine dispatcher. The Catalogue of Engines is now organized into the
// four Tiers from the directive and surfaces any GPS-derived regional hints
// the Inquisitor picked up automatically.

import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Globe, MapPin, Search, Send, Sparkles,
  Loader2, ExternalLink, UploadCloud, ToggleLeft, ToggleRight,
  SlidersHorizontal, Settings2, CheckSquare, Square, RotateCcw,
  AlertTriangle, CircleDot, CircleDashed,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ENGINES, TIER_TITLES, TIER_DESCRIPTIONS,
  REGION_TITLES, AVAILABILITY_TITLES, FEATURE_TITLES,
  engineById,
  type Engine, type Tier, type Region,
} from "@/lib/engines";
import type { GeoPoint } from "@/lib/exif";
import type { InquiryAsset } from "@/lib/inquiry-store";
import { isHostedUrlExpired } from "@/lib/history";
import type {
  AggregateResult,
  EngineStatus,
  ProxyEngineError,
  SearchPhase,
} from "@/lib/proxyTypes";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

interface Props {
  assets: InquiryAsset[];
  activeId: string | null;
  hostedUrls: Record<string, string>;
  /** Local timestamps (ms) of each hosted upload, used to estimate expiry. */
  hostedAt: Record<string, number>;
  uploading: Record<string, boolean>;
  /** Privacy mode: strip metadata from the outbound upload copy. */
  privacyMode: boolean;
  onPrivacyModeChange: (value: boolean) => void;
  onEnginesChange: (id: string, engines: string[]) => void;
  onHostedUrlReceived: (id: string, url: string) => void;
  onUploadRequest: (id: string) => Promise<void>;
  onDispatchAll: () => void;
  onDispatchSelected: (engines: string[]) => void;
  /** Re-run only the given engines; results merge into the existing ledger. */
  onRetryEngines?: (engineIds: string[]) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  autoTickRegional: boolean;
  onAutoTickRegionalChange: (value: boolean) => void;
  aggregateResults: AggregateResult[];
  aggregateBusy: boolean;
  aggregatePhase: SearchPhase;
  aggregateErrors: ProxyEngineError[];
  failureNotice?: string | null;
  manifestStatus?: Record<string, EngineStatus>;
  geoHint?: GeoPoint | null;
  regionLabel?: string;
}

const FEATURE_LABEL = FEATURE_TITLES;

/** The working phases shown in order while a search is in flight. */
const WORKING_PHASES: Array<{ phase: SearchPhase; label: string }> = [
  { phase: "uploading", label: "Hosting plate" },
  { phase: "searching", label: "Searching catalogues" },
  { phase: "processing", label: "Collating results" },
];

/** Compact confidence bar for a ranked match (score is 0..1 from the proxy). */
function ScoreMeter({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const barColor =
    pct >= 80
      ? "bg-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]"
      : pct >= 50
        ? "bg-[color-mix(in_oklab,var(--brass)_75%,var(--ink)_25%)]"
        : "bg-[color-mix(in_oklab,var(--ink)_50%,transparent)]";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Match confidence ${pct}%`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_20%,transparent)]">
        <span className={cn("block h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-body-serif text-[0.62rem] italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">{pct}%</span>
    </span>
  );
}

/** Provenance badge for a result — real provider name + live/planned status. */
function EngineSourceBadge({ id, status }: { id: string; status?: EngineStatus }) {
  const engine = engineById(id);
  const active = status === "active";
  const name = engine?.name ?? id;
  return (
    <span
      title={`${name}${active ? " · live adapter" : " · planned adapter"}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider",
        active
          ? "border-[color-mix(in_oklab,var(--seal)_55%,transparent)] text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)]"
          : "border-[color-mix(in_oklab,var(--ink)_22%,transparent)] text-[color-mix(in_oklab,var(--ink)_55%,transparent)]",
      )}
    >
      {active ? <CircleDot className="h-2.5 w-2.5" /> : <CircleDashed className="h-2.5 w-2.5" />}
      {name}
    </span>
  );
}

/** Step indicator for the existing search phase machine (no state changes). */
function PhaseSteps({ phase }: { phase: SearchPhase }) {
  const activeIndex = WORKING_PHASES.findIndex((step) => step.phase === phase);
  if (activeIndex === -1) return null;
  return (
    <ol className="flex items-center gap-2">
      {WORKING_PHASES.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={step.phase} className="flex items-center gap-2">
            {index > 0 && <span className="h-px w-2.5 bg-[color-mix(in_oklab,var(--ink)_30%,transparent)]" />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[0.62rem] font-display italic uppercase tracking-wider",
                active
                  ? "text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)]"
                  : done
                    ? "text-[color-mix(in_oklab,var(--ink)_55%,transparent)]"
                    : "text-[color-mix(in_oklab,var(--ink)_35%,transparent)]",
              )}
            >
              {done ? <CheckSquare className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Engines({
  assets, activeId, hostedUrls, hostedAt, uploading,
  onEnginesChange, onHostedUrlReceived, onUploadRequest,
  onDispatchAll, onDispatchSelected, onRetryEngines,
  prompt, onPromptChange, notes, onNotesChange,
  autoTickRegional, onAutoTickRegionalChange,
  privacyMode, onPrivacyModeChange,
  aggregateResults, aggregateBusy, aggregatePhase, aggregateErrors,
  failureNotice = null, manifestStatus = {},
  geoHint, regionLabel,
}: Props) {
  const [filter, setFilter] = useState<"all">("all");
  const [q, setQ] = useState("");
  const [tierOpen, setTierOpen] = useState<Record<Tier, boolean>>({ 1: true, 2: true, 3: false, 4: false });
  // Advanced Options
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [regionFilter, setRegionFilter] = useState<Record<Region, boolean>>({
    global: true, "east-asia": true, russia: true, europe: true, americas: true, mena: true,
  });
  const [availFilter, setAvailFilter] = useState<Record<Engine["availability"], boolean>>({
    free: true, freemium: true, login: true, flaky: true,
  });
  // User-tunable dispatch settings
  const [skipLoginOnly, setSkipLoginOnly] = useState(false);

  const active = assets.find((a) => a.id === activeId) ?? null;
  const chosen = useMemo(() => new Set(active?.engines ?? []), [active]);

  const filtered = useMemo(() => {
    return ENGINES
      .filter((e) => {
        // Every entry is dispatched through the external proxy contract.
        // Keep the filter state for a stable UI shape while avoiding the old
        // client-side upload/URL distinction.
        if (!regionFilter[e.region] && !(regionFilter.global && e.region === "global")) return false;
        if (!availFilter[e.availability]) return false;
        if (skipLoginOnly && e.availability === "login") return false;
        if (q && !`${e.name} ${e.description} ${FEATURE_LABEL[e.feature]}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [filter, q, regionFilter, availFilter, skipLoginOnly]);

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

  // One-click mass selection: every engine that matches the active filter
  // (&/or search query). This is the "Enable every index" affordance.
  const engageAll = () => {
    if (!active) return;
    const visibleIds = filtered.map((e) => e.id);
    const next = new Set(chosen);
    visibleIds.forEach((id) => next.add(id));
    onEnginesChange(active.id, Array.from(next));
  };
  const disengageAll = () => {
    if (!active) return;
    const visibleIds = filtered.map((e) => e.id);
    const next = new Set(chosen);
    visibleIds.forEach((id) => next.delete(id));
    onEnginesChange(active.id, Array.from(next));
  };

  // Adapter availability from the external proxy manifest (source of truth).
  const engineStatus = (engine: Engine): EngineStatus =>
    manifestStatus[engine.id] ?? "planned";
  const manifestLoaded = Object.keys(manifestStatus).length > 0;
  const liveCount = ENGINES.filter((e) => engineStatus(e) === "active").length;

  return (
    <div className="archive-card relative overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div>
          <p className="eyebrow">The Catalogue of Engines</p>
          <p className="font-display text-lg italic">Every index starts selected. Trim the list as you wish.</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
            <span className="inline-flex items-center gap-1"><CircleDot className="h-3 w-3 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" /> live on the proxy</span>
            <span className="inline-flex items-center gap-1"><CircleDashed className="h-3 w-3 text-[color-mix(in_oklab,var(--ink)_45%,transparent)]" /> planned</span>
            {manifestLoaded && <span>· {liveCount} adapter{liveCount === 1 ? "" : "s"} reported live</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={advancedOpen ? "default" : "outline"}
            disabled={!active}
            onClick={() => setAdvancedOpen((v) => !v)}
            className={cn(
              "h-7 gap-1.5 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] px-3 font-display italic text-[0.7rem]",
              advancedOpen
                ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90"
                : "bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)]",
            )}
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>Advanced Options</span>
            {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
          <span className="ribbon-num">{chosen.size}/{ENGINES.length}</span>
          <Button size="sm" variant="outline" disabled={!active} onClick={engageAll} className="h-7 gap-1 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-3 font-display italic text-[0.7rem]">
            Engage every index
          </Button>
          <Button size="sm" variant="ghost" disabled={!active} onClick={disengageAll} className="h-7 gap-1 rounded-full px-3 font-display italic text-[0.7rem] text-[color-mix(in_oklab,var(--ink)_70%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
            Clear
          </Button>
        </div>
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
          {(["all"] as const).map((f) => (
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
              All services
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

      {/* Advanced Options panel */}
      <AnimatePresence initial={false}>
        {advancedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-[color-mix(in_oklab,var(--ink)_22%,transparent)]"
          >
            <div className="space-y-3 px-4 py-4">
              <div>
                <p className="eyebrow flex items-center gap-1.5"><Settings2 className="h-3 w-3" /> Advanced Options</p>
                <p className="mt-1 font-body-serif text-[0.78rem] italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
                  Where the engines query from, what their availability looks like, and how to handle dispatch. Toggle a region off and every index from there is hidden from the catalogue.
                </p>
              </div>

              {/* Region filter */}
              <div>
                <p className="eyebrow mb-1.5">Regions in view</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(REGION_TITLES) as [Region, string][]).map(([k, title]) => (
                    <button
                      key={k}
                      onClick={() => setRegionFilter((p) => ({ ...p, [k]: !p[k] }))}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[0.7rem] font-display italic transition",
                        regionFilter[k]
                          ? "border-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]"
                          : "border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)]",
                      )}
                    >
                      {regionFilter[k] ? <CheckSquare className="mr-1 inline h-3 w-3 align-text-bottom" /> : <Square className="mr-1 inline h-3 w-3 align-text-bottom" />}
                      {title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Availability filter */}
              <div>
                <p className="eyebrow mb-1.5">Availability classes</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(AVAILABILITY_TITLES) as [Engine["availability"], string][]).map(([k, title]) => (
                    <button
                      key={k}
                      onClick={() => setAvailFilter((p) => ({ ...p, [k]: !p[k] }))}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[0.7rem] font-display italic transition",
                        availFilter[k]
                          ? "border-[color-mix(in_oklab,var(--brass)_60%,var(--ink)_40%)] bg-[color-mix(in_oklab,var(--brass)_45%,var(--paper-tint)_55%)] text-[color-mix(in_oklab,var(--ink)_85%,transparent)]"
                          : "border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] text-[color-mix(in_oklab,var(--ink)_55%,transparent)] line-through",
                      )}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Proxy dispatch settings */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] px-3 py-2">
                  <p className="eyebrow">Proxy queue</p>
                  <p className="mt-1 text-[0.72rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                    Provider pacing, concurrency, deduplication, and scraping policy are managed by the external proxy—not by browser tabs.
                  </p>
                </div>

                <div className="space-y-2">
                  <ToggleRow
                    label="Auto-tick regional engines from GPS"
                    sub="EXIF origin ⇒ pre-select that area's engines."
                    on={autoTickRegional}
                    onChange={onAutoTickRegionalChange}
                  />
                  <ToggleRow
                    label="Skip login-only engines"
                    sub="Hide PimEyes, FaceCheck.ID, FindClone from the list."
                    on={skipLoginOnly}
                    onChange={setSkipLoginOnly}
                  />
                  <ToggleRow
                    label="Strip metadata from the uploaded copy"
                    sub="Re-encode the outbound copy to remove EXIF/GPS before hosting. Your local plate and its EXIF keep their metadata."
                    on={privacyMode}
                    onChange={onPrivacyModeChange}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                                <span
                                  title={engineStatus(engine) === "active" ? "Adapter live on the external proxy" : "Adapter planned — not yet live on the external proxy"}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-wider",
                                    engineStatus(engine) === "active"
                                      ? "border-[color-mix(in_oklab,var(--seal)_55%,transparent)] text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)]"
                                      : "border-[color-mix(in_oklab,var(--ink)_22%,transparent)] text-[color-mix(in_oklab,var(--ink)_55%,transparent)]",
                                  )}
                                >
                                  {engineStatus(engine) === "active" ? <CircleDot className="h-2.5 w-2.5" /> : <CircleDashed className="h-2.5 w-2.5" />}
                                  {engineStatus(engine) === "active" ? "Live" : "Planned"}
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
                                  <span className="text-[0.55rem] italic text-[color-mix(in_oklab,var(--ink)_55%,transparent)]" title="The external proxy receives the hosted plate URL">
                                    ◐ proxy
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

      {/* Ranked proxy results */}
      {active && (aggregateBusy || aggregateResults.length > 0 || aggregateErrors.length > 0 || failureNotice) && (
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="eyebrow">The Proxy Ledger</p>
              {aggregateResults.length > 0 && !aggregateBusy && (
                <span className="ribbon-num" title="Ranked matches returned">{aggregateResults.length}</span>
              )}
            </div>
            <p className="font-display text-lg italic">Ranked matches from the external search contract.</p>
            {aggregateBusy && <PhaseSteps phase={aggregatePhase} />}
          </div>

          {failureNotice && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--seal)_14%,transparent)] px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)]" />
              <p className="font-body-serif text-sm italic text-[color-mix(in_oklab,var(--ink)_85%,transparent)]">{failureNotice}</p>
            </div>
          )}

          {aggregateErrors.length > 0 && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="eyebrow mb-1.5">Engines that failed this inquiry</p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={aggregateBusy}
                  onClick={() => onRetryEngines?.(aggregateErrors.map((e) => e.engine_id))}
                  className="h-6 gap-1 rounded-full px-2 text-[0.62rem] font-display italic text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)] disabled:opacity-40"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry all failed
                </Button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {aggregateErrors.map((err) => {
                  const engineName = engineById(err.engine_id)?.name ?? err.engine_id;
                  return (
                    <span
                      key={err.engine_id}
                      title={err.error}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--seal)_12%,transparent)] px-2 py-0.5 text-[0.62rem] font-display italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]"
                    >
                      {engineName} · failed
                      <button
                        type="button"
                        disabled={aggregateBusy}
                        onClick={() => onRetryEngines?.([err.engine_id])}
                        className="rounded-full px-1 text-[0.6rem] uppercase tracking-wider text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)] disabled:opacity-40"
                        title={`Retry ${engineName}`}
                      >
                        retry
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {!aggregateBusy && aggregateResults.length === 0 && aggregateErrors.length === 0 && !failureNotice && (
            <p className="mt-3 font-body-serif text-sm italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">No matching folios were returned.</p>
          )}
          {aggregateResults.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {aggregateResults.map((match, index) => {
                const engineIds = match.services?.length ? match.services : [];
                const domain = (() => {
                  try { return new URL(match.sourceUrl).hostname.replace(/^www\./, ""); } catch { return undefined; }
                })();
                const dimensions = match.width && match.height ? `${match.width} × ${match.height}` : undefined;
                return (
                  <a
                    key={match.id}
                    href={match.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="plate-hover group relative flex gap-3 rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] p-2.5 transition"
                  >
                    <span className="ribbon-num absolute -left-2 -top-2" title={`Ranked #${index + 1}`}>{index + 1}</span>
                    {match.thumbnailUrl ? (
                      <img src={match.thumbnailUrl} alt="" className="h-16 w-16 shrink-0 rounded-sm object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-sm bg-[color-mix(in_oklab,var(--brass)_30%,transparent)] font-display text-xs">№</span>
                    )}
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-display text-sm font-semibold group-hover:underline">{match.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                      </span>
                      <span className="mt-1 block truncate font-mono text-[0.62rem] text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">{match.sourceUrl}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        {typeof match.score === "number"
                          ? <ScoreMeter score={match.score} />
                          : <span className="catalogue-tag" title="No confidence score reported by the proxy">unscored</span>}
                        {match.matchType && <span className="catalogue-tag">{match.matchType}</span>}
                        {dimensions && <span className="catalogue-tag">{dimensions}</span>}
                      </span>
                      {(engineIds.length > 0 || domain) && (
                        <span className="mt-1.5 flex flex-wrap items-center gap-1">
                          {domain && <span className="catalogue-tag">{domain}</span>}
                          {engineIds.map((id) => <EngineSourceBadge key={id} id={id} status={manifestStatus[id]} />)}
                        </span>
                      )}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Hosted URL upload + dispatch row */}
      {active && (
        <div className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Dispatch</p>
              <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
                The external proxy receives the plate through a short-lived hosted URL and returns one ranked result set.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!hostedUrls[active.id] && (
                <Button variant="outline" size="sm" onClick={() => onUploadRequest(active.id)} disabled={uploading[active.id]} className="gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
                  {uploading[active.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  Host image for the proxy
                </Button>
              )}
              {hostedUrls[active.id] && !isHostedUrlExpired(hostedAt[active.id]) && (
                <div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] px-3 py-1 text-[0.7rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
                  <ExternalLink className="h-3.5 w-3.5" /> Hosted · ready · ~24h lifetime
                  <button onClick={() => navigator.clipboard?.writeText(hostedUrls[active.id])} className="ml-1 rounded px-1 text-[0.65rem] uppercase tracking-wider text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">copy</button>
                </div>
              )}
              {hostedUrls[active.id] && isHostedUrlExpired(hostedAt[active.id]) && (
                <div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--seal)_12%,transparent)] px-3 py-1 text-[0.7rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
                  <AlertTriangle className="h-3.5 w-3.5 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
                  Hosted URL expected to have expired
                  <Button variant="ghost" size="sm" disabled={uploading[active.id]} onClick={() => onUploadRequest(active.id)} className="h-6 gap-1 rounded-full px-2 text-[0.62rem] font-display italic text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
                    {uploading[active.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Re-host
                  </Button>
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

function ToggleRow({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition",
        on
          ? "border-[color-mix(in_oklab,var(--seal)_55%,transparent)] bg-[color-mix(in_oklab,var(--brass)_22%,transparent)]"
          : "border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_75%,transparent)]",
      )}
    >
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold italic">{label}</span>
        {sub && <span className="block text-[0.7rem] font-body-serif text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">{sub}</span>}
      </span>
      {on ? <ToggleRight className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" /> : <ToggleLeft className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />}
    </button>
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

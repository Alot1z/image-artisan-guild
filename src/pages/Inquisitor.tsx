// The Image Inquisitor — the full reverse-image engineering workbench.
// Wires the dispatch pipeline, regional GPS hints, palette tinting, the
// format-converter strip, the cropper, the records drawer, and the paste/
// drop-anywhere handlers.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Compass, Library, MousePointerClick } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/utils";

import { InputHub, DropZone } from "@/components/inquisitor/InputHub";
import { Preview } from "@/components/inquisitor/Preview";
import { Engines, useUploader } from "@/components/inquisitor/Engines";
import { Sidebar } from "@/components/inquisitor/Sidebar";
import { History } from "@/components/inquisitor/History";
import { Cropper } from "@/components/inquisitor/Cropper";
import { convertAndDownload } from "@/lib/format";

import {
  useInquiryStore,
  type InquiryAsset,
  SOURCE_LABELS,
} from "@/lib/inquiry-store";
import { ENGINES } from "@/lib/engines";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { restoreBlob, isHostedUrlExpired, type HistoryEntry } from "@/lib/history";
import { blobToDataUrl, compressForUpload, downscale } from "@/lib/image-utils";
import { readGeoPoint } from "@/lib/exif";
import { suggestedEngineIds, commonNameForGeo } from "@/lib/region";
import type {
  AggregateDispatchResult,
  AggregateResult,
  EngineStatus,
  ProxyEngineError,
  SearchPhase,
} from "@/lib/proxyTypes";
import logo from "@/assets/logo.svg";

/** Merge retry results into the existing ledger: dedupe by source URL,
 *  keep the higher score, and union the provenance (services) lists. */
function mergeAggregateResults(prev: AggregateResult[], next: AggregateResult[]): AggregateResult[] {
  const byUrl = new Map<string, AggregateResult>();
  for (const item of [...prev, ...next]) {
    const key = item.sourceUrl.trim().toLowerCase();
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, item);
      continue;
    }
    const better = (item.score ?? 0) >= (existing.score ?? 0) ? item : existing;
    byUrl.set(key, {
      ...better,
      score: Math.max(existing.score ?? 0, item.score ?? 0),
      services: [...new Set([...(existing.services ?? []), ...(item.services ?? [])])],
    });
  }
  return [...byUrl.values()];
}

/** localStorage key remembering the user's privacy-ack choice. */
const PRIVACY_KEY = "inquisitor.privacy-ack.v1";

export default function Inquisitor() {
  const store = useInquiryStore();
  const [params] = useSearchParams();
  const uploader = useUploader();
  const aggregateSearch = useAction(api.aggregate.aggregateSearch);
  /** Privacy mode: when on, the outbound upload copy is deterministically
   *  stripped of embedded metadata (EXIF/GPS) before it is hosted. */
  const [privacyMode, setPrivacyMode] = useState(false);

  /** Host an asset's blob to Convex storage, compressing ONLY the outbound
   *  payload. The local asset blob (and its EXIF/GPS/palette/hash) is never
   *  touched; if compression fails the original blob is used unchanged.
   *  In privacy mode the outbound copy is additionally re-encoded so
   *  embedded metadata (EXIF/GPS) is deterministically removed before upload. */
  const hostBlob = useCallback(async (blob: Blob, fileName?: string) => {
    let uploadBlob = blob;
    try {
      if (privacyMode) {
        // Deterministic metadata removal: re-encode through a canvas, which
        // drops all embedded metadata (EXIF/GPS/thumbnail blocks). Only the
        // upload copy is affected — history continues to store the original.
        uploadBlob = await downscale(blob, 1600, 0.86);
      } else {
        uploadBlob = await compressForUpload(blob);
      }
    } catch {
      // Never let compression break hosting.
    }
    const dataUrl = await blobToDataUrl(uploadBlob);
    return uploader(dataUrl, uploadBlob.type || "image/jpeg", fileName);
  }, [uploader, privacyMode]);
  const manifestAction = useAction(api.aggregate.enginesManifest);
  const [prompt, setPrompt] = useState("");
  const [uploadingLocal, setUploadingLocal] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [aggregateResults, setAggregateResults] = useState<AggregateResult[]>([]);
  const [aggregateErrors, setAggregateErrors] = useState<ProxyEngineError[]>([]);
  const [failureNotice, setFailureNotice] = useState<string | null>(null);
  const [manifestStatus, setManifestStatus] = useState<Record<string, EngineStatus>>({});
  const [autoTickRegional, setAutoTickRegional] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState<InquiryAsset | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PRIVACY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const pendingDispatch = useRef<(() => void) | null>(null);
  const dragCounter = useRef(0);
  const autoTickedFor = useRef<Set<string>>(new Set());

  // Open ?view=history or ?action=camera
  useEffect(() => {
    if (params.get("view") === "history") setHistoryOpen(true);
    if (params.get("action") === "camera") {
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>("input[capture]");
        el?.click();
      }, 300);
    }
  }, [params]);

  // Paste anywhere
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (event.clipboardData) {
        for (const item of event.clipboardData.items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              store.add("clipboard", file);
              toast({
                title: "Lodged from clipboard",
                description: `${SOURCE_LABELS.clipboard} · ${(file.size / 1024).toFixed(1)} KB`,
              });
              event.preventDefault();
            }
          }
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [store]);

  // Drag & drop overlay
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragCounter.current += 1;
      setDragging(true);
    };
    const onLeave = () => {
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0; setDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); // keep the browser from navigating to the dropped file
      dragCounter.current = 0; setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const f of files) {
        if (f.type.startsWith("image/")) {
          void store.add("drag", f);
        }
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [store]);

  const active = store.assets.find((a) => a.id === store.activeId) ?? null;

  // Derive geo hint from the active plate's EXIF.
  const geoPoint = active ? readGeoPoint(active.exif ?? {}) : null;
  const regionLabel = geoPoint ? commonNameForGeo(geoPoint) : null;

  /**
   * Auto-tick regional engines when EXIF reveals a GPS origin.
   * Runs *once per plate id* so the user's later manual removal of a
   * suggested engine is preserved (no re-add flicker).
   */
  useEffect(() => {
    if (!autoTickRegional || !active || !geoPoint) return;
    if (autoTickedFor.current.has(active.id)) return;
    const suggested = suggestedEngineIds(geoPoint);
    if (suggested.length === 0) {
      autoTickedFor.current.add(active.id);
      return;
    }
    const existing = new Set(active.engines);
    const newOnes = suggested.filter((id) => !existing.has(id));
    autoTickedFor.current.add(active.id);
    if (newOnes.length === 0) return;
    store.setEngines(active.id, [...active.engines, ...newOnes]);
    toast({
      title: `${newOnes.length} regional engine${newOnes.length === 1 ? "" : "s"} pre-ticked`,
      description: `Origin near ${regionLabel}. Adjust as needed.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, regionLabel, autoTickRegional]);

  // Live adapter manifest from the external proxy (active vs planned).
  useEffect(() => {
    let alive = true;
    manifestAction({})
      .then((result) => {
        if (!alive || !result.ok) return;
        const map: Record<string, EngineStatus> = {};
        for (const entry of result.entries) map[entry.id] = entry.status;
        setManifestStatus(map);
      })
      .catch((error) => {
        // Non-fatal — the catalogue falls back to the static registry.
        console.error("[inquisitor] adapter manifest sync failed", error);
      });
    return () => {
      alive = false;
    };
  }, [manifestAction]);

  const handleSource = useCallback(async (source: InquiryAsset["source"], payload: Blob) => {
    await store.add(source, payload);
  }, [store]);

  const handleUrls = useCallback(async (urls: string[]) => {
    for (const url of urls) {
      await store.addFromUrl(url);
    }
  }, [store]);

  const uploadHostFor = useCallback(async (id: string) => {
    const asset = store.assets.find((a) => a.id === id);
    if (!asset) return;
    setUploadingLocal((p) => ({ ...p, [id]: true }));
    try {
      const url = await hostBlob(asset.blob, asset.fileName);
      store.setHostedUrl(id, url);
      toast({ title: "Hosted", description: "The plate is now reachable from any catalogue engine." });
    } catch (err) {
      console.error(err);
      toast({
        title: "Hosting failed",
        description: "The plate could not be lodged at the public registry. URL engines will be unavailable until this is fixed.",
        variant: "destructive",
      });
    } finally {
      setUploadingLocal((p) => ({ ...p, [id]: false }));
    }
  }, [store, hostBlob]);

  const ensureHostThenDispatch = useCallback(async (asset: InquiryAsset, ids: string[]) => {
    setPhase("uploading");
    setAggregateResults([]);
    setAggregateErrors([]);
    setFailureNotice(null);
    const existingHosted = store.hostedUrls[asset.id] ?? asset.hostedUrl;
    // A hosted URL past its ~24h lifetime is not usable — re-host it.
    let hosted = existingHosted && !isHostedUrlExpired(store.hostedAt[asset.id] ?? asset.hostedAt)
      ? existingHosted
      : undefined;
    if (!hosted) {
      try {
        hosted = await hostBlob(asset.blob, asset.fileName);
        store.setHostedUrl(asset.id, hosted);
      } catch {
        setPhase("failed");
        setFailureNotice("The plate could not be hosted — the external proxy needs a publicly reachable image URL before it can search.");
        toast({
          title: "Could not host the plate",
          description: "The external proxy needs a publicly reachable image URL before it can search.",
          variant: "destructive",
        });
        return;
      }
    }

    setPhase("searching");
    let response: AggregateDispatchResult;
    try {
      response = await aggregateSearch({ imageUrl: hosted, engineIds: ids });
    } catch (error) {
      // Rollback safety: an unreachable proxy must never crash the workbench.
      console.error("[inquisitor] aggregate search call failed", error);
      setPhase("failed");
      setFailureNotice("Search service temporarily unavailable.");
      toast({ title: "Aggregate search unavailable", description: "Search service temporarily unavailable.", variant: "destructive" });
      return;
    }

    if (!response.ok) {
      const description = response.error === "missing-config"
        ? "Add RIS_PROXY_URL and RIS_PROXY_KEY in the Keys tab to enable the external search proxy."
        : response.error === "auth-failed"
          ? "The search service could not verify this inquiry. Please try again shortly."
          : response.error === "rate-limited"
            ? "The proxy is rate-limiting this inquiry. Wait a moment and retry."
            : response.error === "invalid-response"
              ? "The proxy returned an unexpected response."
              : "Search service temporarily unavailable.";
      if (response.error === "auth-failed" || response.error === "proxy-error") {
        // Logged securely (kind + status only) — never echo credentials.
        console.error("[inquisitor] aggregate search failed", { kind: response.error, status: response.status });
      }
      setPhase("failed");
      setFailureNotice(description);
      toast({ title: "Aggregate search unavailable", description, variant: "destructive" });
      return;
    }

    setPhase("processing");
    setAggregateResults(response.results);
    setAggregateErrors(response.errors);
    await store.recordAll({ prompt });
    setPhase("complete");
    toast({
      title: `Proxy search completed across ${response.serviceCount} services`,
      description: response.results.length > 0
        ? `${response.results.length} ranked matches returned${response.errors.length > 0 ? `, ${response.errors.length} engine${response.errors.length === 1 ? "" : "s"} failed` : ""}.`
        : response.errors.length > 0
          ? "No matches returned; every selected engine failed."
          : "No matching folios were returned for this plate.",
    });
  }, [aggregateSearch, store, hostBlob, prompt]);

  /** Re-run only the engines that failed, merging any new matches into the
   *  existing ledger so successful results are never cleared or duplicated. */
  const retryFailedEngines = useCallback(async (engineIds: string[]) => {
    const asset = store.assets.find((a) => a.id === store.activeId) ?? null;
    if (!asset || engineIds.length === 0) return;
    setPhase("searching");
    setFailureNotice(null);
    const existingHosted = store.hostedUrls[asset.id] ?? asset.hostedUrl;
    // A hosted URL past its ~24h lifetime is not usable — re-host it.
    let hosted = existingHosted && !isHostedUrlExpired(store.hostedAt[asset.id] ?? asset.hostedAt)
      ? existingHosted
      : undefined;
    if (!hosted) {
      try {
        hosted = await hostBlob(asset.blob, asset.fileName);
        store.setHostedUrl(asset.id, hosted);
      } catch {
        setPhase("complete");
        setFailureNotice("The plate could not be hosted — the external proxy needs a publicly reachable image URL before it can search.");
        toast({ title: "Retry unavailable", description: "The plate could not be hosted for the external proxy.", variant: "destructive" });
        return;
      }
    }
    let response: AggregateDispatchResult;
    try {
      response = await aggregateSearch({ imageUrl: hosted, engineIds });
    } catch (error) {
      console.error("[inquisitor] retry call failed", error);
      setPhase("complete");
      setFailureNotice("Search service temporarily unavailable.");
      toast({ title: "Retry unavailable", description: "Search service temporarily unavailable.", variant: "destructive" });
      return;
    }
    setPhase("processing");
    if (!response.ok) {
      const description = response.error === "missing-config"
        ? "Add RIS_PROXY_URL and RIS_PROXY_KEY in the Keys tab to enable the external search proxy."
        : response.error === "auth-failed"
          ? "The search service could not verify this inquiry. Please try again shortly."
          : response.error === "rate-limited"
            ? "The proxy is rate-limiting this inquiry. Wait a moment and retry."
            : response.error === "invalid-response"
              ? "The proxy returned an unexpected response."
              : "Search service temporarily unavailable.";
      if (response.error === "auth-failed" || response.error === "proxy-error") {
        // Logged securely (kind + status only) — never echo credentials.
        console.error("[inquisitor] retry failed", { kind: response.error, status: response.status });
      }
      setPhase("complete");
      setFailureNotice(description);
      toast({ title: "Retry unavailable", description, variant: "destructive" });
      return;
    }
    // Merge the new matches into the existing ledger (dedupe by source URL)
    // and drop the retried engines from the failure list.
    setAggregateResults((prev) => mergeAggregateResults(prev, response.results));
    setAggregateErrors((prev) => {
      const retried = new Set(engineIds);
      const remaining = prev.filter((err) => !retried.has(err.engine_id));
      for (const err of response.errors) {
        if (!remaining.some((e) => e.engine_id === err.engine_id)) remaining.push(err);
      }
      return remaining;
    });
    setPhase("complete");
    toast({
      title: "Retry complete",
      description: response.results.length > 0
        ? `${response.results.length} new match${response.results.length === 1 ? "" : "es"} merged into the ledger.`
        : "No additional matches were returned by the retried engines.",
    });
  }, [aggregateSearch, store, hostBlob]);

  /** First-dispatch privacy gate: the first time the user asks to dispatch or
   *  host, show a notice with only verified facts (upload occurs, metadata may
   *  contain a location, the user chooses). Once accepted the choice is
   *  remembered for this browser so the modal only ever appears once. */
  const requestDispatch = useCallback((action: () => void) => {
    if (privacyAcknowledged) {
      action();
      return;
    }
    pendingDispatch.current = action;
    setShowPrivacyModal(true);
  }, [privacyAcknowledged]);

  const acceptPrivacy = useCallback(() => {
    setPrivacyAcknowledged(true);
    try { localStorage.setItem(PRIVACY_KEY, "1"); } catch { /* ignore */ }
    setShowPrivacyModal(false);
    const action = pendingDispatch.current;
    pendingDispatch.current = null;
    if (action) action();
  }, []);

  const declinePrivacy = useCallback(() => {
    setShowPrivacyModal(false);
    pendingDispatch.current = null;
  }, []);

  /** Re-host a history record: restore its original local blob, upload a
   *  fresh copy through the existing host path, and patch the record's URL.
   *  The local record and blob are never deleted. */
  const rehostHistoryEntry = useCallback(async (entry: HistoryEntry) => {
    try {
      const blob = await restoreBlob(entry);
      if (!blob) {
        toast({ title: "Re-host unavailable", description: "The original plate is no longer stored on this device.", variant: "destructive" });
        return;
      }
      const url = await hostBlob(blob, entry.fileName);
      store.updateHistoryHosted(entry.id, url);
      toast({ title: "Re-hosted", description: "A fresh hosted URL was lodged for this record — expected to expire after approximately 24 hours." });
    } catch (err) {
      console.error(err);
      toast({ title: "Re-host failed", description: "The plate could not be lodged at the public registry.", variant: "destructive" });
    }
  }, [store, hostBlob]);

  const handleCropped = useCallback((assetId: string, croppedBlob: Blob) => {
    const source = store.assets.find((item) => item.id === assetId);
    if (!source) return;
    store.replaceAsset(assetId, {
      blob: croppedBlob,
      size: croppedBlob.size,
      url: URL.createObjectURL(croppedBlob),
      hostedUrl: undefined,
    });
    store.clearHostedUrl(assetId);
    setCropTarget(null);
    toast({ title: "Plate trimmed", description: "The crop was applied; the proxy search is starting again." });
    requestDispatch(() => {
      void ensureHostThenDispatch({ ...source, blob: croppedBlob, size: croppedBlob.size, hostedUrl: undefined }, source.engines);
    });
  }, [ensureHostThenDispatch, requestDispatch, store]);

  const activeGeoForEngines = geoPoint;
  const activeRegionLabel = regionLabel ?? undefined;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="paper-grain sticky top-0 z-30 border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="" className="h-9 w-9 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)]" />
            <div className="leading-tight">
              <p className="hidden font-display text-[0.6rem] uppercase tracking-[0.32em] text-[color-mix(in_oklab,var(--ink)_70%,transparent)] sm:block">The Image Inquisitor</p>
              <p className="font-display text-lg italic">Workbench</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="gap-1.5 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] font-display italic">
              <Library className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Records</span>
              <span className="rounded-full bg-[color-mix(in_oklab,var(--seal)_45%,transparent)] px-1.5 py-0.5 text-[0.6rem] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]">{store.history.length}</span>
            </Button>
            <Link to="/">
              <Button variant="ghost" size="sm" className="hidden gap-1.5 font-display italic sm:flex">
                <Compass className="h-3.5 w-3.5" /> Almanac
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between gap-3 pb-6">
          <div>
            <p className="eyebrow">Volume I · Field Desk</p>
            <h1 className="mt-1 font-display text-3xl font-semibold leading-tight md:text-4xl">
              <span className="drop-cap">T</span>he Workbench
            </h1>
          </div>
          <p className="hidden font-script text-base italic text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] md:block">
            paste anywhere · drop anywhere
          </p>
        </div>

        <InputHub
          onSelect={(s, b) => handleSource(s as InquiryAsset["source"], b as Blob)}
          onPaste={(b) => handleSource("clipboard", b)}
          onUrls={handleUrls}
          busy={store.busy}
        />

        {store.assets.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="archive-card paper-grain relative mt-6 overflow-hidden rounded-lg p-8 text-center"
          >
            <div className="absolute inset-0 opacity-50" aria-hidden>
              <DustMotes count={10} />
            </div>
            <div className="relative">
              <MousePointerClick className="mx-auto h-10 w-10 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
              <p className="mt-3 font-display text-2xl italic">Receive a plate to begin.</p>
              <p className="mt-2 font-body-serif text-base text-[color-mix(in_oklab,var(--ink)_78%,transparent)]">
                Pick one of the five modes of receipt above, drop a picture onto this page, or paste an image from your clipboard (⌘/Ctrl-V).
              </p>
            </div>
          </motion.div>
        )}

        {store.assets.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6">
              <Preview
                assets={store.assets}
                activeId={store.activeId}
                onSelect={store.select}
                onRotation={store.setRotation}
                onRemove={store.remove}
                hostedUrl={active?.hostedUrl ?? store.hostedUrls[active?.id ?? ""] ?? null}
                onCopyUrl={(url) => {
                  navigator.clipboard?.writeText(url);
                  toast({ title: "URL copied" });
                }}
                onDownload={(a) => downloadBlob(a.blob, a.fileName ?? `inquisitor-${a.id}.jpg`)}
                onCrop={(a) => setCropTarget(a)}
              />
              {active && (
                <div className="archive-card relative overflow-hidden rounded-lg px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="eyebrow">Convert the plate</p>
                    <div className="flex items-center gap-2">
                      {(["image/jpeg", "image/png", "image/webp"] as const).map((fmt) => (
                        <Button
                          key={fmt}
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const result = await convertAndDownload(
                              active.blob,
                              fmt,
                              active.fileName?.replace(/\.[^.]+$/, "") ?? `inquisitor-${active.id}`,
                              0.92,
                            );
                            toast({ title: "Conversion complete", description: result.label });
                          }}
                          className="gap-1 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic text-xs"
                        >
                          {fmt.split("/")[1].toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <Engines
                assets={store.assets}
                activeId={store.activeId}
                hostedUrls={store.hostedUrls}
                hostedAt={store.hostedAt}
                uploading={uploadingLocal}
                privacyMode={privacyMode}
                onPrivacyModeChange={setPrivacyMode}
                onEnginesChange={store.setEngines}
                onHostedUrlReceived={store.setHostedUrl}
                onUploadRequest={async (id) => { requestDispatch(() => { void uploadHostFor(id); }); }}
                onDispatchAll={() => requestDispatch(() => {
                  for (const a of store.assets) {
                    if (a.engines.length === 0) continue;
                    void ensureHostThenDispatch(a, a.engines);
                  }
                })}
                onDispatchSelected={(ids) => requestDispatch(() => { if (active) void ensureHostThenDispatch(active, ids); })}
                onRetryEngines={(ids) => { void retryFailedEngines(ids); }}
                prompt={prompt}
                onPromptChange={setPrompt}
                notes={active?.notes ?? ""}
                onNotesChange={(v) => active && store.setNotes(active.id, v)}
                autoTickRegional={autoTickRegional}
                onAutoTickRegionalChange={setAutoTickRegional}
                aggregateResults={aggregateResults}
                aggregateBusy={phase === "uploading" || phase === "searching" || phase === "processing"}
                aggregatePhase={phase}
                aggregateErrors={aggregateErrors}
                failureNotice={failureNotice}
                manifestStatus={manifestStatus}
                geoHint={activeGeoForEngines}
                regionLabel={activeRegionLabel}
              />
            </div>
            <Sidebar
              asset={active}
              copyPalette={async (hexes) => { await navigator.clipboard.writeText(hexes.join("\n")); toast({ title: "Palette copied" }); }}
              copyExif={async (e) => {
                const text = Object.entries(e).map(([k, v]) => `${k}: ${v}`).join("\n");
                await navigator.clipboard.writeText(text);
                toast({ title: "EXIF block copied" });
              }}
              copyHash={async (h) => { await navigator.clipboard.writeText(h); toast({ title: "Seal copied" }); }}
            />
          </div>
        )}
      </main>

      <DropZone
        active={dragging}
        onFiles={(files) => {
          for (const f of files) {
            if (typeof f === "string") continue;
            if (f.type.startsWith("image/")) void store.add("drag", f);
          }
        }}
        onDragEnd={() => { dragCounter.current = 0; setDragging(false); }}
      />

      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_80%,transparent)]/85 p-2 backdrop-blur">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="archive-card paper-grain relative w-full max-w-md rounded-lg p-6"
          >
            <span className="stamp">ℹ</span>
            <p className="eyebrow">Before the first inquiry</p>
            <h2 className="mt-1 font-display text-2xl italic">A note on provenance</h2>
            <ul className="mt-4 space-y-2 font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_78%,transparent)]">
              <li className="flex gap-2"><span className="text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">—</span>The plate will be uploaded to a public URL so the catalogue engines can inspect it.</li>
              <li className="flex gap-2"><span className="text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">—</span>Its metadata may include a location.</li>
              <li className="flex gap-2"><span className="text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">—</span>Nothing is sent until you choose to continue.</li>
            </ul>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={declinePrivacy} className="rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
                Not now
              </Button>
              <Button size="sm" onClick={acceptPrivacy} className="rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] font-display text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90">
                Continue
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {cropTarget && (
        <Cropper
          asset={cropTarget}
          open={cropTarget !== null}
          onClose={() => setCropTarget(null)}
          onCropped={handleCropped}
        />
      )}

      <History
        open={historyOpen}
        entries={store.history}
        onClose={() => setHistoryOpen(false)}
        onToggleFavorite={store.toggleFavorite}
        onDelete={(id) => { void store.deleteHistory(id); }}
        onRehost={rehostHistoryEntry}
        onOpen={async (entry: HistoryEntry) => {
          await store.addFromHistory(entry);
          setHistoryOpen(false);
        }}
      />
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function DustMotes({ count = 8 }: { count?: number }) {
  const motes = Array.from({ length: count }, () => ({
    left: `${Math.round(Math.random() * 100)}%`,
    top: `${Math.round(Math.random() * 100)}%`,
    delay: `${(Math.random() * 5).toFixed(1)}s`,
    dur: `${(5 + Math.random() * 4).toFixed(1)}s`,
  }));
  return (
    <>
      {motes.map((m, i) => (
        <span key={i} className="dust" style={{ left: m.left, top: m.top, animationDelay: m.delay, animationDuration: m.dur }} />
      ))}
    </>
  );
}

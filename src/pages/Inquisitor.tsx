// The Image Inquisitor — the full reverse-image engineering workbench.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Compass, Library, MousePointerClick,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/utils";

import { InputHub, DropZone } from "@/components/inquisitor/InputHub";
import { Preview } from "@/components/inquisitor/Preview";
import { Engines, useUploader } from "@/components/inquisitor/Engines";
import { Sidebar } from "@/components/inquisitor/Sidebar";
import { History } from "@/components/inquisitor/History";

import {
  useInquiryStore,
  type InquiryAsset,
  SOURCE_LABELS,
} from "@/lib/inquiry-store";
import { ENGINES, dispatchByForm, openByUrl } from "@/lib/engines";
import type { HistoryEntry } from "@/lib/history";import { blobToDataUrl } from "@/lib/image-utils";
import logo from "@/assets/logo.svg";

export default function Inquisitor() {
  const store = useInquiryStore();
  const [params] = useSearchParams();
  const uploader = useUploader();
  const [prompt, setPrompt] = useState("");
  const [uploadingLocal, setUploadingLocal] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dragCounter = useRef(0);

  // Open the right view if ?view=history
  useEffect(() => {
    if (params.get("view") === "history") setHistoryOpen(true);
    if (params.get("action") === "camera") {
      // trigger native camera picker if available
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>("input[capture]");
        el?.click();
      }, 300);
    }
  }, [params]);

  // Paste anywhere on the page
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
    const onLeave = (e: DragEvent) => {
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0; setDragging(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      dragCounter.current = 0; setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const f of files) {
        if (f.type.startsWith("image/")) {
          await store.add("drag", f);
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
      const dataUrl = await blobToDataUrl(asset.blob);
      const url = await uploader(dataUrl, asset.blob.type || "image/jpeg", asset.fileName);
      store.setHostedUrl(id, url);
      toast({
        title: "Hosted",
        description: "The plate is now reachable from any catalogue engine.",
      });
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
  }, [store, uploader]);

  // Dispatch current asset to selected engines. Form-upload engines go via
  // hidden form submissions; URL engines either use our hosted URL or open
  // an informational page if no host is available yet.
  const ensureHostThenDispatch = useCallback(async (asset: InquiryAsset, ids: string[]) => {
    const needsHost = ids.some((id) => ENGINES.find((e) => e.id === id)?.mode === "url-open");
    let hosted = store.hostedUrls[asset.id] ?? asset.hostedUrl;
    if (needsHost && !hosted) {
      try {
        const dataUrl = await blobToDataUrl(asset.blob);
        const url = await uploader(dataUrl, asset.blob.type || "image/jpeg", asset.fileName);
        store.setHostedUrl(asset.id, url);
        hosted = url;
        toast({ title: "Plate hosted", description: "URL engines will open this artifact." });
      } catch {
        toast({
          title: "Could not host for URL engines",
          description: "Try the dispatch once more, or use the form-upload engines.",
          variant: "destructive",
        });
      }
    }
    for (const engineId of ids) {
      const engine = ENGINES.find((e) => e.id === engineId);
      if (!engine) continue;
      if (engine.mode === "form-upload") {
        const form = dispatchByForm(engine, asset.blob);
        try {
          form.submit();
          setTimeout(() => form.remove(), 30_000);
        } catch {
          form.remove();
        }
      } else if (engine.mode === "url-open" && hosted) {
        openByUrl(engine, hosted);
      }
    }
    // Record the inquiry
    await store.recordAll({ prompt });
  }, [store, uploader, prompt]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top crest */}
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
        {/* Masthead strip */}
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

        {/* Input hub */}
        <InputHub
          onSelect={(s, b) => handleSource(s as InquiryAsset["source"], b as Blob)}
          onPaste={(b) => handleSource("clipboard", b)}
          onUrls={handleUrls}
          busy={store.busy}
        />

        {/* Empty state helper */}
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

        {/* Preview + sidebar */}
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
              />
              <Engines
                assets={store.assets}
                activeId={store.activeId}
                hostedUrls={store.hostedUrls}
                uploading={uploadingLocal}
                onEnginesChange={store.setEngines}
                onHostedUrlReceived={store.setHostedUrl}
                onUploadRequest={uploadHostFor}
                onDispatchAll={() => {
                  for (const a of store.assets) {
                    if (a.engines.length === 0) continue;
                    ensureHostThenDispatch(a, a.engines);
                  }
                }}
                onDispatchSelected={(ids) => { if (active) ensureHostThenDispatch(active, ids); }}
                prompt={prompt}
                onPromptChange={setPrompt}
                notes={active?.notes ?? ""}
                onNotesChange={(v) => active && store.setNotes(active.id, v)}
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

      {/* Drop overlay */}
      <DropZone active={dragging} onFiles={() => undefined} />

      {/* History drawer */}
      <History
        open={historyOpen}
        entries={store.history}
        onClose={() => setHistoryOpen(false)}
        onToggleFavorite={store.toggleFavorite}
        onDelete={store.deleteHistory}
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

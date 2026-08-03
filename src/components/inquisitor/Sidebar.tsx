// Sidebar — analytical panels: palette swatches, EXIF, perceptual hash,
// OCR Lantern (lazy-loaded Tesseract), Semantic Registry (Exa), share & install.
import { useEffect, useRef, useState } from "react";
import {
  Palette as PaletteIcon, Camera as CameraIcon, Fingerprint, Type,
  Share2, Download, Sparkles, Loader2, Copy, Check, Layers,
  BookOpen, ExternalLink, Globe2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/utils";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { InquiryAsset } from "@/lib/inquiry-store";

interface Props {
  asset: InquiryAsset | null;
  copyPalette: (palette: string[]) => void;
  copyExif: (exif: Record<string, string | number | undefined>) => void;
  copyHash: (hash: string) => void;
}

type OcrState = "idle" | "loading" | "done" | "error";

export function Sidebar({ asset, copyPalette, copyExif, copyHash }: Props) {
  // ── OCR Lantern state (hooks must be unconditional) ──
  const [ocrState, setOcrState] = useState<OcrState>("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const workerRef = useRef<{ terminate: () => Promise<unknown> } | null>(null);
  const runningRef = useRef(false);

  // ── Semantic Registry (Exa) state ──
  const exaSearch = useAction(api.exa.exaSearch);
  const [exaQuery, setExaQuery] = useState("");
  const [exaState, setExaState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [exaHits, setExaHits] = useState<Array<{
    id: number; title: string; url: string; publishedDate?: string;
    highlights: string[]; score?: number; favicon?: string;
  }>>([]);
  const [exaError, setExaError] = useState("");
  const [exaMissingKey, setExaMissingKey] = useState(false);

  // Reset the lantern when the plate under examination changes.
  useEffect(() => {
    setOcrState("idle");
    setOcrText("");
    setOcrProgress(0);
    setOcrStatus("");
  }, [asset?.id]);

  // Reset the registry results when the plate under examination changes.
  useEffect(() => {
    setExaState("idle");
    setExaHits([]);
    setExaError("");
    setExaMissingKey(false);
    // Seed the query from whatever descriptive text is handy.
    setExaQuery(
      asset?.notes?.trim() || asset?.fileName?.replace(/\.[^.]+$/, "") || "",
    );
  }, [asset?.id]);

  // Terminate any in-flight worker on unmount (do not leak the WASM thread).
  useEffect(() => {
    return () => {
      runningRef.current = false;
      workerRef.current?.terminate().catch(() => {});
    };
  }, []);

  const consultRegistry = async () => {
    const query = exaQuery.trim() || ocrText.trim();
    if (!query || exaState === "loading") return;
    setExaState("loading");
    setExaError("");
    setExaMissingKey(false);
    try {
      const result = await exaSearch({ query, numResults: 8, includeHighlights: true });
      if (!result.ok) {
        if (result.error === "missing-key") {
          setExaMissingKey(true);
          setExaState("error");
          setExaError("The Exa API key is not configured.");
        } else if (result.error === "rate-limited") {
          setExaState("error");
          setExaError("The registry is being consulted too often — rest a moment and retry.");
        } else {
          setExaState("error");
          setExaError("The registry could not be reached. Check the key and retry.");
        }
        return;
      }
      setExaHits(result.hits);
      setExaState("done");
      if (result.hits.length === 0) {
        toast({ title: "Registry consulted", description: "No pages matched that query. Try the OCR transcription instead." });
      }
    } catch (err) {
      console.error("Exa search failed", err);
      setExaState("error");
      setExaError("The registry could not be reached. Check your connection and retry.");
    }
  };

  const lightLantern = async () => {
    if (!asset || runningRef.current) return;
    runningRef.current = true;
    setOcrState("loading");
    setOcrText("");
    setOcrProgress(0);
    setOcrStatus("warming the lantern…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (m) => {
          setOcrStatus(m.status);
          if (typeof m.progress === "number") setOcrProgress(m.progress);
        },
      });
      workerRef.current = worker;
      if (!runningRef.current) { await worker.terminate(); return; }
      const { data } = await worker.recognize(asset.blob);
      if (!runningRef.current) return;
      const text = (data.text ?? "").trim();
      if (text) {
        setOcrText(text);
        setOcrState("done");
        toast({ title: "Lantern lit", description: "Text was lifted from the plate." });
      } else {
        setOcrText("");
        setOcrState("done");
        toast({ title: "No text found", description: "The lantern read the plate but found no legible inscription." });
      }
    } catch (err) {
      console.error("OCR failed", err);
      setOcrState("error");
      toast({ title: "Lantern sputtered", description: "OCR could not read this plate. Check your connection and retry.", variant: "destructive" });
    } finally {
      runningRef.current = false;
      workerRef.current?.terminate().catch(() => {});
      workerRef.current = null;
      setOcrProgress(0);
      setOcrStatus("");
    }
  };

  if (!asset) {
    return (
      <div className="archive-card relative overflow-hidden rounded-lg p-4">
        <p className="eyebrow">The Inspector</p>
        <p className="mt-1 font-display text-base italic">Lodge a plate to begin examining its enamel, provenance, and ink.</p>
        <p className="mt-3 font-script text-base text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">— no plate under examination —</p>
      </div>
    );
  }
  const palette = asset.palette ?? [];
  const exif = asset.exif ?? {};
  const hash = asset.hash ?? "";

  return (
    <div className="space-y-4">
      {/* Palette swatches */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <PaletteIcon className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
            <p className="font-display text-base italic">Colour Platter</p>
          </div>
          <span className="catalogue-tag">{palette.length} pigments</span>
        </div>
        <div className="space-y-2 p-4">
          {palette.length === 0 ? (
            <p className="font-script text-base italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">No pigments could be lifted from this plate.</p>
          ) : (
            palette.map((sw) => (
              <div key={sw.hex} className="flex items-center gap-3">
                <div className="h-7 w-7 shrink-0 rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] shadow-inner" style={{ background: sw.hex }} />
                <div className="leading-tight">
                  <p className="font-display text-sm font-semibold uppercase tracking-wider">{sw.hex}</p>
                  <p className="text-[0.7rem] text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">{Math.round(sw.share * 100)}% of plate</p>
                </div>
              </div>
            ))
          )}
          {palette.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => copyPalette(palette.map((s) => s.hex))} className="mt-2 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
              <Download className="h-3.5 w-3.5" /> Copy hex codes
            </Button>
          )}
        </div>
      </div>

      {/* EXIF */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <CameraIcon className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
            <p className="font-display text-base italic">Plate-Stamp · EXIF</p>
          </div>
          <span className="catalogue-tag">{Object.keys(exif).length} fields</span>
        </div>
        <div className="space-y-1.5 p-4">
          {Object.keys(exif).length === 0 ? (
            <p className="font-script text-base italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">No embossed plate-stamp was found — this image was likely re-printed or scrubbed.</p>
          ) : (
            Object.entries(exif).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-[0.78rem]">
                <span className="font-display italic text-[color-mix(in_oklab,var(--ink)_85%,transparent)]">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                <span className="font-body-serif text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">{String(v)}</span>
              </div>
            ))
          )}
          {Object.keys(exif).length > 0 && (
            <Button variant="outline" size="sm" onClick={() => copyExif(exif)} className="mt-2 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
              <Download className="h-3.5 w-3.5" /> Copy EXIF block
            </Button>
          )}
        </div>
      </div>

      {/* Perceptual Hash */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
            <p className="font-display text-base italic">Perceptual Seal</p>
          </div>
          <span className="catalogue-tag">aHash</span>
        </div>
        <div className="p-4">
          <p className="font-body-serif text-[0.75rem] text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
            A 64-bit impression used to spot near-duplicates and re-encoded copies in the wild.
          </p>
          <pre className="mt-2 select-all break-all rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] p-2 font-mono text-[0.7rem] leading-relaxed text-[color-mix(in_oklab,var(--ink)_82%,transparent)]">
            {hash || "—"}
          </pre>
          {hash && (
            <Button variant="outline" size="sm" onClick={() => copyHash(hash)} className="mt-2 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
              <Download className="h-3.5 w-3.5" /> Copy seal
            </Button>
          )}
        </div>
      </div>

      {/* OCR Lantern */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
            <p className="font-display text-base italic">OCR Lantern</p>
          </div>
          <span className="catalogue-tag">{ocrState === "done" ? "Read" : "Tesseract"}</span>
        </div>
        <div className="p-4">
          <p className="font-body-serif text-sm leading-relaxed text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            Reads signage, watermarks, and inscriptions printed on the plate. The apparatus is fetched on demand — nothing loads until you light it.
          </p>

          {ocrState === "loading" ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
                <p className="font-script text-base italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">{ocrStatus || "working…"}</p>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_15%,transparent)]">
                <div className="h-full rounded-full bg-[color-mix(in_oklab,var(--seal)_60%,var(--ink)_40%)] transition-all" style={{ width: `${Math.round(Math.max(0.04, ocrProgress) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic"
              onClick={lightLantern}
            >
              <Sparkles className="h-3.5 w-3.5" /> Light the lantern
            </Button>
          )}

          {ocrState === "done" && ocrText && (
            <div className="mt-3">
              <pre className="max-h-44 select-all overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] p-3 font-body-serif text-[0.85rem] leading-relaxed text-[color-mix(in_oklab,var(--ink)_85%,transparent)]">
                {ocrText}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic"
                onClick={async () => {
                  await navigator.clipboard.writeText(ocrText);
                  setCopied(true);
                  toast({ title: "Transcription copied" });
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy transcription"}
              </Button>
            </div>
          )}

          {ocrState === "error" && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-2 border-[color-mix(in_oklab,var(--seal)_60%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic"
              onClick={lightLantern}
            >
              <Sparkles className="h-3.5 w-3.5" /> Retry the lantern
            </Button>
          )}
        </div>
      </div>

      {/* Semantic Registry — Exa */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
            <p className="font-display text-base italic">Semantic Registry</p>
          </div>
          <span className="catalogue-tag">Exa</span>
        </div>
        <div className="p-4">
          <p className="font-body-serif text-sm leading-relaxed text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            A live-web index consulted by meaning, not pixels. Search the open record with the plate's
            caption, filename, or OCR transcription to find pages that discuss the same subject.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] px-3 py-1.5">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
            <input
              value={exaQuery}
              onChange={(e) => setExaQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") consultRegistry(); }}
              placeholder="Describe the plate, or use its transcription…"
              className="w-full bg-transparent font-body-serif text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ocrText.trim() && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-2.5 font-display italic text-[0.7rem]"
                onClick={() => { setExaQuery(ocrText.trim().slice(0, 400)); consultRegistry(); }}
              >
                <Type className="h-3 w-3" /> Use transcription
              </Button>
            )}
            <Button
              size="sm"
              disabled={exaState === "loading" || !(exaQuery.trim() || ocrText.trim())}
              onClick={consultRegistry}
              className="ml-auto h-7 gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-3 font-display text-[0.7rem] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90"
            >
              {exaState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
              {exaState === "loading" ? "Consulting…" : "Consult the registry"}
            </Button>
          </div>

          {exaMissingKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic leading-relaxed text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              This panel needs an Exa API key. Paste <span className="font-mono not-italic">EXA_API_KEY</span> into
              the project's <span className="font-display not-italic">Keys</span> tab, then consult the registry again.
            </p>
          )}
          {exaState === "error" && !exaMissingKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              {exaError}
            </p>
          )}

          {exaState === "done" && exaHits.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="eyebrow">{exaHits.length} folios returned</p>
              {exaHits.map((hit) => (
                <a
                  key={`${hit.url}-${hit.id}`}
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plate-hover group flex items-start gap-2.5 rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] p-2.5 transition"
                >
                  {hit.favicon && (
                    <img src={hit.favicon} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                  )}
                  <div className="min-w-0 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-display text-[0.85rem] font-semibold group-hover:underline">{hit.title}</p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="truncate font-mono text-[0.65rem] text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">{hit.url}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.65rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                      {typeof hit.score === "number" && (
                        <span className="catalogue-tag">rel {Math.round(hit.score * 100)}%</span>
                      )}
                      {hit.publishedDate && <span>{hit.publishedDate.slice(0, 10)}</span>}
                    </div>
                    {hit.highlights.length > 0 && (
                      <p className="mt-1 line-clamp-2 font-body-serif text-[0.75rem] leading-snug text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
                        {hit.highlights[0]}
                      </p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Share / Install */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
            <p className="font-display text-base italic">Share &amp; Carry</p>
          </div>
          <span className="catalogue-tag">iOS &amp; Android</span>
        </div>
        <div className="space-y-2 p-4 text-[0.85rem] leading-relaxed">
          <p className="font-body-serif text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            <span className="font-display italic">On iPhone / iPad:</span> open this site in Safari, tap the share icon, then choose <em>Add to Home Screen</em>. The Inquisitor will appear alongside your regular apps.
          </p>
          <p className="font-body-serif text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            <span className="font-display italic">On Android:</span> tap the browser's menu (⋮), then <em>Install app</em> or <em>Add to Home screen</em>.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic"
            onClick={async () => {
              const shareData = { title: "The Image Inquisitor", text: "Trace any picture to its origin.", url: window.location.origin + "/dashboard" };
              try {
                if (navigator.share) await navigator.share(shareData);
                else await navigator.clipboard.writeText(shareData.url);
              } catch { /* ignore */ }
            }}
          >
            <Layers className="h-3.5 w-3.5" /> Share this almanac
          </Button>
        </div>
      </div>
    </div>
  );
}

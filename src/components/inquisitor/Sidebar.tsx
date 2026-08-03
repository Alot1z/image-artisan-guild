// Sidebar — analytical panels for the Inquisitor's workbench:
//   • Colour Platter     (k-means palette swatches)
//   • Plate-Stamp       (EXIF)
//   • Perceptual Seal   (aHash)
//   • OCR Lantern       (lazy-loaded Tesseract.js)
//   • Semantic Registry (Exa + self-hosted multi-source Web Census, with
//                         auto-consult-on-OCR and an Exa /findSimilar lane)
//   • Share & Carry     (iOS / Android install instructions)
import { useEffect, useRef, useState } from "react";
import {
  Palette as PaletteIcon, Camera as CameraIcon, Fingerprint, Type,
  Share2, Download, Sparkles, Loader2, Copy, Check, Layers,
  BookOpen, ExternalLink, Globe2, Link as LinkIcon, Library as LibraryIcon,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, toast } from "@/lib/utils";
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
type RegistryState = "idle" | "loading" | "done" | "error";
type RegistrySource = "exa" | "census";

interface RegistryHitView {
  id: number;
  title: string;
  url: string;
  snippet?: string;
  score?: number;
  weight?: number;
  favicon?: string;
  publishedDate?: string;
  origin?: "duckduckgo" | "wikipedia" | "openalex" | "archive" | "openlibrary" | "github";
  source: "exa-search" | "exa-similar" | "census";
}

const ORIGIN_LABEL: Record<NonNullable<RegistryHitView["origin"]>, string> = {
  duckduckgo: "DDG",
  wikipedia: "Wiki",
  openalex: "OA",
  archive: "IA",
  openlibrary: "OL",
  github: "GH",
};

export function Sidebar({ asset, copyPalette, copyExif, copyHash }: Props) {
  // ── OCR Lantern state ──
  const [ocrState, setOcrState] = useState<OcrState>("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const workerRef = useRef<{ terminate: () => Promise<unknown> } | null>(null);
  const runningRef = useRef(false);

  // ── Semantic Registry state ──
  const exaSearch = useAction(api.exa.exaSearch);
  const exaFindSimilar = useAction(api.exa.exaFindSimilar);
  const webCensus = useAction(api.census.webCensus);

  const [registrySource, setRegistrySource] = useState<RegistrySource>("exa");
  const [autoConsultOnOcr, setAutoConsultOnOcr] = useState(true);
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryState, setRegistryState] = useState<RegistryState>("idle");
  const [registryHits, setRegistryHits] = useState<RegistryHitView[]>([]);
  const [registryError, setRegistryError] = useState("");
  const [registryNeedsKey, setRegistryNeedsKey] = useState(false);
  const [censusSourceCounts, setCensusSourceCounts] = useState<Record<string, number> | null>(null);
  const autoConsultDoneRef = useRef<string>("");

  // ── Exa /findSimilar lane ──
  const [similarUrl, setSimilarUrl] = useState("");
  const [similarState, setSimilarState] = useState<RegistryState>("idle");
  const [similarHits, setSimilarHits] = useState<RegistryHitView[]>([]);
  const [similarError, setSimilarError] = useState("");
  const [similarNeedsKey, setSimilarNeedsKey] = useState(false);

  // Reset OCR + registry + similar state when the plate under examination changes.
  useEffect(() => {
    setOcrState("idle");
    setOcrText("");
    setOcrProgress(0);
    setOcrStatus("");
    setRegistryState("idle");
    setRegistryHits([]);
    setRegistryError("");
    setRegistryNeedsKey(false);
    setCensusSourceCounts(null);
    setSimilarState("idle");
    setSimilarHits([]);
    setSimilarError("");
    setSimilarNeedsKey(false);
    autoConsultDoneRef.current = "";
    // Seed the registry query from whatever descriptive text is handy.
    setRegistryQuery(
      asset?.notes?.trim() || asset?.fileName?.replace(/\.[^.]+$/, "") || "",
    );
    // Seed the similar URL with the hosted plate URL when it exists.
    setSimilarUrl(asset?.hostedUrl ?? "");
  }, [asset?.id]);

  // Terminate any in-flight OCR worker on unmount.
  useEffect(() => {
    return () => {
      runningRef.current = false;
      workerRef.current?.terminate().catch(() => {});
    };
  }, []);

  /* -------------------- OCR Lantern -------------------- */
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

  /* -------------------- Semantic Registry -------------------- */
  const consultRegistry = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? registryQuery).trim() || ocrText.trim();
    if (!q || registryState === "loading") return;
    setRegistryState("loading");
    setRegistryError("");
    setRegistryNeedsKey(false);
    setCensusSourceCounts(null);

    try {
      if (registrySource === "exa") {
        const result = await exaSearch({ query: q, numResults: 8, includeHighlights: true });
        if (!result.ok) {
          if (result.error === "missing-key") {
            setRegistryNeedsKey(true);
            setRegistryState("error");
            setRegistryError("The Exa API key is not configured.");
          } else if (result.error === "rate-limited") {
            setRegistryState("error");
            setRegistryError("The registry is being consulted too often — rest a moment and retry.");
          } else {
            setRegistryState("error");
            setRegistryError("The registry could not be reached. Check the key and retry.");
          }
          return;
        }
        const hits: RegistryHitView[] = result.hits.map((h) => ({
          id: h.id + 1,
          title: h.title,
          url: h.url,
          snippet: h.highlights?.[0],
          score: h.score,
          favicon: h.favicon,
          publishedDate: h.publishedDate,
          source: "exa-search",
        }));
        setRegistryHits(hits);
        setRegistryState("done");
        if (result.hits.length === 0) {
          toast({ title: "Registry consulted", description: "No pages matched that query. Try a different phrasing." });
        }
      } else {
        // Self-Hosted Census — fan-out to six free public indexes
        const result = await webCensus({ query: q, numResults: 12 });
        if (!result.ok) {
          setRegistryState("error");
          setRegistryError(
            result.error === "empty-query"
              ? "The query is empty — type something first."
              : "No source returned anything. Try a shorter query.",
          );
          return;
        }
        const hits: RegistryHitView[] = result.hits.map((h) => ({
          id: h.id + 1,
          title: h.title,
          url: h.url,
          snippet: h.snippet,
          score: h.score,
          weight: h.weight,
          source: "census",
          origin: h.origin,
        }));
        setRegistryHits(hits);
        setCensusSourceCounts(result.sources);
        setRegistryState("done");
        if (result.hits.length === 0) {
          toast({ title: "Census complete", description: "No folios returned for that query." });
        }
      }
    } catch (err) {
      console.error("Registry consult failed", err);
      setRegistryState("error");
      setRegistryError("The registry could not be reached. Check your connection and retry.");
    }
  };

  /* Auto-consult the registry as soon as OCR succeeds with text.
     Runs at most once per (asset × ocrText) so a manual override isn't
     clobbered by re-renders. */
  useEffect(() => {
    if (!autoConsultOnOcr) return;
    if (ocrState !== "done") return;
    const text = ocrText.trim();
    if (!text || text.length < 6) return;
    const fingerprint = `${asset?.id ?? ""}::${text.length}::${text.slice(0, 40)}`;
    if (autoConsultDoneRef.current === fingerprint) return;
    autoConsultDoneRef.current = fingerprint;
    setRegistryQuery(text.slice(0, 400));
    void consultRegistry(text.slice(0, 400));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrState, ocrText, autoConsultOnOcr, asset?.id]);

  /* -------------------- Exa /findSimilar -------------------- */
  const consultSimilar = async () => {
    const url = similarUrl.trim();
    if (!url || similarState === "loading") return;
    setSimilarState("loading");
    setSimilarError("");
    setSimilarNeedsKey(false);
    try {
      const result = await exaFindSimilar({ url, numResults: 8, excludeSourceDomain: true });
      if (!result.ok) {
        if (result.error === "missing-key") {
          setSimilarNeedsKey(true);
          setSimilarState("error");
          setSimilarError("The Exa API key is not configured.");
        } else if (result.error === "rate-limited") {
          setSimilarState("error");
          setSimilarError("Exa is rate-limiting — rest a moment and retry.");
        } else {
          setSimilarState("error");
          setSimilarError("Could not fetch related pages. Check the URL and retry.");
        }
        return;
      }
      const hits: RegistryHitView[] = result.hits.map((h) => ({
        id: h.id + 1,
        title: h.title,
        url: h.url,
        snippet: h.highlights?.[0],
        score: h.score,
        favicon: h.favicon,
        publishedDate: h.publishedDate,
        source: "exa-similar",
      }));
      setSimilarHits(hits);
      setSimilarState("done");
      if (result.hits.length === 0) {
        toast({ title: "No related pages", description: "Exa found nothing similar to that URL." });
      }
    } catch (err) {
      console.error("findSimilar failed", err);
      setSimilarState("error");
      setSimilarError("Could not fetch related pages. Check the URL and retry.");
    }
  };

  /* -------------------- Render -------------------- */
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic"
                  onClick={async () => {
                    await navigator.clipboard.writeText(ocrText);
                    setCopied(true);
                    toast({ title: "Transcription copied" });
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy transcription"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-3 font-display italic text-[0.7rem]"
                  onClick={() => { setRegistryQuery(ocrText.trim().slice(0, 400)); void consultRegistry(ocrText.trim().slice(0, 400)); }}
                >
                  <Globe2 className="h-3 w-3" /> Send to registry
                </Button>
              </div>
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

      {/* Semantic Registry — Exa | Self-Hosted Census */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
            <p className="font-display text-base italic">Semantic Registry</p>
          </div>
          <span className="catalogue-tag">{registrySource === "exa" ? "Exa API" : "Self-Hosted"}</span>
        </div>

        <div className="p-4">
          {/* Source toggle */}
          <div className="flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] p-0.5">
            {(["exa", "census"] as const).map((src) => (
              <button
                key={src}
                onClick={() => setRegistrySource(src)}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-[0.7rem] font-display italic transition",
                  registrySource === src
                    ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] shadow"
                    : "text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_45%,transparent)]",
                )}
              >
                {src === "exa" ? "Exa (API key)" : "Self-Hosted Census"}
              </button>
            ))}
          </div>

          <p className="mt-3 font-body-serif text-sm leading-relaxed text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            {registrySource === "exa"
              ? <>A live-web index consulted by meaning, not pixels. Add <span className="font-mono">EXA_API_KEY</span> in the Keys tab.</>
              : <>Zero third-party APIs. The Inquisitor fans out to six free public indexes — DuckDuckGo, Wikipedia, OpenAlex, the Internet Archive, Open Library and GitHub code search — in parallel and merges the results.</>}
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] px-3 py-1.5">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
            <input
              value={registryQuery}
              onChange={(e) => setRegistryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void consultRegistry(); }}
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
                onClick={() => { const t = ocrText.trim().slice(0, 400); setRegistryQuery(t); void consultRegistry(t); }}
              >
                <Type className="h-3 w-3" /> Use transcription
              </Button>
            )}
            <Button
              size="sm"
              disabled={registryState === "loading" || !(registryQuery.trim() || ocrText.trim())}
              onClick={() => void consultRegistry()}
              className="ml-auto h-7 gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-3 font-display text-[0.7rem] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90"
            >
              {registryState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : (registrySource === "exa" ? <BookOpen className="h-3 w-3" /> : <Layers className="h-3 w-3" />)}
              {registryState === "loading"
                ? (registrySource === "exa" ? "Consulting…" : "Censusing…")
                : (registrySource === "exa" ? "Consult the registry" : "Take the census")}
            </Button>
          </div>

          {/* Auto-consult on OCR */}
          <button
            type="button"
            onClick={() => setAutoConsultOnOcr(!autoConsultOnOcr)}
            className={cn(
              "mt-3 flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition",
              autoConsultOnOcr
                ? "border-[color-mix(in_oklab,var(--seal)_55%,transparent)] bg-[color-mix(in_oklab,var(--brass)_22%,transparent)]"
                : "border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-tint)_75%,transparent)]",
            )}
          >
            <span className="leading-tight">
              <span className="block font-display text-[0.78rem] font-semibold italic">Auto-consult after OCR</span>
              <span className="block text-[0.65rem] font-body-serif text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
                As soon as the lantern reads text, send the transcription straight to the registry.
              </span>
            </span>
            {autoConsultOnOcr
              ? <ToggleRight className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
              : <ToggleLeft className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklab,var(--ink)_35%,transparent)]" />}
          </button>

          {/* Errors */}
          {registryNeedsKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic leading-relaxed text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              This panel needs an Exa API key. Paste <span className="font-mono not-italic">EXA_API_KEY</span> into
              the project's <span className="font-display not-italic">Keys</span> tab, switch to <span className="font-display not-italic">Self-Hosted Census</span> for the no-key path, or both.
            </p>
          )}
          {registryState === "error" && !registryNeedsKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              {registryError}
            </p>
          )}

          {/* Census source breakdown */}
          {registrySource === "census" && censusSourceCounts && registryState === "done" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.65rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
              <span className="eyebrow not-italic">Sources ·</span>
              {Object.entries(censusSourceCounts).map(([name, n]) => (
                <span key={name} className="rounded-sm border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-1.5 py-0.5" title={`${name}: ${n} folios`}>
                  {name}: <strong className="font-display not-italic">{n}</strong>
                </span>
              ))}
            </div>
          )}

          {/* Hits */}
          {registryState === "done" && registryHits.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="eyebrow">{registryHits.length} folios returned</p>
              {registryHits.map((hit) => (
                <a
                  key={`${hit.source}-${hit.url}-${hit.id}`}
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plate-hover group flex items-start gap-2.5 rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] p-2.5 transition"
                >
                  {hit.favicon ? (
                    <img src={hit.favicon} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                  ) : (
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-[color-mix(in_oklab,var(--ink)_55%,transparent)]" />
                  )}
                  <div className="min-w-0 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-display text-[0.85rem] font-semibold group-hover:underline">{hit.title}</p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="truncate font-mono text-[0.65rem] text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">{hit.url}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.6rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                      {hit.origin && <span className="rounded-sm border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-1.5 py-0.5 uppercase tracking-wider">{ORIGIN_LABEL[hit.origin]}</span>}
                      {typeof hit.score === "number" && <span className="catalogue-tag">rel {Math.round(hit.score * 100)}%</span>}
                      {typeof hit.weight === "number" && <span className="catalogue-tag">wt {hit.weight.toFixed(2)}</span>}
                      {hit.publishedDate && <span>{hit.publishedDate.slice(0, 10)}</span>}
                    </div>
                    {hit.snippet && (
                      <p className="mt-1 line-clamp-2 font-body-serif text-[0.75rem] leading-snug text-[color-mix(in_oklab,var(--ink)_72%,transparent)]" dangerouslySetInnerHTML={undefined}>
                        {hit.snippet}
                      </p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Exa /findSimilar — related pages around any URL */}
      <div className="archive-card relative overflow-hidden rounded-lg">
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
            <p className="font-display text-base italic">Find Similar Pages</p>
          </div>
          <span className="catalogue-tag">Exa</span>
        </div>
        <div className="p-4">
          <p className="font-body-serif text-sm leading-relaxed text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
            Paste any URL — the hosted plate, a reference page, a competitor — and discover pages that
            Exa's index says are semantically adjacent.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] px-3 py-1.5">
            <LinkIcon className="h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--ink)_60%,transparent)]" />
            <input
              value={similarUrl}
              onChange={(e) => setSimilarUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void consultSimilar(); }}
              placeholder="https://…"
              className="w-full bg-transparent font-body-serif text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {asset.hostedUrl && similarUrl.trim() !== asset.hostedUrl.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSimilarUrl(asset.hostedUrl ?? "")}
                className="h-7 gap-1 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] px-2.5 font-display italic text-[0.7rem]"
              >
                <LibraryIcon className="h-3 w-3" /> Use hosted plate URL
              </Button>
            )}
            <Button
              size="sm"
              disabled={similarState === "loading" || !similarUrl.trim()}
              onClick={() => void consultSimilar()}
              className="ml-auto h-7 gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-3 font-display text-[0.7rem] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90"
            >
              {similarState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />}
              {similarState === "loading" ? "Searching…" : "Find similar"}
            </Button>
          </div>

          {similarNeedsKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic leading-relaxed text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              Add <span className="font-mono not-italic">EXA_API_KEY</span> in the Keys tab to enable this lane.
            </p>
          )}
          {similarState === "error" && !similarNeedsKey && (
            <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--seal)_45%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)] px-3 py-2 font-body-serif text-[0.78rem] italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              {similarError}
            </p>
          )}

          {similarState === "done" && similarHits.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="eyebrow">{similarHits.length} adjacent pages</p>
              {similarHits.map((hit) => (
                <a
                  key={`${hit.url}-${hit.id}`}
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plate-hover group flex items-start gap-2.5 rounded-md border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_60%,transparent)] p-2.5 transition"
                >
                  {hit.favicon ? (
                    <img src={hit.favicon} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                  ) : (
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-[color-mix(in_oklab,var(--ink)_55%,transparent)]" />
                  )}
                  <div className="min-w-0 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-display text-[0.85rem] font-semibold group-hover:underline">{hit.title}</p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-[color-mix(in_oklab,var(--ink)_45%,transparent)] opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="truncate font-mono text-[0.65rem] text-[color-mix(in_oklab,var(--ink)_60%,transparent)]">{hit.url}</p>
                    {typeof hit.score === "number" && (
                      <span className="mt-1 inline-block rounded-sm border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-1.5 py-0.5 text-[0.6rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                        relatedness {Math.round(hit.score * 100)}%
                      </span>
                    )}
                    {hit.snippet && (
                      <p className="mt-1 line-clamp-2 font-body-serif text-[0.75rem] leading-snug text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
                        {hit.snippet}
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

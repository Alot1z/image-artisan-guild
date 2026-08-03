// The five modes of receipt — input hub as a vintage plate with embedded icons.
import { useRef, useState } from "react";
import { Camera, Images, Link2, FolderOpen, ClipboardPaste, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onSelect: (source: "camera" | "gallery" | "web" | "files" | "clipboard", payload: Blob | string) => void;
  onPaste: (blob: Blob) => void;
  onUrls: (urls: string[]) => void;
  busy?: boolean;
  compact?: boolean;
}

const TILES = [
  { id: "camera" as const, icon: Camera, ribbon: "I", title: "Take a photograph", note: "Use the in-app lens to search what you see.", accept: "camera/*" },
  { id: "gallery" as const, icon: Images, ribbon: "II", title: "Select from gallery", note: "Choose a picture from your camera roll.", accept: "image/*" },
  { id: "web" as const, icon: Link2, ribbon: "III", title: "Get from the web", note: "Fetch an image from any URL on the public net.", accept: "" },
  { id: "files" as const, icon: FolderOpen, ribbon: "IV", title: "Import from files", note: "Open a stored dossier from any folder on this device.", accept: "" },
  { id: "clipboard" as const, icon: ClipboardPaste, ribbon: "V", title: "Paste from clipboard", note: "Paste an image you have already copied.", accept: "" },
];

export function InputHub({ onSelect, onPaste, onUrls, busy, compact }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [webUrl, setWebUrl] = useState<string>("");
  const [showWebInput, setShowWebInput] = useState(false);

  const handleTile = (id: Props extends never ? never : "camera" | "gallery" | "files") => {
    if (id === "camera") cameraRef.current?.click();
    if (id === "gallery") galleryRef.current?.click();
    if (id === "files") filesRef.current?.click();
  };

  return (
    <div className={cn("archive-card relative overflow-hidden rounded-lg p-1", compact && "rounded-md p-0.5")}>
      {/* Title strip */}
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div>
          <p className="eyebrow">The Five Modes of Receipt</p>
          <p className="font-display text-lg italic">Select an image to enter an inquiry.</p>
        </div>
        <span className="ribbon-num">{busy ? "…" : "Vol. I"}</span>
      </div>

      {/* Plate cards */}
      <div className={cn("grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5", compact && "p-3")}>
        {TILES.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            onClick={() => {
              if (tile.id === "web") {
                setShowWebInput((v) => !v);
                return;
              }
              if (tile.id === "clipboard") {
                navigator.clipboard?.read?.().then(async (items) => {
                  for (const it of items) {
                    for (const t of it.types) {
                      if (t.startsWith("image/")) {
                        const blob = await it.getType(t);
                        onPaste(blob);
                        return;
                      }
                    }
                  }
                }).catch(() => {
                  // User denied or unsupported — show paste prompt
                  const txt = window.prompt("Paste your image (Ctrl/⌘+V on desktop) or image URL:");
                  if (txt) onUrls([txt]);
                });
                return;
              }
              handleTile(tile.id);
            }}
          />
        ))}
      </div>

      {/* Web URL Inline */}
      {showWebInput && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const urls = webUrl
              .split(/[\n, ]+/)
              .map((u) => u.trim())
              .filter(Boolean);
            if (urls.length === 0) return;
            onUrls(urls);
            setWebUrl("");
            setShowWebInput(false);
          }}
          className="flex items-center gap-2 border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3"
        >
          <Link2 className="h-4 w-4 text-[color-mix(in_oklab,var(--ink)_70%,transparent)]" />
          <input
            autoFocus
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
            placeholder="https://… paste one or more image URLs, separated by spaces or new lines"
            className="flex-1 border-b border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-transparent py-1.5 font-body-serif text-sm italic outline-none placeholder:italic placeholder:text-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
          />
          <button
            type="submit"
            className="rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-4 py-1.5 font-display text-sm text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]"
          >
            Fetch
          </button>
          <button
            type="button"
            onClick={() => setShowWebInput(false)}
            className="rounded-full p-1 text-[color-mix(in_oklab,var(--ink)_60%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect("camera", f);
          e.currentTarget.value = "";
        }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          files.forEach((f) => onSelect("gallery", f));
          e.currentTarget.value = "";
        }} />
      <input ref={filesRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          files.forEach((f) => onSelect("files", f));
          e.currentTarget.value = "";
        }} />
    </div>
  );
}

function TileButton({ tile, onClick }: { tile: typeof TILES[number]; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "plate-hover group relative w-full overflow-hidden rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_70%,transparent)] p-4 text-left transition",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="ribbon-num">{tile.ribbon}</span>
        <Icon className="h-6 w-6 text-[color-mix(in_oklab,var(--ink)_80%,transparent)] transition group-hover:rotate-6 group-hover:scale-110" strokeWidth={1.4} />
      </div>
      <p className="mt-3 font-display text-lg font-semibold leading-snug">{tile.title}</p>
      <p className="mt-1 font-body-serif text-[0.85rem] leading-snug text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">{tile.note}</p>
      <span className="pointer-events-none absolute -right-3 -bottom-3 h-12 w-12 rounded-full bg-[color-mix(in_oklab,var(--brass)_20%,transparent)] blur-xl opacity-0 transition group-hover:opacity-80" />
    </button>
  );
}

// Drop zone overlay — separate component for full-page drag detection.
export function DropZone({ onFiles, active }: { onFiles: (files: File[] | string[]) => void; active: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-40 flex items-center justify-center transition",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="archive-card plate-hover flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-[color-mix(in_oklab,var(--seal)_60%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)] p-10 shadow-2xl backdrop-blur">
        <Upload className="h-10 w-10 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" />
        <p className="font-display text-2xl italic">Release to lodge in the workbench</p>
        <p className="font-body-serif text-sm text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">One or many — we'll arrange them in the queuing-room.</p>
        <span className="ribbon-num">Lodge</span>
      </div>
    </div>
  );
}

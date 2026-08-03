import { motion } from "framer-motion";
import {
  Camera,
  Images,
  Link2,
  FolderOpen,
  ClipboardPaste,
  Search,
  History,
  Share2,
  Sparkles,
  Compass,
  Library,
  Stamp,
  Telescope,
  Pen,
  Globe2,
  Boxes,
  Palette,
  Fingerprint,
  Layers,
  Eye,
  Plus,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.svg";

const SOURCES = [
  { icon: Camera, ribbon: "I", title: "Take a photograph", copy: "Use the in-app lens to capture the world as it appears, then trace its origin from a single plate." },
  { icon: Images, ribbon: "II", title: "Select from gallery", copy: "Pick from any frame already kept in your camera roll, and send it around the catalogue." },
  { icon: Link2, ribbon: "III", title: "Fetch from the web", copy: "Paste a URL — the Inquisitor will draw the picture from any reachable corner of the net." },
  { icon: FolderOpen, ribbon: "IV", title: "Import from files", copy: "Drag a folder, or pick individual dossiers from your device — PDF, RAW, JPG, PNG, WEBP & HEIC." },
  { icon: ClipboardPaste, ribbon: "V", title: "Paste from clipboard", copy: "Copy an image anywhere, paste it into the workbench — original provenance preserved." },
];

const ENGINES = [
  { name: "Google Lens", note: "General visual search across the public web" },
  { name: "TinEye", note: "Reverse image traceback — every known copy" },
  { name: "Bing Visual", note: "Microsoft's visual search with shopping results" },
  { name: "Yandex Images", note: "Deep visual catalogue — strong on faces" },
  { name: "Lenso.ai", note: "AI-driven similar-image finder" },
  { name: "SauceNAO", note: "Anime & illustration source finder" },
  { name: "Baidu Images", note: "East Asia's largest visual index" },
];

const POWERS = [
  { icon: History, title: "Records of Inquiry", copy: "Every expedition is archived automatically — re-dispatch any plate with one tap." },
  { icon: Palette, title: "Colour Platter", copy: "Five dominant pigments are lifted straight from your plate using k-means sampling." },
  { icon: Fingerprint, title: "Perceptual Seal", copy: "An eight-bit hash to spot near-duplicates and detect re-encoded copies in the wild." },
  { icon: Layers, title: "EXIF Apparatus", copy: "Reads the embossed plate-stamp: camera, lens, ISO, aperture, even the GPS co-ordinates." },
  { icon: Boxes, title: "Batch Consignment", copy: "Drop a stack of plates at once — fan them out to multiple engines in parallel." },
  { icon: Telescope, title: "OCR Lantern", copy: "Optional text extraction for plate captions, signs, watermarks and inscriptions." },
  { icon: Eye, title: "Trichromatic View", copy: "Toggle sepia / noon / evening lamplight — pick the climate that flatters your plate." },
  { icon: Share2, title: "Share the Almanac", copy: "Send to friends, save to your home screen, or pin to the iOS dock for instant use." },
];

const PLATES = [
  "Vol. I", "No. 0142", "MMXXVI",
];

export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="min-h-screen bg-background text-foreground"
    >
      {/* Top crest — like a journal masthead */}
      <header className="paper-grain border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="The Image Inquisitor" className="h-10 w-10 rounded-full border border-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
            <div className="leading-tight">
              <p className="font-display text-[0.65rem] uppercase tracking-[0.32em] text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">A Reverse-Image Registry</p>
              <p className="font-display text-xl italic">The Image Inquisitor</p>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {["Sources", "Engines", "Apparatus", "Inventory"].map((label, i) => (
              <a key={label} href={`#section-${i}`} className="rounded-full px-4 py-1.5 text-sm font-display italic text-[color-mix(in_oklab,var(--ink)_80%,transparent)] transition hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
                {label}
              </a>
            ))}
          </nav>
          <Link to="/dashboard">
            <Button className="gap-2 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-5 font-display text-base text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90">
              <Compass className="h-4 w-4" />
              Begin an Inquiry
            </Button>
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="paper-grain relative overflow-hidden">
        <DustMotes />
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 pb-20 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-16">
          {/* Left column — provenance copy */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="relative">
            <div className="flex items-center gap-3">
              <span className="stamp">II</span>
              <p className="eyebrow">Volume the First · MMXXVI</p>
            </div>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-tight md:text-6xl xl:text-7xl">
              <span className="block drop-cap">
                Trace every picture
              </span>
              <span className="mt-3 block italic text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">
                to its true origin.
              </span>
            </h1>
            <p className="mt-6 max-w-xl font-body-serif text-lg leading-relaxed text-[color-mix(in_oklab,var(--ink)_85%,transparent)]">
              The Image Inquisitor is a small, beautifully printed apparatus for the
              study of any plate you find curious. With five modes of receipt, eight
              engines of the public record, and an almanac of every inquiry you have
              ever raised, it is the field guide for the modern investigator of pictures.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3 text-sm font-display italic text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">
              <span className="catalogue-tag"><Pen className="mr-1 inline h-3 w-3" /> Field-tested on iOS & Android</span>
              <span className="catalogue-tag"><Globe2 className="mr-1 inline h-3 w-3" /> Works fully offline</span>
              <span className="catalogue-tag"><Stamp className="mr-1 inline h-3 w-3" /> No account required</span>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/dashboard">
                <Button className="group gap-3 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-6 py-6 font-display text-lg text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] shadow-lg shadow-[color-mix(in_oklab,var(--ink)_25%,transparent)] hover:opacity-95">
                  <Search className="h-5 w-5 transition group-hover:rotate-12" />
                  Open the Workbench
                </Button>
              </Link>
              <Link to="/dashboard?view=history">
                <Button variant="outline" className="gap-2 rounded-full border-[color-mix(in_oklab,var(--ink)_40%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] px-6 py-6 font-display text-lg text-[color-mix(in_oklab,var(--ink)_85%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
                  <Library className="h-5 w-5" />
                  My Inventory
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right column — a specimen plate */}
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.1 }} className="relative">
            <div className="archive-card plate-hover relative mx-auto max-w-md overflow-hidden rounded-md p-3 md:max-w-lg">
              <div className="relative aspect-[4/5] overflow-hidden rounded-sm border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_65%,transparent)]">
                <SpecimenPlate />
              </div>
              <div className="mt-3 flex items-end justify-between px-1 pb-1">
                <div className="leading-tight">
                  <p className="eyebrow">Plate I — The Apparatus</p>
                  <p className="font-display text-lg italic">"Five receipts, eight engines, one workbench."</p>
                </div>
                <span className="ribbon-num">№ 0142</span>
              </div>
            </div>
            {/* Floating paper tags */}
            <motion.div initial={{ opacity: 0, y: 10, rotate: -4 }} animate={{ opacity: 1, y: 0, rotate: -4 }} transition={{ delay: 0.4 }} className="absolute -left-2 top-6 hidden rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)] px-3 py-1.5 font-script text-base text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] shadow-md md:block">
              Hand-engraved, 1900s reissue
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10, rotate: 6 }} animate={{ opacity: 1, y: 0, rotate: 6 }} transition={{ delay: 0.55 }} className="absolute -right-3 bottom-20 hidden rounded-md border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)] px-3 py-1.5 font-script text-base text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] shadow-md md:block">
              Add to home screen
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* The Five Modes of Receipt */}
      <section id="section-0" className="border-y border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)]">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHead eyebrow="The Five Modes of Receipt" title="Five ways to lodge a plate in the Inquisitor.">
            <T />
          </SectionHead>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {SOURCES.map(({ icon: Icon, ribbon, title, copy }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.45, delay: i * 0.05 }}
                className="archive-card plate-hover relative h-full rounded-md p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="ribbon-num">{ribbon}</span>
                  <Icon className="h-6 w-6 text-[color-mix(in_oklab,var(--ink)_75%,transparent)]" strokeWidth={1.4} />
                </div>
                <p className="mt-4 font-display text-xl font-semibold leading-snug">{title}</p>
                <p className="mt-2 font-body-serif text-[0.95rem] leading-relaxed text-[color-mix(in_oklab,var(--ink)_78%,transparent)]">{copy}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Engines */}
      <section id="section-1" className="paper-grain">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <SectionHead eyebrow="The Engines of Inquiry" title="Any plate may be sent around the catalogue, at your direction.">
            <T />
          </SectionHead>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ENGINES.map((engine, i) => (
              <motion.div
                key={engine.name}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className="archive-card plate-hover relative flex items-start gap-3 rounded-md p-4"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ink)_35%,transparent)] bg-[color-mix(in_oklab,var(--brass)_45%,transparent)] font-display text-base font-bold text-[color-mix(in_oklab,var(--ink)_90%,transparent)]">
                  {engine.name[0]}
                </span>
                <div className="leading-tight">
                  <p className="font-display text-lg font-semibold">{engine.name}</p>
                  <p className="mt-1 font-body-serif text-sm leading-snug text-[color-mix(in_oklab,var(--ink)_75%,transparent)]">{engine.note}</p>
                </div>
              </motion.div>
            ))}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: ENGINES.length * 0.04 }}
              className="archive-card relative flex items-start gap-3 rounded-md border-dashed bg-transparent p-4"
            >
              <Plus className="h-8 w-8 shrink-0 text-[color-mix(in_oklab,var(--ink)_45%,transparent)]" />
              <div>
                <p className="font-display text-lg italic">More engines shortly</p>
                <p className="mt-1 font-body-serif text-sm leading-snug text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">New catalogues are added with each monthly issue.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Apparatus — additional powers */}
      <section id="section-2" className="border-y border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-deep)_40%,transparent)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <SectionHead eyebrow="The Apparatus" title="Tools the inquisitive plate-desk relies on.">
            <T />
          </SectionHead>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {POWERS.map(({ icon: Icon, title, copy }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, delay: i * 0.04 }}
                className="archive-card plate-hover relative overflow-hidden rounded-md p-5"
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-6 w-6 text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]" strokeWidth={1.4} />
                  <span className="catalogue-tag">Anon. {i + 1}</span>
                </div>
                <p className="mt-4 font-display text-xl font-semibold">{title}</p>
                <p className="mt-2 font-body-serif text-[0.95rem] leading-relaxed text-[color-mix(in_oklab,var(--ink)_78%,transparent)]">{copy}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Inventory CTA */}
      <section id="section-3" className="paper-grain">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="archive-card relative overflow-hidden rounded-lg p-10 md:p-14">
            <div className="absolute -right-6 -top-6 hidden h-44 w-44 rounded-full bg-[color-mix(in_oklab,var(--brass)_30%,transparent)] blur-3xl md:block" />
            <div className="absolute -left-10 bottom-0 hidden h-40 w-40 rounded-full bg-[color-mix(in_oklab,var(--seal)_25%,transparent)] blur-3xl md:block" />
            <div className="relative grid grid-cols-1 gap-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="eyebrow">A Standing Invitation</p>
                <h2 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">
                  Lend us your <span className="italic text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)]">most curious plate.</span>
                </h2>
                <p className="mt-4 max-w-2xl font-body-serif text-lg leading-relaxed text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
                  Begin an inquiry at the workbench — take a fresh photograph, drop in a saved frame, paste from the clipboard, or fetch a picture by URL. The Inquisitor will dispatch it to any combination of engines and lodge a permanent record in your inventory.
                </p>
                <p className="mt-3 marginalia">— no account required, no telemetry, all-workmanship on-device.</p>
              </div>
              <div className="flex flex-col items-start gap-3 md:items-end">
                <Link to="/dashboard">
                  <Button className="gap-2 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] px-6 py-6 font-display text-lg text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] shadow-xl shadow-[color-mix(in_oklab,var(--ink)_25%,transparent)] hover:opacity-95">
                    <Sparkles className="h-5 w-5" />
                    Enter the Workbench
                  </Button>
                </Link>
                <p className="font-script text-base text-[color-mix(in_oklab,var(--ink)_70%,transparent)] md:text-right">
                  or, from the home screen: <span className="hand-underline">Share → Add to Home Screen</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 md:flex-row">
          <div className="flex items-center gap-3">
            <img src={logo} alt="" className="h-8 w-8 rounded-full border border-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
            <p className="font-display italic">The Image Inquisitor · Volume I</p>
          </div>
          <p className="text-sm font-body-serif text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
            Pressed in sepia &amp; soot · MMXXVI · All fieldwork performed on-device.
          </p>
        </div>
      </footer>
    </motion.div>
  );
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
        <span className="filigree">{title}</span>
      </h2>
      {children}
      <div className="mx-auto mt-5 h-px w-32 ink-rule" />
    </div>
  );
}

function T() {
  return (
    <p className="mx-auto mt-4 max-w-2xl font-body-serif text-lg leading-relaxed text-[color-mix(in_oklab,var(--ink)_78%,transparent)]">
      Each plate is held, examined, and dispatched with care — the catalogue will recall it when called again.
    </p>
  );
}

function DustMotes() {
  const motes = Array.from({ length: 14 }, (_, i) => ({
    left: `${Math.round(Math.random() * 100)}%`,
    top: `${Math.round(Math.random() * 100)}%`,
    delay: `${(Math.random() * 5).toFixed(1)}s`,
    dur: `${(5 + Math.random() * 4).toFixed(1)}s`,
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {motes.map((m, i) => (
        <span
          key={i}
          className="dust"
          style={{ left: m.left, top: m.top, animationDelay: m.delay, animationDuration: m.dur }}
        />
      ))}
    </div>
  );
}

/* SpecimenPlate — a vintage engraving-style SVG that doubles as the hero illustration. */
function SpecimenPlate() {
  const labels = [
    { x: 22, y: 28, text: "I · Camera", icon: Camera },
    { x: 32, y: 52, text: "II · Gallery", icon: Images },
    { x: 22, y: 76, text: "III · Web", icon: Link2 },
    { x: 70, y: 28, text: "IV · Files", icon: FolderOpen },
    { x: 78, y: 56, text: "V · Paste", icon: ClipboardPaste },
  ];
  return (
    <div className="relative h-full w-full bg-[color-mix(in_oklab,var(--paper-tint)_72%,transparent)]">
      <svg viewBox="0 0 240 300" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="heroGlow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="color-mix(in oklab, var(--brass) 18%, transparent)" />
            <stop offset="100%" stop-color="transparent" />
          </radialGradient>
        </defs>
        {/* Aged paper stripes */}
        <rect x="0" y="0" width="240" height="300" fill="url(#heroGlow)" />
        {/* Monogram */}
        <circle cx="120" cy="150" r="58" fill="none" stroke="color-mix(in oklab, var(--ink) 60%, transparent)" strokeWidth="1.5" />
        <circle cx="120" cy="150" r="46" fill="none" stroke="color-mix(in oklab, var(--ink) 40%, transparent)" strokeDasharray="2 3" />
        <text x="120" y="158" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="60" fontStyle="italic" fill="color-mix(in oklab, var(--seal) 75%, var(--ink) 25%)">I</text>
        {/* Connecting filigree */}
        {labels.map((l, i) => {
          const next = labels[(i + 1) % labels.length];
          return (
            <path
              key={i}
              d={`M 120 150 C ${(120 + l.x * 1.6) / 2} ${(150 + l.y * 1.2) / 2}, ${l.x * 1.6} ${l.y * 1.2}, ${l.x * 1.6} ${l.y * 1.2}`}
              fill="none"
              stroke="color-mix(in oklab, var(--ink) 35%, transparent)"
              strokeWidth="0.6"
              strokeDasharray="1 2"
              opacity="0.6"
            />
          );
        })}
        {/* Decorative compass */}
        <g transform="translate(120 150)" opacity="0.7">
          <line x1="-72" y1="0" x2="-46" y2="0" stroke="color-mix(in oklab, var(--ink) 50%, transparent)" strokeWidth="0.8" />
          <line x1="46" y1="0" x2="72" y2="0" stroke="color-mix(in oklab, var(--ink) 50%, transparent)" strokeWidth="0.8" />
          <line x1="0" y1="-72" x2="0" y2="-46" stroke="color-mix(in oklab, var(--ink) 50%, transparent)" strokeWidth="0.8" />
          <line x1="0" y1="46" x2="0" y2="72" stroke="color-mix(in oklab, var(--ink) 50%, transparent)" strokeWidth="0.8" />
        </g>
      </svg>
      {/* Source dots */}
      <div className="relative h-full w-full">
        {labels.map((l) => (
          <div
            key={l.text}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${l.x}%`, top: `${l.y}%` }}
          >
            <div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--ink)_35%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_75%,transparent)] px-2.5 py-1 text-[0.65rem] font-display italic text-[color-mix(in_oklab,var(--ink)_85%,transparent)] shadow-sm backdrop-blur">
              <l.icon className="h-3 w-3" strokeWidth={1.6} />
              <span>{l.text}</span>
            </div>
          </div>
        ))}
        {/* Central label */}
        <div className="absolute left-1/2 top-[88%] w-full -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="eyebrow">Specimen Plate · MMXXVI</p>
        </div>
      </div>
    </div>
  );
}

// Used inside SectionHead children for narrative copy that varies per section
void PLATES;

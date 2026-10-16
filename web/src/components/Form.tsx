import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, Music2, Pause, Play, X, Crosshair } from "lucide-react";
import { cn } from "cn";
import { SPRING_LAYOUT, SPRING_SWAP } from "devignerui/motion";

/** Object URL for a file, revoked when the file changes or the component goes. */
export function useObjectUrl(file: File | null | undefined) {
  // created in the effect (not useMemo) so StrictMode's mount/unmount/mount
  // can't revoke a URL that is still on screen
  const [url, setUrl] = React.useState<string>();
  React.useEffect(() => {
    if (!file) return setUrl(undefined);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

export const isVideo = (f: File) => f.type.startsWith("video");

export function Section({ step, title, hint, children, className }: {
  step: number;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-3xl border border-border bg-card/80 p-5 backdrop-blur-sm sm:p-6", className)}>
      <header className="mb-4 flex items-baseline gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-black text-accent-foreground">
          {step}
        </span>
        <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>
        {hint && <span className="ml-auto text-xs font-medium text-muted-foreground">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

/** Drop target that also opens the file picker. */
function DropZone({ accept, multiple, onFiles, children, compact }: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <motion.button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed text-center transition-colors",
        compact ? "px-4 py-5" : "px-6 py-9",
        over ? "border-accent bg-accent/[0.06]" : "border-border bg-muted/40 hover:border-white/20 hover:bg-muted/70",
      )}
    >
      {children}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </motion.button>
  );
}

function Thumb({ file, first, onRemove, onPromote }: {
  file: File;
  first: boolean;
  onRemove: () => void;
  onPromote: () => void;
}) {
  const url = useObjectUrl(file);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={SPRING_LAYOUT}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl bg-black ring-1",
        first ? "ring-2 ring-accent" : "ring-white/10",
      )}
    >
      <button type="button" onClick={onPromote} title={first ? "Opening shot" : "Use as opening shot"} className="absolute inset-0">
        {isVideo(file) ? (
          <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
        ) : (
          <img src={url} alt="" className="h-full w-full object-cover" />
        )}
      </button>
      {first && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-black text-accent-foreground">
          OPENS
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/70 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

export function MediaDrop({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  return (
    <div>
      <DropZone
        accept="video/*,image/*"
        multiple
        compact={files.length > 0}
        onFiles={(add) => onChange([...files, ...add.filter((f) => /^(image|video)\//.test(f.type))].slice(0, 10))}
      >
        <div className="grid size-11 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10 transition group-hover:scale-105">
          <ImagePlus className="size-5 text-accent" />
        </div>
        <p className="text-sm font-bold">
          Drop clips or photos <span className="font-medium text-muted-foreground">or click to pick</span>
        </p>
        <p className="text-xs text-muted-foreground">Pexels / Pixabay · 1–10 files · more files = more cuts</p>
      </DropZone>
      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
          <AnimatePresence initial={false}>
            {files.map((f, i) => (
              <Thumb
                key={`${f.name}-${f.size}-${f.lastModified}`}
                file={f}
                first={i === 0}
                onRemove={() => onChange(files.filter((_, j) => j !== i))}
                onPromote={() => onChange([f, ...files.filter((_, j) => j !== i)])}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function FocusPicker({ file, focus, onChange }: {
  file: File;
  focus: [number, number];
  onChange: (f: [number, number]) => void;
}) {
  const url = useObjectUrl(file);
  const media = React.useRef<HTMLImageElement & HTMLVideoElement>(null);
  const [natural, setNatural] = React.useState<[number, number] | null>(null);
  const area = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<[number, number]>([0, 0]);
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the shown media rect (object-fit: contain leaves bars)
  const [bw, bh] = box;
  const [nw, nh] = natural ?? [16, 9];
  const s = Math.min(bw / nw, bh / nh) || 0;
  const w = nw * s;
  const h = nh * s;
  const ox = (bw - w) / 2;
  const oy = (bh - h) / 2;

  const pick = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left - ox) / w, 0), 1);
    const y = Math.min(Math.max((e.clientY - r.top - oy) / h, 0), 1);
    onChange([+x.toFixed(2), +y.toFixed(2)]);
  };

  const common = {
    ref: media,
    className: "pointer-events-none h-full w-full object-contain",
  };
  return (
    <div>
      <div
        ref={area}
        onPointerDown={pick}
        className="relative aspect-video cursor-crosshair overflow-hidden rounded-2xl bg-black ring-1 ring-white/10"
      >
        {isVideo(file) ? (
          <video {...common} src={url} muted loop autoPlay playsInline onLoadedMetadata={(e) => setNatural([e.currentTarget.videoWidth, e.currentTarget.videoHeight])} />
        ) : (
          <img {...common} src={url} alt="" onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
        )}
        {w > 0 && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute"
            initial={false}
            animate={{ left: ox + focus[0] * w, top: oy + focus[1] * h }}
            transition={SPRING_LAYOUT}
          >
            <motion.span
              key={`${focus[0]},${focus[1]}`}
              className="absolute -top-8 -left-8 size-16 rounded-full border-2 border-accent"
              initial={{ scale: 0.4, opacity: 1 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
            <span className="absolute -top-[15px] -left-[15px] grid size-[30px] place-items-center rounded-full border-[3px] border-accent bg-black/30 shadow-[0_0_0_4px_rgb(0_0_0/0.45),0_0_24px_rgb(255_214_10/0.5)] backdrop-blur-[2px]">
              <span className="size-1.5 rounded-full bg-accent" />
            </span>
          </motion.div>
        )}
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Crosshair className="size-3.5" /> Click the detail the Short opens on (badge, headlight, wheel). It zooms out from there.
      </p>
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function SongDrop({ song, onChange }: { song: File | null; onChange: (f: File | null) => void }) {
  const url = useObjectUrl(song);
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  React.useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [url]);

  const pickFiles = (files: File[]) => {
    const f = files.find((x) => /\.(mp3|wav|m4a)$/i.test(x.name));
    if (f) onChange(f);
  };

  if (!song)
    return (
      <DropZone accept=".mp3,.wav,.m4a,audio/*" onFiles={pickFiles}>
        <div className="grid size-11 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10 transition group-hover:scale-105">
          <Music2 className="size-5 text-accent" />
        </div>
        <p className="text-sm font-bold">
          Drop a phonk track <span className="font-medium text-muted-foreground">mp3 / wav / m4a</span>
        </p>
        <p className="text-xs text-muted-foreground">Use YouTube Audio Library or NCS. Pixabay tracks get claimed.</p>
      </DropZone>
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl border border-border bg-muted/50 p-2.5 pr-3"
    >
      <button
        type="button"
        onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground transition active:scale-95"
      >
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{song.name.replace(/\.[^.]+$/, "")}</p>
        <div
          className="mt-1.5 h-1.5 cursor-pointer overflow-hidden rounded-full bg-white/10"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (audio.current && dur) audio.current.currentTime = ((e.clientX - r.left) / r.width) * dur;
          }}
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} />
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
        {fmt(time)} / {fmt(dur)}
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Remove song"
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <audio
        ref={audio}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
      />
    </motion.div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div role="radiogroup" className="flex rounded-2xl border border-border bg-muted/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative flex-1 rounded-xl px-3 py-2.5 text-sm font-extrabold transition-colors",
            value === o.value ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} transition={SPRING_SWAP} className="absolute inset-0 rounded-xl bg-accent" />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

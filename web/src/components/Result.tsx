import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Copy, Loader2, CloudUpload, Clock, CircleCheck, History } from "lucide-react";
import { cn } from "cn";
import { SPRING_SWAP } from "devignerui/motion";
import { getJob, JobGone, type JobStatus, type UploadText } from "../lib/api";
import type { Recent } from "../lib/store";

/** Typical render time (s), for the progress bar's pace. */
const TYPICAL = 200;

const LABEL: Record<JobStatus, string> = {
  uploading: "Uploading",
  queued: "Queued on GitHub",
  rendering: "Rendering",
  done: "Ready",
  error: "Failed",
};

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function StatusLine({ status, name, created, upload }: {
  status: JobStatus;
  name: string;
  /** Job start, unix seconds. */
  created?: number;
  /** Upload progress 0-1 while uploading. */
  upload?: number;
}) {
  const busy = status !== "done" && status !== "error";
  const now = useNow(busy);
  const secs = created ? Math.max(0, Math.round(now / 1000 - created)) : 0;
  const ratio =
    status === "uploading" ? (upload ?? 0) : status === "done" ? 1 : Math.min(0.95, secs / TYPICAL);
  const Icon =
    status === "uploading" ? CloudUpload : status === "queued" ? Clock : status === "rendering" ? Loader2 : status === "done" ? CircleCheck : CircleAlert;
  return (
    <div className="mt-4" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Icon
          className={cn(
            "size-[18px] shrink-0",
            status === "rendering" && "animate-spin",
            status === "done" ? "text-ok" : status === "error" ? "text-danger" : "text-accent",
          )}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING_SWAP}
            className="text-sm font-extrabold"
          >
            {LABEL[status]}
            {status === "uploading" && ` ${Math.round((upload ?? 0) * 100)}%`}
          </motion.span>
        </AnimatePresence>
        <span className="ml-auto truncate text-xs font-semibold text-muted-foreground">
          {name}
          {busy && created ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}
        </span>
      </div>
      {status !== "error" && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className={cn("h-full rounded-full", status === "done" ? "bg-ok" : "bg-accent")}
            initial={false}
            animate={{ width: `${ratio * 100}%` }}
            transition={{ type: "spring", stiffness: 60, damping: 20 }}
          />
        </div>
      )}
    </div>
  );
}

function CopyField({ label, value, rows }: { label: string; value: string; rows: number }) {
  const [text, setText] = React.useState(value);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setText(value), [value]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">{label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1300);
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition",
            copied ? "bg-ok/15 text-ok" : "bg-white/[0.06] text-foreground hover:bg-white/10",
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={String(copied)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </motion.span>
          </AnimatePresence>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea
        value={text}
        rows={rows}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent/60"
      />
    </div>
  );
}

export function UploadFields({ upload }: { upload: UploadText }) {
  const fields: [string, string | undefined, number][] = [
    ["Title", upload.title, 2],
    ["Description", upload.description, 8],
    ["Tags", upload.tags, 3],
    ["Pin comment", upload.pin, 1],
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mt-5 space-y-4"
    >
      {fields.filter(([, v]) => v).map(([k, v, rows]) => (
        <CopyField key={k} label={k} value={v!} rows={rows} />
      ))}
    </motion.div>
  );
}

const ago = (t: number) => {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

type RowStatus = JobStatus | "expired" | "offline" | "…";

const PILL: Record<string, string> = {
  done: "bg-ok/15 text-ok",
  error: "bg-danger/15 text-danger",
  queued: "bg-accent/15 text-accent",
  rendering: "bg-accent/15 text-accent",
  uploading: "bg-accent/15 text-accent",
};

export function RecentList({ items, activeId, refreshKey, onOpen }: {
  items: Recent[];
  activeId?: string;
  /** Change to re-fetch statuses. */
  refreshKey: unknown;
  onOpen: (id: string) => void;
}) {
  const [status, setStatus] = React.useState<Record<string, RowStatus>>({});
  React.useEffect(() => {
    let alive = true;
    items.forEach((it) =>
      getJob(it.id)
        .then((j) => alive && setStatus((s) => ({ ...s, [it.id]: j.status })))
        .catch((e) => alive && setStatus((s) => ({ ...s, [it.id]: e instanceof JobGone ? "expired" : "offline" }))),
    );
    return () => {
      alive = false;
    };
  }, [items, refreshKey]);

  if (!items.length) return null;
  return (
    <section id="recent" className="mt-6 scroll-mt-24 rounded-3xl border border-border bg-card/80 p-4 backdrop-blur-sm">
      <h3 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">
        <History className="size-3.5" /> Recent Shorts
      </h3>
      <ul>
        {items.map((it) => {
          const st = status[it.id] ?? "…";
          const gone = st === "expired";
          return (
            <li key={it.id}>
              <button
                type="button"
                disabled={gone}
                onClick={() => onOpen(it.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition",
                  gone ? "opacity-40" : "hover:bg-white/[0.04]",
                  activeId === it.id && "bg-white/[0.05]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{it.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(it.created)}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", PILL[st] ?? "bg-white/[0.06] text-muted-foreground")}>
                  {st}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 px-1 text-xs text-muted-foreground">Videos are kept for 6 hours. Download the ones you want.</p>
    </section>
  );
}

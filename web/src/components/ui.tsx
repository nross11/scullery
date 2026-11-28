import { useEffect, useState, type ReactNode } from 'react';

export function Logo({ size = 28 }: { size?: number }) {
  // A pot drawn in neon: lime body, hot-pink steam.
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 28h40v12c0 8-6 13-13 13H25c-7 0-13-5-13-13V28z" stroke="#c6ff3d" strokeWidth="3.5" />
      <path d="M8 28h48" stroke="#c6ff3d" strokeWidth="3.5" />
      <path d="M52 33h5M7 33h5" stroke="#c6ff3d" strokeWidth="3.5" />
      <path d="M24 21c0-4 4-4 4-8M32 21c0-4 4-4 4-8M40 21c0-4 4-4 4-8" stroke="#ff3d81" strokeWidth="3" />
    </svg>
  );
}

export function Sheet({ onClose, children, title }: { onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (!value) return null;
  return <span className="stars" aria-label={`${value} out of 5`}>{'★'.repeat(value)}{'☆'.repeat(5 - value)}</span>;
}

export function StarInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="star-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} className={value && n <= value ? 'on' : ''} onClick={() => onChange(value === n ? null : n)} aria-label={`${n} stars`}>★</button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

let toastSetter: ((s: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSetter?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Simple data loader hook. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn().then((d) => alive && setData(d)).catch((e) => alive && setError(String(e.message || e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

export function minutes(m: number | null | undefined): string | null {
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

export function prettyDate(d: string): string {
  const date = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const Icon = {
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  basket: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18l-2 10H5L3 10z" /><path d="M8 10l4-6 4 6" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" strokeLinecap="round" /></svg>,
};

/** Recipe photo with a warm placeholder when there's no image or it fails to load. */
export function Thumb({ src, title, className }: { src: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={className}>{title.slice(0, 1)}</div>;
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

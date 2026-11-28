import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe } from '../api';
import { scaleIngredient } from '../../../shared/ingredients';
import { Sheet } from '../components/ui';

/** Keep the screen on while cooking. Uses the Wake Lock API (Safari on iOS 16.4+ supports it). */
function useWakeLock() {
  const [active, setActive] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock.current = await navigator.wakeLock.request('screen');
          if (!cancelled) setActive(true);
          lock.current.addEventListener('release', () => setActive(false));
        }
      } catch {
        setActive(false);
      }
    }
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock.current?.release().catch(() => {});
    };
  }, []);
  return active;
}

/** Find minutes/hours in a step so we can offer a one-tap timer. */
function findTimer(step: string): number | null {
  const m = step.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+)?\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (!m) return null;
  const n = parseFloat(m[2] ?? m[1]);
  return /^h/i.test(m[3]) ? n * 3600 : n * 60;
}

export default function CookMode({ recipe, factor, onClose }: { recipe: Recipe; factor: number; onClose: () => void }) {
  const steps = useMemo(
    () => recipe.body.steps.flatMap((g) => g.steps.map((s) => ({ group: g.title, text: s }))),
    [recipe],
  );
  const [i, setI] = useState(0);
  const [showIng, setShowIng] = useState(false);
  const [timer, setTimer] = useState<{ end: number; total: number } | null>(null);
  const [nowTs, setNow] = useState(Date.now());
  const awake = useWakeLock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length, onClose]);

  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timer]);

  const remaining = timer ? Math.max(0, Math.round((timer.end - nowTs) / 1000)) : 0;
  useEffect(() => {
    if (timer && remaining === 0) {
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported on iOS */ }
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 900);
    }
  }, [remaining, timer]);

  const step = steps[i];
  const stepTimer = step ? findTimer(step.text) : null;

  return (
    <div className="cook-mode">
      <div className="spread">
        <button className="ghost" onClick={onClose}>✕ Done</button>
        <span className="small muted">{awake ? 'Screen stays on' : ''}</span>
        <button className="small" onClick={() => setShowIng(true)}>Ingredients</button>
      </div>
      <div className="progress" style={{ marginTop: 8 }}><div style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      <div className="spread small muted" style={{ marginTop: 8 }}>
        <span>Step {i + 1} of {steps.length}{step?.group ? ` · ${step.group}` : ''}</span>
        <span>{recipe.title}</span>
      </div>
      <div className="step-text" onClick={() => setI((x) => Math.min(steps.length - 1, x + 1))}>{step?.text}</div>
      {(stepTimer || timer) && (
        <div className="row" style={{ justifyContent: 'center', marginBottom: 12 }}>
          {timer ? (
            <>
              <strong style={{ fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums' }}>
                {remaining === 0 ? "Time's up!" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
              </strong>
              <button className="small" onClick={() => setTimer(null)}>Clear timer</button>
            </>
          ) : (
            stepTimer && <button onClick={() => setTimer({ end: Date.now() + stepTimer * 1000, total: stepTimer })}>⏱ Start {stepTimer >= 3600 ? `${stepTimer / 3600} hr` : `${stepTimer / 60} min`} timer</button>
          )}
        </div>
      )}
      <div className="nav">
        <button disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
        {i < steps.length - 1 ? <button className="primary" onClick={() => setI(i + 1)}>Next →</button> : <button className="primary" onClick={onClose}>Finish</button>}
      </div>
      {showIng && (
        <Sheet title="Ingredients" onClose={() => setShowIng(false)}>
          {recipe.body.ingredients.map((g, gi) => (
            <div key={gi} className="ingredients">
              {g.title && <div className="group-title">{g.title}</div>}
              <ul>{g.items.map((ing, ii) => <li key={ii} style={{ cursor: 'default', fontSize: '1.1rem' }}>{scaleIngredient(ing, factor)}</li>)}</ul>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

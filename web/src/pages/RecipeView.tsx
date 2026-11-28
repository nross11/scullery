import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type CookLog, type Recipe } from '../api';
import { Sheet, Spinner, StarInput, Stars, isoDate, minutes, prettyDate, toast, useLoad } from '../components/ui';
import { scaleIngredient } from '../../../shared/ingredients';
import CookMode from './CookMode';

export function useScale(base: number | null, initial?: number | null) {
  const [servings, setServings] = useState<number | null>(initial ?? base);
  useEffect(() => setServings(initial ?? base), [base, initial]);
  const factor = base && servings ? servings / base : 1;
  return { servings, setServings, factor };
}

export function Scaler({ servings, setServings, base, label }: { servings: number | null; setServings: (n: number) => void; base: number | null; label?: string | null }) {
  if (!base || !servings) return null;
  const step = servings > 1 ? 1 : 0.5;
  return (
    <div className="scaler" aria-label="Servings">
      <button onClick={() => setServings(Math.max(0.5, servings - step))} aria-label="Fewer servings">−</button>
      <span>{servings} {label && servings === base ? label.replace(/^\d+\s*/, '') : servings === 1 ? 'serving' : 'servings'}</span>
      <button onClick={() => setServings(servings + (servings >= 1 ? 1 : 0.5))} aria-label="More servings">+</button>
    </div>
  );
}

export default function RecipeView({ cookMode = false }: { cookMode?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: r, error, reload } = useLoad(() => api.get<Recipe>(`/recipes/${id}`), [id]);
  const [params] = useSearchParams();
  const initialServings = parseFloat(params.get('servings') ?? '') || null;
  const { servings, setServings, factor } = useScale(r?.body.servings ?? null, initialServings);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [logSheet, setLogSheet] = useState<CookLog | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<CookLog | null>(null);
  const [planSheet, setPlanSheet] = useState(false);

  const totalTime = useMemo(() => {
    if (!r) return null;
    const b = r.body;
    return b.totalMinutes ?? (b.prepMinutes || b.cookMinutes ? (b.prepMinutes ?? 0) + (b.cookMinutes ?? 0) : null);
  }, [r]);

  if (error) return <p className="error">{error}</p>;
  if (!r) return <Spinner />;
  const b = r.body;

  if (cookMode) return <CookMode recipe={r} factor={factor} onClose={() => nav(`/recipes/${r.id}${initialServings ? `?servings=${initialServings}` : ''}`)} />;

  const toggle = (key: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const hasSteps = b.steps.some((g) => g.steps.length);
  const hasIngredients = b.ingredients.some((g) => g.items.length);
  const sourceHost = r.sourceUrl ? (() => { try { return new URL(r.sourceUrl).hostname.replace(/^www\./, ''); } catch { return r.sourceUrl; } })() : null;

  return (
    <>
      <div className="spread" style={{ marginBottom: 8 }}>
        <Link to="/" className="btn ghost small">← Recipes</Link>
        <div className="row">
          <Link to={`/recipes/${r.id}/history`} className="btn ghost small">History (v{r.versionNo})</Link>
          <Link to={`/recipes/${r.id}/edit`} className="btn small">Edit</Link>
        </div>
      </div>
      {r.imageUrl && (
        <div className="hero"><img src={r.imageUrl} alt="" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} /></div>
      )}
      <h1 className="recipe-title">{r.title}</h1>
      {b.description && <p className="muted">{b.description}</p>}
      {!!r.tags.length && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {r.tags.map((t) => <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="chip">{t}</Link>)}
        </div>
      )}
      <div className="facts">
        {b.prepMinutes ? <div className="fact">Prep<strong>{minutes(b.prepMinutes)}</strong></div> : null}
        {b.cookMinutes ? <div className="fact">Cook<strong>{minutes(b.cookMinutes)}</strong></div> : null}
        {totalTime ? <div className="fact">Total<strong>{minutes(totalTime)}</strong></div> : null}
        {r.cookLogs.length ? <div className="fact">Cooked<strong>{r.cookLogs.length}×</strong></div> : null}
      </div>
      <div className="action-bar">
        {hasSteps && <Link to={`/recipes/${r.id}/cook${servings && servings !== b.servings ? `?servings=${servings}` : ''}`} className="btn btn-primary">Start cooking</Link>}
        <button onClick={() => setLogSheet('new')}>Log a cook</button>
        <button onClick={() => setPlanSheet(true)}>Add to plan</button>
      </div>

      {b.rawText && !hasIngredients && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="spread"><strong>Saved caption</strong><Link to={`/recipes/${r.id}/edit?tidy=1`} className="btn small">Tidy into a recipe</Link></div>
          <div className="raw-text" style={{ marginTop: 8 }}>{b.rawText}</div>
        </div>
      )}

      <div className="two-col">
        {hasIngredients && (
          <section className="ingredients">
            <div className="spread" style={{ marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>Ingredients</h2>
              <Scaler servings={servings} setServings={setServings} base={b.servings} label={b.servingsLabel} />
            </div>
            {b.ingredients.map((g, gi) => (
              <div key={gi}>
                {g.title && <div className="group-title">{g.title}</div>}
                <ul>
                  {g.items.map((ing, ii) => {
                    const key = `${gi}-${ii}`;
                    return (
                      <li key={key} className={checked.has(key) ? 'checked' : ''} onClick={() => toggle(key)}>
                        <span className="tick">{checked.has(key) ? '✓' : ''}</span>
                        <span>{scaleIngredient(ing, factor)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
        {hasSteps && (
          <section className="steps">
            <h2>Method</h2>
            {b.steps.map((g, gi) => (
              <div key={gi}>
                {g.title && <div className="group-title">{g.title}</div>}
                <ol>{g.steps.map((s, si) => <li key={si}>{s}</li>)}</ol>
              </div>
            ))}
          </section>
        )}
      </div>

      {b.notes && (
        <section className="section">
          <h2>Notes</h2>
          <p className="notes">{b.notes}</p>
        </section>
      )}

      {r.sourceUrl && (
        <p className="small muted section">
          Source: <a href={r.sourceUrl} target="_blank" rel="noreferrer">{sourceHost}</a>{b.author ? ` · ${b.author}` : ''}
        </p>
      )}

      <section className="section">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Cook log</h2>
          <button className="small" onClick={() => setLogSheet('new')}>+ Log</button>
        </div>
        {!r.cookLogs.length && <p className="muted">No cooks logged yet. After you make it, note how it went and what to change.</p>}
        <div style={{ marginTop: 12 }}>
          {r.cookLogs.map((l) => (
            <div key={l.id} className="log">
              <div className="spread">
                <strong>{prettyDate(l.cooked_on)}</strong>
                <Stars value={l.rating} />
              </div>
              <div className="small muted">{l.author_name ?? ''}{l.version_no ? ` · recipe v${l.version_no}` : ''}</div>
              {l.how_it_went && <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{l.how_it_went}</p>}
              {l.next_time && <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}><strong>Next time:</strong> {l.next_time}</p>}
              <div className="row">
                <button className="ghost small" onClick={() => setLogSheet(l)}>Edit</button>
                {l.next_time && <Link className="btn ghost small" to={`/recipes/${r.id}/edit?fromLog=${l.id}`}>Apply to recipe</Link>}
                {l.revisions > 0 && <button className="ghost small" onClick={() => setHistoryFor(l)}>Edit history ({l.revisions})</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="section row">
        <button className="danger small" onClick={async () => {
          if (!confirm(`Remove "${r.title}" from your recipes?`)) return;
          await api.del(`/recipes/${r.id}`);
          nav('/');
        }}>Remove recipe</button>
      </div>

      {logSheet && <CookLogSheet recipeId={r.id} log={logSheet === 'new' ? null : logSheet} onClose={() => setLogSheet(null)} onSaved={() => { setLogSheet(null); reload(); }} />}
      {historyFor && <LogHistorySheet log={historyFor} onClose={() => setHistoryFor(null)} onRestored={() => { setHistoryFor(null); reload(); }} />}
      {planSheet && <AddToPlanSheet recipe={r} servings={servings} onClose={() => setPlanSheet(false)} />}
    </>
  );
}

function CookLogSheet({ recipeId, log, onClose, onSaved }: { recipeId: string; log: CookLog | null; onClose: () => void; onSaved: () => void }) {
  const [cookedOn, setCookedOn] = useState(log?.cooked_on ?? isoDate(new Date()));
  const [rating, setRating] = useState<number | null>(log?.rating ?? null);
  const [howItWent, setHow] = useState(log?.how_it_went ?? '');
  const [nextTime, setNext] = useState(log?.next_time ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const payload = { cookedOn, rating, howItWent: howItWent.trim() || null, nextTime: nextTime.trim() || null };
    if (log) await api.put(`/cook-logs/${log.id}`, payload);
    else await api.post('/cook-logs', { ...payload, recipeId });
    toast(log ? 'Log updated' : 'Cook logged');
    onSaved();
  }

  return (
    <Sheet title={log ? 'Edit cook log' : 'Log a cook'} onClose={onClose}>
      <div className="field"><label>Date</label><input type="date" value={cookedOn} onChange={(e) => setCookedOn(e.target.value)} /></div>
      <div className="field"><label>Rating</label><StarInput value={rating} onChange={setRating} /></div>
      <div className="field"><label>How did it go?</label><textarea value={howItWent} onChange={(e) => setHow(e.target.value)} placeholder="Too salty, kids loved it, took longer than it said…" /></div>
      <div className="field"><label>What to change next time</label><textarea value={nextTime} onChange={(e) => setNext(e.target.value)} placeholder="Half the chilli, roast 10 min longer…" /></div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>Save</button>
        {log && <button className="danger" disabled={busy} onClick={async () => { if (confirm('Delete this log entry? It stays in edit history.')) { await api.del(`/cook-logs/${log.id}`); onSaved(); } }}>Delete</button>}
      </div>
    </Sheet>
  );
}

function LogHistorySheet({ log, onClose, onRestored }: { log: CookLog; onClose: () => void; onRestored: () => void }) {
  const { data } = useLoad(() => api.get<{ revisions: { id: string; edited_at: string; editor_name: string | null; snapshot: any }[] }>(`/cook-logs/${log.id}/revisions`), [log.id]);
  return (
    <Sheet title="Cook log edit history" onClose={onClose}>
      {!data && <Spinner />}
      {data?.revisions.map((rev) => (
        <div key={rev.id} className="log">
          <div className="small muted">Before edit on {new Date(rev.edited_at).toLocaleString()}{rev.editor_name ? ` by ${rev.editor_name}` : ''}</div>
          <div className="spread"><strong>{prettyDate(rev.snapshot.cooked_on)}</strong><Stars value={rev.snapshot.rating} /></div>
          {rev.snapshot.how_it_went && <p style={{ margin: '4px 0' }}>{rev.snapshot.how_it_went}</p>}
          {rev.snapshot.next_time && <p style={{ margin: '4px 0' }}><strong>Next time:</strong> {rev.snapshot.next_time}</p>}
          <button className="small" onClick={async () => { await api.post(`/cook-logs/${log.id}/revisions/${rev.id}/restore`); toast('Restored'); onRestored(); }}>Restore this</button>
        </div>
      ))}
    </Sheet>
  );
}

function AddToPlanSheet({ recipe, servings, onClose }: { recipe: Recipe; servings: number | null; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [meal, setMeal] = useState('dinner');
  const [n, setN] = useState<string>(servings ? String(servings) : '');
  const days = Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  return (
    <Sheet title="Add to meal plan" onClose={onClose}>
      <div className="chip-scroll">
        {days.map((d) => {
          const iso = isoDate(d);
          return <button key={iso} className={`chip ${iso === date ? 'active' : ''}`} onClick={() => setDate(iso)}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</button>;
        })}
      </div>
      <div className="grid2">
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Meal</label>
          <select value={meal} onChange={(e) => setMeal(e.target.value)}>
            <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="other">Other</option>
          </select>
        </div>
      </div>
      {recipe.body.servings ? <div className="field"><label>Servings</label><input type="number" inputMode="decimal" min="0.5" step="0.5" value={n} onChange={(e) => setN(e.target.value)} /></div> : null}
      <button className="primary" onClick={async () => {
        await api.post('/plan', { planDate: date, meal, recipeId: recipe.id, servings: n ? parseFloat(n) : null });
        toast(`Added to ${prettyDate(date)}`);
        onClose();
      }}>Add</button>
    </Sheet>
  );
}

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PlanEntry, type RecipeSummary } from '../api';
import { Sheet, Spinner, Thumb, isoDate, toast, useLoad } from '../components/ui';
import { TopBar } from '../App';

/** The plan is a rolling 7 days starting today. */
function startOfToday(): Date {
  const x = new Date();
  x.setHours(12, 0, 0, 0);
  return x;
}

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'other'];

export default function Planner() {
  const nav = useNavigate();
  const [week, setWeek] = useState(startOfToday);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d; }), [week]);
  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const { data, reload } = useLoad(() => api.get<PlanEntry[]>(`/plan?from=${from}&to=${to}`), [from]);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = isoDate(new Date());

  const shift = (n: number) => { const d = new Date(week); d.setDate(d.getDate() + n * 7); setWeek(d); };

  async function makeList() {
    setBusy(true);
    const { id } = await api.post<{ id: string }>('/shopping/generate', {
      from, to, name: `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
    });
    nav(`/shopping/${id}`);
  }

  return (
    <>
      <TopBar />
      <div className="spread" style={{ marginBottom: 12 }}>
        <button className="small" onClick={() => shift(-1)} aria-label="Previous week">←</button>
        <h2 style={{ margin: 0 }}>{days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</h2>
        <button className="small" onClick={() => shift(1)} aria-label="Next week">→</button>
      </div>
      {from !== today && (
        <div style={{ textAlign: 'center', marginTop: -6, marginBottom: 10 }}>
          <button className="ghost small" onClick={() => setWeek(startOfToday())}>Back to today</button>
        </div>
      )}
      {!data && <Spinner />}
      {data && days.map((d) => {
        const iso = isoDate(d);
        const items = data.filter((p) => p.plan_date === iso).sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
        return (
          <div key={iso} className={`week-day ${iso === today ? 'today' : ''}`}>
            <div className="day-label">
              <span>{d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}{iso === today ? ' · today' : ''}</span>
              <button className="ghost small" onClick={() => setAdding(iso)}>+ Add</button>
            </div>
            {items.map((p) => (
              <div key={p.id} className="plan-item">
                <Thumb className="ph" src={p.image_key} title="" />
                <div className="grow">
                  {p.recipe_id ? <Link to={`/recipes/${p.recipe_id}`}>{p.recipe_title}</Link> : <strong>{p.note}</strong>}
                  <div className="small muted">{p.meal}{p.servings ? ` · ${p.servings} servings` : ''}</div>
                </div>
                <button className="ghost small" aria-label="Remove" onClick={async () => { await api.del(`/plan/${p.id}`); reload(); }}>✕</button>
              </div>
            ))}
          </div>
        );
      })}
      {data && (
        <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy || !data.some((p) => p.recipe_id)} onClick={makeList}>
          Make shopping list for these 7 days
        </button>
      )}
      {adding && <PickRecipeSheet date={adding} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); reload(); }} />}
    </>
  );
}

function PickRecipeSheet({ date, onClose, onAdded }: { date: string; onClose: () => void; onAdded: () => void }) {
  const { data } = useLoad(() => api.get<RecipeSummary[]>('/recipes'), []);
  const [q, setQ] = useState('');
  const [meal, setMeal] = useState('dinner');
  const shown = (data ?? []).filter((r) => r.title.toLowerCase().includes(q.toLowerCase()));
  const add = async (body: Record<string, unknown>) => {
    await api.post('/plan', { planDate: date, meal, ...body });
    toast('Added');
    onAdded();
  };
  return (
    <Sheet title="Add to plan" onClose={onClose}>
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 10 }}>
        <input type="search" placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select value={meal} onChange={(e) => setMeal(e.target.value)} style={{ width: 'auto' }}>
          <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="other">Other</option>
        </select>
      </div>
      {!data && <Spinner />}
      {shown.map((r) => (
        <div key={r.id} className="plan-item" style={{ cursor: 'pointer' }} onClick={() => add({ recipeId: r.id })}>
          <Thumb className="ph" src={r.image_key} title="" />
          <div className="grow"><strong>{r.title}</strong></div>
        </div>
      ))}
      {q.trim() && <button style={{ marginTop: 8 }} onClick={() => add({ note: q.trim() })}>Add "{q.trim()}" as a note</button>}
    </Sheet>
  );
}

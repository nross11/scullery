import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Spinner, useLoad } from '../components/ui';
import { TopBar } from '../App';
import { formatQuantity } from '../../../shared/ingredients';

interface ListRow { id: string; name: string; created_at: string; total: number; done: number }
interface Item { id: string; name: string; quantity: number | null; unit: string | null; aisle: string; checked: number; sources: string[] }

export default function Shopping() {
  const nav = useNavigate();
  const { data } = useLoad(() => api.get<ListRow[]>('/shopping'), []);
  return (
    <>
      <TopBar />
      <h1>Shopping lists</h1>
      <p className="muted small">Make a list from the week's meal plan on the Plan tab, or start an empty one.</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <Link to="/plan" className="btn btn-primary">From meal plan</Link>
        <button onClick={async () => {
          const today = new Date().toISOString().slice(0, 10);
          const { id } = await api.post<{ id: string }>('/shopping', { name: `List ${today}` });
          nav(`/shopping/${id}`);
        }}>Empty list</button>
      </div>
      {!data && <Spinner />}
      {data && !data.length && <p className="empty">No lists yet.</p>}
      {data?.map((l) => (
        <Link key={l.id} to={`/shopping/${l.id}`} className="plan-item" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="grow"><strong>{l.name}</strong><div className="small muted">{l.done}/{l.total} ticked</div></div>
          <span className="muted">›</span>
        </Link>
      ))}
    </>
  );
}

export function ShoppingListView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, reload } = useLoad(() => api.get<{ id: string; name: string; items: Item[]; aisles: string[] }>(`/shopping/${id}`), [id]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [newItem, setNewItem] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const list = items ?? data?.items ?? null;

  if (!data || !list) return <Spinner />;

  async function toggle(it: Item) {
    const next = list!.map((x) => (x.id === it.id ? { ...x, checked: x.checked ? 0 : 1 } : x));
    setItems(next);
    await api.put(`/shopping/${id}/items/${it.id}`, { checked: !it.checked });
  }

  async function add() {
    if (!newItem.trim()) return;
    await api.post(`/shopping/${id}/items`, { name: newItem.trim() });
    setNewItem('');
    setItems(null);
    reload();
  }

  const byAisle = data.aisles
    .map((a) => ({ aisle: a, items: list.filter((i) => i.aisle === a && (!hideDone || !i.checked)) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div className="spread" style={{ marginBottom: 8 }}>
        <Link to="/shopping" className="btn ghost small">← Lists</Link>
        <button className="ghost small" onClick={() => setHideDone(!hideDone)}>{hideDone ? 'Show ticked' : 'Hide ticked'}</button>
      </div>
      <h1>{data.name}</h1>
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 8 }}>
        <input placeholder="Add an item" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add}>Add</button>
      </div>
      {byAisle.map((g) => (
        <div key={g.aisle} className="aisle">
          <h3>{g.aisle}</h3>
          {g.items.map((it) => (
            <label key={it.id} className={`shop-item ${it.checked ? 'checked' : ''}`} style={{ margin: 0, fontWeight: 400, fontSize: '1rem', color: 'inherit' }}>
              <input type="checkbox" checked={!!it.checked} onChange={() => toggle(it)} />
              <span className="label">
                {it.quantity ? <strong>{formatQuantity(it.quantity)}{it.unit ? ` ${it.unit}` : ''} </strong> : null}{it.name}
                {!!it.sources.length && <div className="src">{it.sources.join(', ')}</div>}
              </span>
              <button className="ghost small" aria-label="Remove" onClick={async (e) => { e.preventDefault(); await api.del(`/shopping/${id}/items/${it.id}`); setItems(list.filter((x) => x.id !== it.id)); }}>✕</button>
            </label>
          ))}
        </div>
      ))}
      {!list.length && <p className="empty">Nothing on this list yet.</p>}
      <div className="section">
        <button className="danger small" onClick={async () => { if (confirm('Delete this list?')) { await api.del(`/shopping/${id}`); nav('/shopping'); } }}>Delete list</button>
      </div>
    </>
  );
}

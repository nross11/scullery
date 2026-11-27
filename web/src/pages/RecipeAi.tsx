import { useEffect, useRef, useState } from 'react';
import { api, type HealthierProposal, type Recipe } from '../api';
import { Sheet, Spinner, toast } from '../components/ui';
import { ingredientsToText, lineDiff, stepsToText } from '../../../shared/editorText';

/** Ask Claude for a healthier version and save it as a new recipe version if accepted. */
export function HealthierSheet({ recipe, onClose, onSaved }: { recipe: Recipe; onClose: () => void; onSaved: () => void }) {
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<HealthierProposal | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setP(await api.post<HealthierProposal>(`/recipes/${recipe.id}/ai/healthier`, { goal: goal.trim() || null }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function accept() {
    if (!p) return;
    setBusy(true);
    try {
      const { versionNo } = await api.put<{ versionNo: number }>(`/recipes/${recipe.id}`, { title: p.title, body: p.body, changeNote: p.summary });
      toast(`Saved as version ${versionNo}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const ingDiff = p ? lineDiff(ingredientsToText(recipe.body.ingredients), ingredientsToText(p.body.ingredients)) : [];
  const stepDiff = p ? lineDiff(stepsToText(recipe.body.steps), stepsToText(p.body.steps)) : [];
  const changed = (d: typeof ingDiff) => d.some((l) => l.type !== 'same');

  return (
    <Sheet title="Make it healthier" onClose={onClose}>
      {!p && (
        <>
          <div className="field">
            <label htmlFor="goal">Anything in particular? (optional)</label>
            <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Less fat, more protein, lower salt, dairy-free…" />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={ask}>{busy ? 'Claude is thinking…' : 'Suggest changes'}</button>
          {busy && <p className="hint">This usually takes 10 to 30 seconds.</p>}
        </>
      )}
      {p && (
        <>
          <ul style={{ paddingLeft: 20, marginTop: 0 }}>
            {p.changes.map((c, i) => (
              <li key={i} style={{ marginBottom: 6 }}><strong>{c.change}</strong><br /><span className="small muted">{c.why}</span></li>
            ))}
          </ul>
          {changed(ingDiff) && <DiffBlock title="Ingredients" diff={ingDiff} />}
          {changed(stepDiff) && <DiffBlock title="Method" diff={stepDiff} />}
          <p className="hint">Accepting saves this as version {recipe.versionNo + 1}. You can go back to the current version any time from History.</p>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="primary" disabled={busy} onClick={accept}>Accept as new version</button>
            <button className="ghost" disabled={busy} onClick={() => setP(null)}>Try again</button>
            <button className="ghost" disabled={busy} onClick={onClose}>Discard</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function DiffBlock({ title, diff }: { title: string; diff: { type: 'same' | 'add' | 'del'; text: string }[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="group-title">{title}</div>
      <div className="diff">
        {diff.filter((l) => l.text.trim()).map((l, i) => (
          <div key={i} className={l.type}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text}</div>
        ))}
      </div>
    </div>
  );
}

interface Turn { role: 'user' | 'assistant'; content: string }

/** Chat with Claude about the recipe. The conversation isn't saved. */
export function ChatSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [turns, busy]);

  async function send(text = q) {
    const question = text.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setQ('');
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api.post<{ reply: string }>(`/recipes/${recipe.id}/ai/chat`, { messages: next });
      setTurns([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns(turns);
      setQ(question);
    }
    setBusy(false);
  }

  const starters = ['What can I use instead of…?', 'Can I make this ahead?', 'What goes well with this?'];

  return (
    <Sheet title="Ask Claude" onClose={onClose}>
      {!turns.length && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {starters.map((s) => (
            <button key={s} className="chip" onClick={() => (s.endsWith('…?') ? setQ('What can I use instead of ') : send(s))}>{s}</button>
          ))}
        </div>
      )}
      <div className="chat">
        {turns.map((t, i) => <div key={i} className={`bubble ${t.role}`}>{t.content}</div>)}
        {busy && <div className="bubble assistant"><Spinner /></div>}
        <div ref={end} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="row" style={{ flexWrap: 'nowrap', marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${recipe.title}`} aria-label="Your question" />
        <button className="primary" disabled={busy || !q.trim()} type="submit">Ask</button>
      </form>
    </Sheet>
  );
}

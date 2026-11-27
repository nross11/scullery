import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Recipe } from '../api';
import { Spinner, prettyDate, toast, useLoad } from '../components/ui';
import { ingredientsToText, stepsToText, textToIngredients, textToSteps } from '../../../shared/editorText';
import type { RecipeBody } from '../../../shared/recipe';

function num(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function RecipeEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const tidy = params.get('tidy') === '1';
  const fromLog = params.get('fromLog');
  const { data: r } = useLoad(() => api.get<Recipe>(`/recipes/${id}`), [id]);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const log = fromLog ? r?.cookLogs.find((l) => l.id === fromLog) : null;

  useEffect(() => {
    if (!r || f) return;
    const b = r.body;
    setF({
      title: r.title,
      description: b.description ?? '',
      servings: b.servings ? String(b.servings) : '',
      servingsLabel: b.servingsLabel ?? '',
      prep: b.prepMinutes ? String(b.prepMinutes) : '',
      cook: b.cookMinutes ? String(b.cookMinutes) : '',
      total: b.totalMinutes ? String(b.totalMinutes) : '',
      ingredients: ingredientsToText(b.ingredients),
      steps: stepsToText(b.steps),
      notes: b.notes ?? '',
      rawText: b.rawText ?? '',
      tags: r.tags.join(', '),
      imageUrl: r.imageUrl ?? '',
      sourceUrl: r.sourceUrl ?? '',
      changeNote: '',
    });
  }, [r, f]);

  if (!r || !f) return <Spinner />;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!r || !f) return;
    setBusy(true);
    const body: RecipeBody = {
      ...r.body,
      description: f.description.trim() || null,
      servings: num(f.servings),
      servingsLabel: f.servingsLabel.trim() || null,
      prepMinutes: num(f.prep),
      cookMinutes: num(f.cook),
      totalMinutes: num(f.total),
      ingredients: textToIngredients(f.ingredients),
      steps: textToSteps(f.steps),
      notes: f.notes.trim() || null,
      rawText: f.rawText.trim() || null,
    };
    await api.put(`/recipes/${r.id}`, {
      title: f.title,
      body,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      imageUrl: f.imageUrl.trim() || null,
      sourceUrl: f.sourceUrl.trim() || null,
      changeNote: f.changeNote.trim() || (log ? `Changes from cook on ${prettyDate(log.cooked_on)}` : undefined),
      fromCookLogId: log?.id,
    });
    toast('Saved');
    nav(`/recipes/${r.id}`, { replace: true });
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const url = await api.upload(file);
      setF((cur) => (cur ? { ...cur, imageUrl: url } : cur));
    } finally {
      setBusy(false);
    }
  }

  const appendNote = () => {
    if (!log?.next_time) return;
    setF({ ...f, notes: [f.notes.trim(), `${prettyDate(log.cooked_on)}: ${log.next_time}`].filter(Boolean).join('\n') });
  };

  return (
    <>
      <div className="spread" style={{ marginBottom: 12 }}>
        <Link to={`/recipes/${r.id}`} className="btn ghost small">Cancel</Link>
        <button className="primary small" disabled={busy} onClick={save}>Save</button>
      </div>
      <h1>{tidy ? 'Tidy up recipe' : 'Edit recipe'}</h1>

      {log && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--terracotta)' }}>
          <strong>Your notes from {prettyDate(log.cooked_on)}</strong>
          {log.how_it_went && <p style={{ margin: '6px 0' }}>{log.how_it_went}</p>}
          <p style={{ margin: '6px 0' }}><strong>Next time:</strong> {log.next_time}</p>
          <p className="hint">Edit the ingredients or steps below to apply these. The change is saved as a new version linked to this cook.</p>
          <button className="small" onClick={appendNote}>Just add to recipe notes</button>
        </div>
      )}

      {(tidy || f.rawText) && f.rawText && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Pasted caption</strong>
          <p className="hint">Copy the bits you need into the fields below. I've had a first go at splitting it.</p>
          <div className="raw-text" style={{ marginTop: 6 }}>{f.rawText}</div>
        </div>
      )}

      <div className="field"><label>Name</label><input value={f.title} onChange={set('title')} /></div>
      <div className="field"><label>Description</label><textarea style={{ minHeight: 70 }} value={f.description} onChange={set('description')} /></div>
      <div className="grid2">
        <div className="field"><label>Servings</label><input inputMode="decimal" value={f.servings} onChange={set('servings')} placeholder="4" /></div>
        <div className="field"><label>Yield label</label><input value={f.servingsLabel} onChange={set('servingsLabel')} placeholder="e.g. 12 cookies" /></div>
      </div>
      <div className="grid3">
        <div className="field"><label>Prep (min)</label><input inputMode="numeric" value={f.prep} onChange={set('prep')} /></div>
        <div className="field"><label>Cook (min)</label><input inputMode="numeric" value={f.cook} onChange={set('cook')} /></div>
        <div className="field"><label>Total (min)</label><input inputMode="numeric" value={f.total} onChange={set('total')} /></div>
      </div>
      <div className="field">
        <label>Ingredients</label>
        <textarea style={{ minHeight: 200 }} value={f.ingredients} onChange={set('ingredients')} placeholder={'2 cups flour\n1 tsp salt\n# For the sauce\n400g tinned tomatoes'} />
        <p className="hint">One per line. Start a line with # to make a section, like "# For the sauce".</p>
      </div>
      <div className="field">
        <label>Method</label>
        <textarea style={{ minHeight: 240 }} value={f.steps} onChange={set('steps')} placeholder={'Preheat the oven to 200°C.\nMix the dry ingredients.'} />
        <p className="hint">One step per line. # for sections works here too.</p>
      </div>
      <div className="field"><label>Notes</label><textarea value={f.notes} onChange={set('notes')} /></div>
      <div className="field"><label>Tags</label><input value={f.tags} onChange={set('tags')} placeholder="dinner, vegetarian, quick" /><p className="hint">Separate with commas.</p></div>
      <div className="field">
        <label>Photo</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input value={f.imageUrl} onChange={set('imageUrl')} placeholder="Image link" />
          <label className="btn small" style={{ margin: 0, whiteSpace: 'nowrap', color: 'var(--ink)' }}>
            Upload
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      </div>
      <div className="field"><label>Source link</label><input type="url" value={f.sourceUrl} onChange={set('sourceUrl')} /></div>
      {f.rawText && <div className="field"><label>Saved caption</label><textarea value={f.rawText} onChange={set('rawText')} /><p className="hint">Clear this once you've tidied it up.</p></div>}
      <div className="field"><label>What changed? (optional)</label><input value={f.changeNote} onChange={set('changeNote')} placeholder={log ? 'Changes from cook log' : 'e.g. less sugar, added garlic'} /><p className="hint">Shown in version history.</p></div>
      <button className="primary" disabled={busy} onClick={save}>Save</button>
    </>
  );
}

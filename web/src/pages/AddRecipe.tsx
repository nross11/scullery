import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type ImportResponse } from '../api';
import { TopBar } from '../App';
import { emptyBody, sourceKindOf } from '../../../shared/recipe';
import { roughSplitText } from '../../../shared/importer';
import { textToIngredients, textToSteps } from '../../../shared/editorText';

export default function AddRecipe() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [text, setText] = useState(params.get('text') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = sourceKindOf(url.trim() || null);
  const isSocial = kind === 'youtube' || kind === 'instagram' || kind === 'tiktok';

  async function importIt() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResponse>('/recipes/import', { url: url.trim() || null, text: text.trim() || null });
      const draft = res.draft;
      // For captions, make a first rough pass at ingredients/steps so tidying is quicker.
      if (!res.structured && draft.body.rawText) {
        const split = roughSplitText(draft.body.rawText);
        if (split.ingredients.length) draft.body.ingredients = textToIngredients(split.ingredients.join('\n'));
        if (split.steps.length) draft.body.steps = textToSteps(split.steps.join('\n'));
      }
      const { id } = await api.post<{ id: string }>('/recipes', draft);
      nav(res.structured ? `/recipes/${id}` : `/recipes/${id}/edit?tidy=1`, { replace: true });
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  }

  async function blank() {
    setBusy(true);
    const { id } = await api.post<{ id: string }>('/recipes', { title: 'New recipe', body: emptyBody(), sourceUrl: null, sourceKind: 'manual', imageUrl: null, tags: [] });
    nav(`/recipes/${id}/edit`, { replace: true });
  }

  useEffect(() => {
    if (params.get('url') && params.get('auto') === '1') void importIt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <TopBar />
      <h1>Add a recipe</h1>
      <div className="card stack">
        <div className="field">
          <label htmlFor="url">Link</label>
          <input id="url" type="url" inputMode="url" placeholder="https://… (recipe site, YouTube, Instagram, TikTok)" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          {kind === 'web' && <p className="hint">I'll pull the recipe straight from the page when it has one.</p>}
          {isSocial && <p className="hint">Videos don't carry the recipe in a form I can read, so paste the caption or description below and tidy it up afterwards.</p>}
        </div>
        <div className="field">
          <label htmlFor="text">{isSocial ? 'Caption or description' : 'Or paste recipe text'}</label>
          <textarea id="text" placeholder="Paste ingredients and method here (optional)" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || (!url.trim() && !text.trim())} onClick={importIt}>{busy ? 'Importing…' : 'Import'}</button>
          <button className="ghost" disabled={busy} onClick={blank}>Start from scratch</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>Tip: set up the iPhone Shortcut in Settings to send links here from the share sheet.</p>
    </>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, imageForClaude, type ImportResponse } from '../api';
import { TopBar, useMe } from '../App';
import { toast } from '../components/ui';
import { emptyBody, sourceKindOf } from '../../../shared/recipe';
import { roughSplitText } from '../../../shared/importer';
import { textToIngredients, textToSteps } from '../../../shared/editorText';

export default function AddRecipe() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [text, setText] = useState(params.get('text') ?? '');
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  const ai = !!useMe()?.ai;
  const [error, setError] = useState<string | null>(null);
  const kind = sourceKindOf(url.trim() || null);
  const isSocial = kind === 'youtube' || kind === 'instagram' || kind === 'tiktok';

  async function importIt() {
    setBusy(true);
    setError(null);
    try {
      const images = await Promise.all(shots.map(imageForClaude));
      const res = await api.post<ImportResponse>('/recipes/import', { url: url.trim() || null, text: text.trim() || null, images });
      const draft = res.draft;
      if (res.aiNote) toast(res.aiNote);
      // For captions, make a first rough pass at ingredients/steps so tidying is quicker.
      if (!res.structured && !res.ai && draft.body.rawText) {
        const split = roughSplitText(draft.body.rawText);
        if (split.ingredients.length) draft.body.ingredients = textToIngredients(split.ingredients.join('\n'));
        if (split.steps.length) draft.body.steps = textToSteps(split.steps.join('\n'));
      }
      const { id } = await api.post<{ id: string }>('/recipes', draft);
      if (res.ai) {
        try { sessionStorage.setItem(`guessed:${id}`, JSON.stringify(res.guessed ?? [])); } catch { /* private mode */ }
      }
      nav(res.structured ? `/recipes/${id}` : `/recipes/${id}/edit?${res.ai ? 'ai=1' : 'tidy=1'}`, { replace: true });
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
          {isSocial && !ai && <p className="hint">Videos don't carry the recipe in a form I can read, so paste the caption or description below and tidy it up afterwards.</p>}
          {isSocial && ai && <p className="hint">Claude will read what it can from the post. For Instagram and TikTok, paste the caption or add screenshots too, because those sites usually hide it from us.</p>}
        </div>
        <div className="field">
          <label htmlFor="text">{isSocial ? 'Caption or description' : 'Or paste recipe text'}</label>
          <textarea id="text" placeholder="Paste ingredients and method here (optional)" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {ai && (
          <div className="field">
            <label>Screenshots</label>
            <label className={`btn file-btn${shots.length ? ' has-files' : ''}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></svg>
              {shots.length ? `${shots.length} screenshot${shots.length === 1 ? '' : 's'} added · change` : 'Add screenshots'}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => setShots([...(e.target.files ?? [])].slice(0, 6))} />
            </label>
            <p className="hint">Optional, up to 6. Handy for recipes shown on screen in a video or written in a photo.</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || (!url.trim() && !text.trim() && !shots.length)} onClick={importIt}>{busy ? (ai ? 'Claude is reading it…' : 'Importing…') : 'Import'}</button>
          <button className="ghost" disabled={busy} onClick={blank}>Start from scratch</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>Tip: set up the iPhone Shortcut in Settings to send links here from the share sheet.</p>
    </>
  );
}

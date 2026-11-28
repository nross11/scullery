import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type RecipeSummary } from '../api';
import { Stars, Spinner, Thumb, useLoad } from '../components/ui';
import { TopBar } from '../App';

export default function RecipeList() {
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'az' | 'rating' | 'cooked'>('recent');
  const { data, error } = useLoad(() => api.get<RecipeSummary[]>(`/recipes${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`), [tag]);
  const tags = useLoad(() => api.get<{ tag: string; n: number }[]>('/recipes/tags'), []);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = needle ? data.filter((r) => r.title.toLowerCase().includes(needle) || r.tags.some((t) => t.includes(needle))) : [...data];
    if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'rating') list.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
    if (sort === 'cooked') list.sort((a, b) => b.times_cooked - a.times_cooked);
    return list;
  }, [data, q, sort]);

  return (
    <>
      <TopBar>
        <Link to="/add" className="btn btn-primary small">+ Add</Link>
      </TopBar>
      <h1 className="headline">What's for<br /><span className="neon">dinner?</span></h1>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <input type="search" placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }} aria-label="Sort">
          <option value="recent">Recent</option>
          <option value="az">A–Z</option>
          <option value="rating">Top rated</option>
          <option value="cooked">Most cooked</option>
        </select>
      </div>
      {!!tags.data?.length && (
        <div className="chip-scroll">
          <button className={`chip ${!tag ? 'active' : ''}`} onClick={() => setParams({})}>All</button>
          {tags.data.map((t) => (
            <button key={t.tag} className={`chip ${tag === t.tag ? 'active' : ''}`} onClick={() => setParams(tag === t.tag ? {} : { tag: t.tag })}>
              {t.tag}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!data && !error && <Spinner />}
      {data && !data.length && !tag && (
        <div className="empty">
          <h2>The shelves are bare</h2>
          <p>Add your first recipe from a website, a video, or by hand.</p>
          <Link to="/add" className="btn btn-primary">Add a recipe</Link>
        </div>
      )}
      {data && !!data.length && !shown.length && <p className="empty">Nothing matches "{q}".</p>}
      {!!shown.length && (
        <>
          <Link to={`/recipes/${shown[0].id}`} className="featured">
            <Thumb className="thumb" src={shown[0].image_key} title={shown[0].title} />
            {!q && !tag && sort === 'recent' && <span className="sticker">Latest</span>}
            <div className="caption">
              <h3>{shown[0].title}</h3>
              <div className="meta"><Meta r={shown[0]} /></div>
            </div>
          </Link>
          <div className="recipe-grid">
            {shown.slice(1).map((r) => (
              <Link key={r.id} to={`/recipes/${r.id}`} className="recipe-card">
                <Thumb className="thumb" src={r.image_key} title={r.title} />
                <div className="body">
                  <h3>{r.title}</h3>
                  <div className="meta"><Meta r={r} /></div>
                </div>
                <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Meta({ r }: { r: RecipeSummary }) {
  const bits: string[] = [];
  if (r.times_cooked) bits.push(`cooked ${r.times_cooked}×`);
  else if (r.source_kind !== 'web' && r.source_kind !== 'manual') bits.push(`from ${r.source_kind}`);
  return (
    <>
      {r.avg_rating ? <><Stars value={Math.round(r.avg_rating)} />{bits.length ? ' · ' : ''}</> : null}
      {bits.join(' · ')}
    </>
  );
}

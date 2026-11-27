import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Spinner, toast, useLoad } from '../components/ui';
import { ingredientsToText, lineDiff, stepsToText } from '../../../shared/editorText';
import type { RecipeBody } from '../../../shared/recipe';

interface VersionRow { id: string; version_no: number; title: string; change_note: string | null; from_cook_log_id: string | null; created_at: string; author_name: string | null }
interface VersionFull { id: string; version_no: number; title: string; body: RecipeBody }

function asText(v: VersionFull): string {
  const b = v.body;
  return [
    `Name: ${v.title}`,
    b.servings ? `Servings: ${b.servings}` : null,
    b.description ? `Description: ${b.description}` : null,
    '', 'INGREDIENTS', ingredientsToText(b.ingredients),
    '', 'METHOD', stepsToText(b.steps),
    b.notes ? `\nNOTES\n${b.notes}` : null,
  ].filter((l) => l !== null).join('\n');
}

export default function History() {
  const { id } = useParams();
  const { data, reload } = useLoad(() => api.get<{ current: number; versions: VersionRow[] }>(`/recipes/${id}/versions`), [id]);
  const [open, setOpen] = useState<{ v: VersionFull; prev: VersionFull | null } | null>(null);

  async function view(row: VersionRow) {
    const v = await api.get<VersionFull>(`/recipes/${id}/versions/${row.id}`);
    const prevRow = data?.versions.find((x) => x.version_no === row.version_no - 1);
    const prev = prevRow ? await api.get<VersionFull>(`/recipes/${id}/versions/${prevRow.id}`) : null;
    setOpen({ v, prev });
  }

  if (!data) return <Spinner />;
  return (
    <>
      <Link to={`/recipes/${id}`} className="btn ghost small">← Back to recipe</Link>
      <h1 style={{ marginTop: 10 }}>Version history</h1>
      <p className="muted small">Every save is kept. Restoring copies an old version forward, so nothing is ever lost.</p>
      <div className="card">
        {data.versions.map((v) => (
          <div key={v.id} className="version">
            <div>
              <strong>v{v.version_no}</strong> {v.version_no === data.current && <span className="chip">current</span>}
              <div>{v.change_note || 'Edited'}{v.from_cook_log_id ? ' (from cook log)' : ''}</div>
              <div className="small muted">{new Date(v.created_at + (v.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}{v.author_name ? ` · ${v.author_name}` : ''}</div>
            </div>
            <div className="row" style={{ flexShrink: 0 }}>
              <button className="small" onClick={() => view(v)}>View</button>
              {v.version_no !== data.current && (
                <button className="small" onClick={async () => { await api.post(`/recipes/${id}/versions/${v.id}/restore`); toast(`Restored v${v.version_no}`); setOpen(null); reload(); }}>Restore</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="section">
          <div className="spread"><h2 style={{ margin: 0 }}>v{open.v.version_no}{open.prev ? ` compared with v${open.prev.version_no}` : ''}</h2><button className="ghost small" onClick={() => setOpen(null)}>Close</button></div>
          <div className="diff" style={{ marginTop: 8 }}>
            {open.prev
              ? lineDiff(asText(open.prev), asText(open.v)).map((d, i) => <span key={i} className={d.type === 'same' ? '' : d.type}>{d.type === 'add' ? '+ ' : d.type === 'del' ? '− ' : '  '}{d.text || ' '}{'\n'}</span>)
              : asText(open.v)}
          </div>
        </div>
      )}
    </>
  );
}

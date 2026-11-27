import { useState } from 'react';
import { api } from '../api';
import { useMe, TopBar } from '../App';
import { useLoad } from '../components/ui';

export default function Settings() {
  const me = useMe();
  const tokens = useLoad(() => api.get<{ id: string; label: string; created_at: string }[]>('/tokens'), []);
  const [newToken, setNewToken] = useState<string | null>(null);

  return (
    <>
      <TopBar />
      <h1>Settings</h1>
      <div className="card stack">
        <h2>Our kitchen</h2>
        {me.members.map((m) => (
          <div key={m.email} className="row">
            {m.avatar_url && <img src={m.avatar_url} alt="" width={32} height={32} style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" />}
            <div><strong>{m.name ?? m.email}</strong><div className="small muted">{m.email}</div></div>
          </div>
        ))}
        <p className="hint">To add someone, add their Google email to ALLOWED_EMAILS in the Cloudflare settings (see the README).</p>
      </div>

      <div className="card stack section">
        <h2>iPhone share sheet</h2>
        <p className="small">The Scullery Shortcut lets you share a link from Safari, YouTube, Instagram or TikTok straight into Scullery. It needs a key so it can save recipes as you.</p>
        <ol className="small" style={{ paddingLeft: 20 }}>
          <li>Tap <strong>Create a key</strong> below and copy it.</li>
          <li>Install the Scullery Shortcut using the link in the README, and paste the key when it asks.</li>
          <li>In any app, tap Share, then <strong>Save to Scullery</strong>.</li>
        </ol>
        <button className="primary" onClick={async () => { const { token } = await api.post<{ token: string }>('/tokens', { label: 'iPhone Shortcut' }); setNewToken(token); tokens.reload(); }}>Create a key</button>
        {newToken && (
          <div className="card" style={{ background: 'var(--paper)' }}>
            <p className="small"><strong>Copy this now.</strong> It won't be shown again.</p>
            <code style={{ wordBreak: 'break-all' }}>{newToken}</code>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => navigator.clipboard.writeText(newToken)}>Copy</button>
            </div>
            <p className="hint">Server address for the Shortcut: <code>{location.origin}</code></p>
          </div>
        )}
        {!!tokens.data?.length && (
          <div>
            <label>Active keys</label>
            {tokens.data.map((t) => (
              <div key={t.id} className="spread small" style={{ padding: '6px 0' }}>
                <span>{t.label} · {new Date(t.created_at + 'Z').toLocaleDateString()}</span>
                <button className="danger small" onClick={async () => { await api.del(`/tokens/${t.id}`); tokens.reload(); }}>Revoke</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <p className="small muted">Signed in as {me.email}</p>
        <button onClick={async () => { await api.post('/auth/logout'); location.href = '/login'; }}>Sign out</button>
      </div>
    </>
  );
}

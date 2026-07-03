import React, { useState, useEffect, useCallback } from 'react';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

function authHeaders() {
  const token = localStorage.getItem('shootai_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method, headers: authHeaders(), ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function AdminPanel() {
  const [tab, setTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [apiKeys, setApiKeys] = useState({ googleKey: '', openaiKey: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Credit modal
  const [creditModal, setCreditModal] = useState(null); // { user }
  const [creditAmount, setCreditAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, k] = await Promise.all([
        api('GET', '/api/admin/stats'),
        api('GET', '/api/admin/users'),
        api('GET', '/api/admin/apikeys'),
      ]);
      setStats(s);
      setUsers(u.users || []);
      setApiKeys({ googleKey: k.apiKeys?.googleKey || '', openaiKey: k.apiKeys?.openaiKey || '' });
    } catch (e) { setMsg(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSaveKeys() {
    setSaving(true);
    try {
      await api('POST', '/api/admin/apikeys', apiKeys);
      setMsg('API keys saved.');
    } catch (e) { setMsg(e.message); }
    setSaving(false);
    setTimeout(() => setMsg(''), 3000);
  }

  async function handleDisable(user) {
    if (!window.confirm(`Disable ${user.email}?`)) return;
    try {
      await api('POST', `/api/admin/users/${user.id}/disable`);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, disabled: true } : u));
    } catch (e) { alert(e.message); }
  }

  async function handleEnable(user) {
    try {
      await api('POST', `/api/admin/users/${user.id}/enable`);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, disabled: false } : u));
    } catch (e) { alert(e.message); }
  }

  async function handleAddCredits() {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount < 100 || amount % 100 !== 0) {
      return alert('Enter a multiple of ₹100 (min ₹100)');
    }
    try {
      const data = await api('POST', `/api/admin/users/${creditModal.id}/credits`, { amount });
      setUsers(prev => prev.map(u => u.id === creditModal.id ? { ...u, credits: data.credits } : u));
      setCreditModal(null);
      setCreditAmount('');
      setMsg(`Added ${data.creditsAdded} credits. Total charged: ₹${data.total.toFixed(0)} (incl. GST)`);
      setTimeout(() => setMsg(''), 4000);
    } catch (e) { alert(e.message); }
  }

  const gst = parseInt(creditAmount, 10) > 0 ? (parseInt(creditAmount, 10) * 0.18).toFixed(0) : 0;
  const total = parseInt(creditAmount, 10) > 0 ? (parseInt(creditAmount, 10) * 1.18).toFixed(0) : 0;
  const credits = parseInt(creditAmount, 10) > 0 ? parseInt(creditAmount, 10) / 10 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <h1>Admin Panel</h1>
        <p>Manage users, credits, and API configuration</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--gray-200)' }}>
        {[['dashboard', '📊 Dashboard'], ['users', '👥 Users'], ['apikeys', '🔑 API Keys'], ['backup', '💾 Backup'], ['prompts', '📝 Prompts'], ['audit', '🗂 Audit Log']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
            fontWeight: tab === id ? 600 : 400, fontSize: 13,
            borderBottom: tab === id ? '2px solid var(--charcoal)' : '2px solid transparent',
            color: tab === id ? 'var(--charcoal)' : 'var(--gray-500)',
          }}>{label}</button>
        ))}
      </div>

      <div className="screen-body">
        {msg && <div className="alert alert-info" style={{ marginBottom: 16 }}>{msg}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner spinner-dark" /></div>
        ) : tab === 'dashboard' ? (
          <DashboardTab stats={stats} />
        ) : tab === 'users' ? (
          <UsersTab
            users={users}
            onAddCredits={u => { setCreditModal(u); setCreditAmount(''); }}
            onDisable={handleDisable}
            onEnable={handleEnable}
          />
        ) : tab === 'apikeys' ? (
          <ApiKeysTab apiKeys={apiKeys} setApiKeys={setApiKeys} onSave={handleSaveKeys} saving={saving} />
        ) : tab === 'prompts' ? (
          <PromptsTab />
        ) : tab === 'audit' ? (
          <AuditTab users={users} />
        ) : (
          <BackupTab />
        )}
      </div>

      {/* Add Credits Modal */}
      {creditModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Add Credits — {creditModal.name}</span>
              <button className="modal-close" onClick={() => setCreditModal(null)}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 16 }}>
              Current balance: <strong>{creditModal.credits} credits</strong>
            </p>
            <div className="form-group">
              <label className="form-label">Amount (₹) — multiples of ₹100</label>
              <input
                className="form-input"
                type="number"
                step="100"
                min="100"
                value={creditAmount}
                onChange={e => setCreditAmount(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
            {parseInt(creditAmount, 10) >= 100 && (
              <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '12px 16px', fontSize: 13, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Credits added</span><strong>{credits}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Base amount</span><span>₹{creditAmount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>GST (18%)</span><span>₹{gst}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, borderTop: '1px solid var(--gray-200)', paddingTop: 8, marginTop: 4 }}>
                  <span>Total charged</span><span>₹{total}</span>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setCreditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCredits} disabled={!creditAmount || parseInt(creditAmount) < 100}>
                Add Credits
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardTab({ stats }) {
  if (!stats) return null;
  const cards = [
    { label: 'Total Users', value: stats.totalUsers, icon: '👥' },
    { label: 'Active Users', value: stats.activeUsers, icon: '✅' },
    { label: 'Credits Sold', value: stats.totalCreditsAdded, icon: '💳' },
    { label: 'Images Generated', value: stats.totalImagesGenerated, icon: '🖼' },
    { label: 'Revenue (excl. GST)', value: `₹${(stats.totalRevenue || 0).toLocaleString('en-IN')}`, icon: '💰' },
    { label: 'Credits Used', value: stats.totalCreditsUsed, icon: '⚡' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: '#fff', borderRadius: 12, padding: '20px 24px',
          border: '1px solid var(--gray-200)', display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: 32 }}>{c.icon}</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersTab({ users, onAddCredits, onDisable, onEnable }) {
  const [search, setSearch] = useState('');
  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--gray-200)', textAlign: 'left' }}>
              {['Name', 'Email', 'Credits', 'Images', 'Credits Used', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--gray-600)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>No users found</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--gray-100)', background: u.disabled ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{u.name}</td>
                <td style={{ padding: '10px 12px', color: 'var(--gray-600)' }}>{u.email}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontWeight: 600, color: u.credits === 0 ? '#e53e3e' : 'var(--charcoal)' }}>{u.credits}</span>
                </td>
                <td style={{ padding: '10px 12px' }}>{u.totalImagesGenerated}</td>
                <td style={{ padding: '10px 12px' }}>{u.totalCreditsUsed}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    background: u.disabled ? '#fed7d7' : '#c6f6d5',
                    color: u.disabled ? '#c53030' : '#276749',
                  }}>{u.disabled ? 'Disabled' : 'Active'}</span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-gold btn-sm" onClick={() => onAddCredits(u)}>+ Credits</button>
                    {u.disabled
                      ? <button className="btn btn-outline btn-sm" onClick={() => onEnable(u)}>Enable</button>
                      : <button className="btn btn-ghost btn-sm" style={{ color: '#e53e3e' }} onClick={() => onDisable(u)}>Disable</button>
                    }
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiKeysTab({ apiKeys, setApiKeys, onSave, saving }) {
  const [showGoogle, setShowGoogle] = useState(false);
  const [showOpenAI, setShowOpenAI] = useState(false);

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="alert alert-info" style={{ marginBottom: 24, fontSize: 12 }}>
        These API keys are used for ALL users. Keep them secure.
        <br />Instant generation (2K) = 3 credits. Batch = 1 credit per image.
      </div>

      <div className="form-group">
        <label className="form-label">Google Gemini API Key</label>
        <div style={{ position: 'relative' }}>
          <input
            className="form-input"
            type={showGoogle ? 'text' : 'password'}
            value={apiKeys.googleKey}
            onChange={e => setApiKeys(prev => ({ ...prev, googleKey: e.target.value }))}
            placeholder="AIza…"
            style={{ paddingRight: 80 }}
          />
          <button
            onClick={() => setShowGoogle(s => !s)}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--gray-500)' }}>
            {showGoogle ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
          Used for Batch (Flash model) and Gemini instant generation
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">OpenAI API Key</label>
        <div style={{ position: 'relative' }}>
          <input
            className="form-input"
            type={showOpenAI ? 'text' : 'password'}
            value={apiKeys.openaiKey}
            onChange={e => setApiKeys(prev => ({ ...prev, openaiKey: e.target.value }))}
            placeholder="sk-…"
            style={{ paddingRight: 80 }}
          />
          <button
            onClick={() => setShowOpenAI(s => !s)}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--gray-500)' }}>
            {showOpenAI ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
          Used for instant 2K generation (gpt-image-1)
        </div>
      </div>

      <div style={{ marginTop: 24, padding: '16px 20px', background: 'var(--cream)', borderRadius: 10, fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 Credit Pricing</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '6px 20px', color: 'var(--gray-700)' }}>
          <span style={{ fontWeight: 600 }}>Amount</span>
          <span style={{ fontWeight: 600 }}>Credits</span>
          <span style={{ fontWeight: 600 }}>+GST 18%</span>
          <span style={{ fontWeight: 600 }}>Total</span>
          {[[100,10],[200,20],[500,50],[1000,100],[2000,200],[5000,500]].map(([amt, cr]) => (
            <React.Fragment key={amt}>
              <span>₹{amt}</span><span>{cr}</span>
              <span>₹{(amt*0.18).toFixed(0)}</span>
              <span>₹{(amt*1.18).toFixed(0)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Save API Keys'}
        </button>
      </div>
    </div>
  );
}

function BackupTab() {
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('info');

  function showMsg(text, type = 'info') {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(''), 5000);
  }

  async function handleBackup() {
    try {
      const token = localStorage.getItem('shootai_token');
      const res = await fetch(`${process.env.REACT_APP_SERVER_URL || ''}/api/admin/backup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { showMsg('Backup failed.', 'error'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shootai-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg('✅ Backup downloaded successfully.');
    } catch (e) { showMsg('Backup failed: ' + e.message, 'error'); }
  }

  async function handleRestore(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm('This will overwrite all current data (users, credits, libraries). Are you sure?')) {
      e.target.value = '';
      return;
    }
    setRestoring(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const token = localStorage.getItem('shootai_token');
      const res = await fetch(`${process.env.REACT_APP_SERVER_URL || ''}/api/admin/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(backup),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMsg(`✅ Restored ${data.restored} files successfully. Reload the page to see updated data.`);
    } catch (e) { showMsg('Restore failed: ' + e.message, 'error'); }
    setRestoring(false);
    e.target.value = '';
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--navy)' }}>Data Backup & Restore</h2>
      <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 24, lineHeight: 1.6 }}>
        Render's free tier resets all data on every deployment. <strong>Before deploying any update</strong>,
        download a backup. After the deploy completes, restore it here.
      </p>

      {msg && (
        <div className={`alert alert-${msgType === 'error' ? 'error' : 'info'}`} style={{ marginBottom: 20, fontSize: 13 }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Backup */}
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>📥 Step 1 — Download Backup</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14 }}>
            Downloads all users, credits, libraries, and settings as a single JSON file. Do this before every deployment.
          </p>
          <button className="btn btn-primary" onClick={handleBackup}>
            Download Backup
          </button>
        </div>

        {/* Restore */}
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>📤 Step 2 — Restore After Deploy</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14 }}>
            After the new version deploys, upload your backup file here to restore all data.
            <strong style={{ color: 'var(--red)' }}> This overwrites current server data.</strong>
          </p>
          <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
            {restoring ? <><span className="spinner" /> Restoring…</> : 'Choose Backup File…'}
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleRestore} disabled={restoring} />
          </label>
        </div>

        {/* Reminder */}
        <div style={{ background: 'var(--gold-light, #fff8e7)', border: '1px solid #f0d060', borderRadius: 12, padding: 16, fontSize: 13, color: '#7a5c00' }}>
          <strong>⚠️ Deployment checklist</strong>
          <ol style={{ margin: '8px 0 0 16px', lineHeight: 2 }}>
            <li>Go to <strong>Backup</strong> tab → Download Backup</li>

            <li>Wait for deploy to finish</li>
            <li>Log in → <strong>Backup</strong> tab → Restore</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ── Audit Tab ──────────────────────────────────────────────────────────────

function AuditTab({ users }) {
  const [summary, setSummary] = React.useState(null);
  const [selectedUser, setSelectedUser] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [loadingEntries, setLoadingEntries] = React.useState(false);

  React.useEffect(() => { loadSummary(); }, []);

  async function loadSummary() {
    try {
      const data = await api('GET', '/api/admin/audit');
      setSummary(data.summary || []);
    } catch { setSummary([]); }
  }

  async function loadUserEntries(userId) {
    setLoadingEntries(true);
    try {
      const data = await api('GET', `/api/admin/audit?userId=${userId}`);
      setEntries(data.entries || []);
    } catch { setEntries([]); }
    setLoadingEntries(false);
  }

  function handleSelectUser(u) {
    setSelectedUser(u);
    loadUserEntries(u.userId);
  }

  if (!summary) return React.createElement('div', { style: { textAlign: 'center', padding: 40 } }, React.createElement('div', { className: 'spinner spinner-dark' }));

  if (selectedUser) {
    return (
      <div>
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedUser(null)} style={{ marginBottom: 16 }}>
          ← Back to summary
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{selectedUser.email}</h2>
        <p style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 16 }}>
          {selectedUser.totalEntries} events · {selectedUser.totalCreditsUsed} credits used
        </p>
        {loadingEntries ? (
          <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner spinner-dark" /></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-100)' }}>
                {['Time', 'Event', 'Detail', 'Credits'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{e.event}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--gray-600)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.detail || '\u2014'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{e.credits ?? '\u2014'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Activity by User</h2>
      {summary.length === 0 ? (
        <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>No audit data yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--gray-100)' }}>
              {['User', 'Events', 'Credits Used', 'Last Activity', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map(u => (
              <tr key={u.userId} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{u.email}</td>
                <td style={{ padding: '8px 12px' }}>{u.totalEntries}</td>
                <td style={{ padding: '8px 12px' }}>{u.totalCreditsUsed}</td>
                <td style={{ padding: '8px 12px', color: 'var(--gray-500)', fontSize: 12 }}>
                  {u.lastActivity ? new Date(u.lastActivity).toLocaleString() : '\u2014'}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleSelectUser(u)}>View \u2192</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Prompts Tab ────────────────────────────────────────────────────────────

const PROMPT_SECTIONS = [
  { key: 'global.garment_shape_lock',            label: 'Garment Shape Lock',         section: 'Global' },
  { key: 'global.print_lock_angle',               label: 'Print Lock (Angle)',          section: 'Global' },
  { key: 'global.footwear_block',                 label: 'Footwear Block',              section: 'Global' },
  { key: 'garment_orientation.Front',             label: 'Orientation \u2014 Front',   section: 'Garment Orientation' },
  { key: 'garment_orientation.Styled',            label: 'Orientation \u2014 Styled',  section: 'Garment Orientation' },
  { key: 'garment_orientation.Side',              label: 'Orientation \u2014 Side',    section: 'Garment Orientation' },
  { key: 'garment_orientation.Back',              label: 'Orientation \u2014 Back',    section: 'Garment Orientation' },
  { key: 'model_identity.Front',                  label: 'Identity \u2014 Front',      section: 'Model Identity' },
  { key: 'model_identity.Styled',                 label: 'Identity \u2014 Styled',     section: 'Model Identity' },
  { key: 'model_identity.Side',                   label: 'Identity \u2014 Side',       section: 'Model Identity' },
  { key: 'model_identity.Back',                   label: 'Identity \u2014 Back',       section: 'Model Identity' },
  { key: 'model_identity.Detail Close-Up',        label: 'Identity \u2014 Detail',     section: 'Model Identity' },
  { key: 'e_shared.lighting',                     label: 'Lighting',                    section: 'E \u2014 Shared' },
  { key: 'e_shared.shadow',                       label: 'Shadow',                      section: 'E \u2014 Shared' },
  { key: 'e_shared.bgLock',                       label: 'Background Lock',             section: 'E \u2014 Shared' },
  { key: 'e_shared.framingLock',                  label: 'Framing Lock',                section: 'E \u2014 Shared' },
  { key: 'e_styled.garment_absolute_lock',        label: 'Garment Absolute Lock',       section: 'E \u2014 Styled' },
  { key: 'e_styled.garment_accessories',          label: 'Garment Accessories',         section: 'E \u2014 Styled' },
  { key: 'e_styled.framing',                      label: 'Framing',                     section: 'E \u2014 Styled' },
  { key: 'e_styled.garment_fidelity',             label: 'Garment Fidelity',            section: 'E \u2014 Styled' },
  { key: 'e_styled.print_lock',                   label: 'Print Lock',                  section: 'E \u2014 Styled' },
  { key: 'e_styled.pose_action_with_pose',        label: 'Pose Action (with pose)',     section: 'E \u2014 Styled' },
  { key: 'e_styled.pose_action_without_pose',     label: 'Pose Action (no pose)',       section: 'E \u2014 Styled' },
  { key: 'e_detail_closeup.action',               label: 'Action',                      section: 'E \u2014 Detail Close-Up' },
  { key: 'e_detail_closeup.body',                 label: 'Body',                        section: 'E \u2014 Detail Close-Up' },
  { key: 'e_category_actions.full_outfit.Front',  label: 'Full Outfit \u2014 Front',   section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.full_outfit.Side',   label: 'Full Outfit \u2014 Side',    section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.full_outfit.Back',   label: 'Full Outfit \u2014 Back',    section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.topwear.Front',      label: 'Topwear \u2014 Front',       section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.topwear.Side',       label: 'Topwear \u2014 Side',        section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.topwear.Back',       label: 'Topwear \u2014 Back',        section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.bottomwear.Front',   label: 'Bottomwear \u2014 Front',    section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.bottomwear.Side',    label: 'Bottomwear \u2014 Side',     section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.bottomwear.Back',    label: 'Bottomwear \u2014 Back',     section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.innerwear.Front',    label: 'Innerwear \u2014 Front',     section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.innerwear.Side',     label: 'Innerwear \u2014 Side',      section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.innerwear.Back',     label: 'Innerwear \u2014 Back',      section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.outerwear.Front',    label: 'Outerwear \u2014 Front',     section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.outerwear.Side',     label: 'Outerwear \u2014 Side',      section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.outerwear.Back',     label: 'Outerwear \u2014 Back',      section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.footwear.Front',     label: 'Footwear \u2014 Front',      section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.footwear.Side',      label: 'Footwear \u2014 Side',       section: 'E \u2014 Category Actions' },
  { key: 'e_category_actions.footwear.Back',      label: 'Footwear \u2014 Back',       section: 'E \u2014 Category Actions' },
  { key: 'c_shot_prompts.Front',                  label: 'Front',                       section: 'C \u2014 Shot Prompts (RT)' },
  { key: 'c_shot_prompts.Styled',                 label: 'Styled',                      section: 'C \u2014 Shot Prompts (RT)' },
  { key: 'c_shot_prompts.Side',                   label: 'Side',                        section: 'C \u2014 Shot Prompts (RT)' },
  { key: 'c_shot_prompts.Back',                   label: 'Back',                        section: 'C \u2014 Shot Prompts (RT)' },
  { key: 'c_shot_prompts.Detail Close-Up',        label: 'Detail Close-Up',             section: 'C \u2014 Shot Prompts (RT)' },
  { key: 'c_shot_prompts_batch.Front',            label: 'Front',                       section: 'C \u2014 Shot Prompts (Batch)' },
  { key: 'c_shot_prompts_batch.Styled',           label: 'Styled',                      section: 'C \u2014 Shot Prompts (Batch)' },
  { key: 'c_shot_prompts_batch.Side',             label: 'Side',                        section: 'C \u2014 Shot Prompts (Batch)' },
  { key: 'c_shot_prompts_batch.Back',             label: 'Back',                        section: 'C \u2014 Shot Prompts (Batch)' },
  { key: 'c_shot_prompts_batch.Detail Close-Up',  label: 'Detail Close-Up',             section: 'C \u2014 Shot Prompts (Batch)' },
  { key: 'b_core_prompt',                         label: 'Core Garment Prompt',         section: 'Workflow B' },
  { key: 'd_core_prompt',                         label: 'Core Try-On Prompt',          section: 'Workflow D' },
];

function getNestedValue(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : ''), obj);
}

function setNestedValue(obj, key, value) {
  const parts = key.split('.');
  const result = JSON.parse(JSON.stringify(obj));
  let cur = result;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return result;
}

function PromptsTab() {
  const [templates, setTemplates] = React.useState(null);
  const [editKey, setEditKey]     = React.useState(null);
  const [editValue, setEditValue] = React.useState('');
  const [filterSection, setFilterSection] = React.useState('all');
  const [saving, setSaving]       = React.useState(false);
  const [saved, setSaved]         = React.useState(false);

  React.useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    try {
      const data = await api('GET', '/api/prompt-templates');
      setTemplates(data);
    } catch { setTemplates({}); }
  }

  function startEdit(key) {
    setEditKey(key);
    setEditValue(getNestedValue(templates, key));
    setSaved(false);
  }

  async function saveEdit() {
    setSaving(true);
    const updated = setNestedValue(templates, editKey, editValue);
    try {
      await api('PUT', '/api/admin/prompt-templates', updated);
      setTemplates(updated);
      setSaved(true);
      setEditKey(null);
      if (window.__invalidatePromptTemplates) window.__invalidatePromptTemplates();
    } catch {}
    setSaving(false);
  }

  const sections = [...new Set(PROMPT_SECTIONS.map(p => p.section))];
  const filtered = filterSection === 'all' ? PROMPT_SECTIONS : PROMPT_SECTIONS.filter(p => p.section === filterSection);

  if (!templates) return React.createElement('div', { style: { textAlign: 'center', padding: 40 } }, React.createElement('div', { className: 'spinner spinner-dark' }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--gray-300)', fontSize: 13, minWidth: 220 }}>
          <option value="all">All Sections</option>
          {sections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{filtered.length} entries</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--gray-100)' }}>
            {['Section', 'Label', 'Current Value', ''].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(({ key, label, section }) => {
            const val = getNestedValue(templates, key);
            const isEditing = editKey === key;
            return (
              <React.Fragment key={key}>
                <tr style={{ borderBottom: '1px solid var(--gray-100)', background: isEditing ? 'var(--cream)' : 'white' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--gray-500)', fontSize: 11, whiteSpace: 'nowrap' }}>{section}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--gray-600)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {val || <span style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>empty</span>}
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => isEditing ? setEditKey(null) : startEdit(key)}>
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                  </td>
                </tr>
                {isEditing && (
                  <tr style={{ background: 'var(--cream)', borderBottom: '1px solid var(--gray-200)' }}>
                    <td colSpan={4} style={{ padding: '0 12px 12px' }}>
                      <textarea
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        rows={6}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: 8, borderRadius: 6, border: '1px solid var(--gray-300)', resize: 'vertical', boxSizing: 'border-box', marginTop: 8 }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditKey(null)}>Cancel</button>
                        {saved && <span style={{ color: 'var(--green)', fontSize: 12, alignSelf: 'center' }}>Saved</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

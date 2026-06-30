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
        {[['dashboard', '📊 Dashboard'], ['users', '👥 Users'], ['apikeys', '🔑 API Keys']].map(([id, label]) => (
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
        ) : (
          <ApiKeysTab apiKeys={apiKeys} setApiKeys={setApiKeys} onSave={handleSaveKeys} saving={saving} />
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

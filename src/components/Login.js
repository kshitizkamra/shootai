import React, { useState } from 'react';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, name };
      const res = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      localStorage.setItem('shootai_token', data.token);
      localStorage.setItem('shootai_user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--cream)', fontFamily: 'var(--font)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, boxShadow: '0 4px 32px rgba(0,0,0,0.10)',
        padding: '40px 36px', width: '100%', maxWidth: 400,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📸</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.5px' }}>ShootAI</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>AI-powered fashion photography</div>
        </div>

        {/* Toggle */}
        <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 4, marginBottom: 24 }}>
          {['login', 'register'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }}
              style={{
                flex: 1, padding: '8px 0', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                background: mode === m ? '#fff' : 'transparent',
                color: mode === m ? 'var(--navy)' : 'var(--gray-500)',
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" type="text" placeholder="Your name"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="you@example.com" required
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" placeholder={mode === 'register' ? 'Min. 6 characters' : '••••••••'} required
              value={password} onChange={e => setPassword(e.target.value)} />
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>⚠ {error}</div>
          )}

          <button className="btn btn-primary" type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px', fontSize: 15, marginTop: 4 }}>
            {loading
              ? <><span className="spinner" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
              : mode === 'login' ? 'Sign In' : 'Create Account'
            }
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--gray-500)' }}>
          {mode === 'login'
            ? <>Don't have an account? <button onClick={() => setMode('register')} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Sign up</button></>
            : <>Already have an account? <button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Sign in</button></>
          }
        </div>
      </div>
    </div>
  );
}

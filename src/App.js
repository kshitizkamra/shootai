import React, { useState, useEffect, useCallback } from 'react';
import Settings from './components/Settings';
import ModelLibrary from './components/ModelLibrary';
import BackgroundLibrary from './components/BackgroundLibrary';
import PoseLibrary from './components/PoseLibrary';
import Workflow from './components/Workflow';
import History from './components/History';
import Batch from './components/Batch';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import Credits from './components/Credits';
import { getBatchQueue } from './utils/batchQueue';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeScreen, setActiveScreen] = useState('workflow');
  const [batchCount, setBatchCount] = useState(0);
  const [credits, setCredits] = useState(null);
  const [reservedCredits, setReservedCredits] = useState(0);

  const refreshCredits = useCallback(async () => {
    const token = localStorage.getItem('shootai_token');
    if (!token) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/user/credits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCredits(data.credits);
        setReservedCredits(data.reserved || 0);
      }
    } catch {}
  }, []);

  // Check existing auth on mount
  useEffect(() => {
    const token = localStorage.getItem('shootai_token');
    if (token) {
      fetch(`${SERVER_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(res => {
        if (res.ok) return res.json();
        throw new Error('Invalid');
      }).then(u => {
        setUser(u);
        if (u.role !== 'admin') setCredits(u.credits ?? 0);
      }).catch(() => {
        localStorage.removeItem('shootai_token');
        localStorage.removeItem('shootai_user');
      }).finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  // Poll batch count
  useEffect(() => {
    if (!user) return;
    const refresh = () => getBatchQueue().then(q => setBatchCount(q.length));
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [user]);

  // Poll credits every 30s for regular users
  useEffect(() => {
    if (!user || user.role === 'admin') return;
    refreshCredits();
    const t = setInterval(refreshCredits, 30000);
    return () => clearInterval(t);
  }, [user, refreshCredits]);

  function handleLogin(userData) {
    setUser(userData);
    if (userData.role !== 'admin') setCredits(userData.credits ?? 0);
    setActiveScreen('workflow');
  }

  function handleLogout() {
    localStorage.removeItem('shootai_token');
    localStorage.removeItem('shootai_user');
    setUser(null);
    setCredits(null);
  }

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)' }}>
        <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (!user) return <Login onLogin={handleLogin} />;

  const isAdmin = user.role === 'admin';

  const NAV_ITEMS = [
    { id: 'workflow',     label: 'Workflows',   icon: '⚡' },
    { id: 'models',       label: 'Models',       icon: '👤' },
    { id: 'backgrounds',  label: 'Backgrounds',  icon: '🖼' },
    { id: 'poses',        label: 'Poses',        icon: '🧍' },
    { id: 'batch',        label: 'Batch Jobs',   icon: '📦', badge: batchCount },
    { id: 'history',      label: 'History',      icon: '📋' },
    ...(isAdmin
      ? [
          { id: 'admin',    label: 'Admin Panel', icon: '⚙' },
          { id: 'settings', label: 'Settings',    icon: '🔧' },
        ]
      : [
          { id: 'credits',  label: 'Credits',     icon: '💳', badge: credits === 0 ? '!' : null },
        ]
    ),
  ];

  const renderScreen = () => {
    switch (activeScreen) {
      case 'workflow':    return <Workflow onNavigate={setActiveScreen} />;
      case 'models':      return <ModelLibrary isAdmin={isAdmin} />;
      case 'backgrounds': return <BackgroundLibrary isAdmin={isAdmin} />;
      case 'poses':       return <PoseLibrary />;
      case 'batch':       return <Batch />;
      case 'history':     return <History />;
      case 'admin':       return isAdmin ? <AdminPanel /> : null;
      case 'settings':    return isAdmin ? <Settings /> : null;
      case 'credits':     return !isAdmin ? <Credits credits={credits} /> : null;
      default:            return <Workflow onNavigate={setActiveScreen} />;
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">📸</span>
          <span className="logo-text">ShootAI</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeScreen === item.id ? 'active' : ''}`}
              onClick={() => { setActiveScreen(item.id); if (item.id === 'credits') refreshCredits(); }}
              style={{ position: 'relative' }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge > 0 && (
                <span style={{
                  position: 'absolute', top: 6, right: 8,
                  background: 'var(--gold)', color: '#fff',
                  borderRadius: 10, fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', lineHeight: '14px',
                }}>{item.badge}</span>
              )}
              {item.badge === '!' && (
                <span style={{
                  position: 'absolute', top: 6, right: 8,
                  background: '#e53e3e', color: '#fff',
                  borderRadius: 10, fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', lineHeight: '14px',
                }}>!</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isAdmin && (
            <div style={{ margin: '0 8px 4px', padding: '6px 12px', background: 'var(--cream)', borderRadius: 8, fontSize: 11, textAlign: 'center', color: 'var(--gray-500)' }}>
              Admin
            </div>
          )}
          <span style={{ fontSize: 11, color: 'var(--gray-500)', padding: '0 12px', textAlign: 'center' }}>
            {user.name || user.email}
          </span>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ margin: '0 8px' }}>
            Sign Out
          </button>
          <span className="version-tag">v2.0.0</span>
        </div>
      </aside>

      <main className="main-content" style={{ position: 'relative' }}>
        {/* Credit badge — top right, always visible for users */}
        {!isAdmin && credits !== null && (
          <div
            onClick={() => { setActiveScreen('credits'); refreshCredits(); }}
            style={{
              position: 'absolute', top: 16, right: 20, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 6,
              background: credits === 0 ? '#fed7d7' : 'var(--cream)',
              border: `1px solid ${credits === 0 ? '#fc8181' : 'var(--gray-200)'}`,
              borderRadius: 20, padding: '5px 12px',
              cursor: 'pointer', userSelect: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            <span style={{ fontSize: 13 }}>💳</span>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: credits === 0 ? '#c53030' : 'var(--charcoal)',
            }}>
              {reservedCredits > 0 ? `${credits - reservedCredits} available` : `${credits} credit${credits !== 1 ? 's' : ''}`}
            </span>
            {reservedCredits > 0 && (
              <span style={{ fontSize: 10, color: '#e07020' }}>· {reservedCredits} in batch</span>
            )}
            {credits === 0 && reservedCredits === 0 && (
              <span style={{ fontSize: 10, color: '#c53030' }}>· Top up</span>
            )}
          </div>
        )}
        {renderScreen()}
      </main>
    </div>
  );
}

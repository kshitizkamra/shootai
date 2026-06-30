import React, { useState, useEffect } from 'react';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

function authHeaders() {
  const token = localStorage.getItem('shootai_token');
  return { Authorization: `Bearer ${token}` };
}

export default function Credits({ credits }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/user/transactions`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setTransactions(d.transactions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function txIcon(type) {
    if (type === 'credit_added') return '💳';
    if (type === 'credit_refunded') return '↩️';
    return '⚡';
  }

  function txColor(type) {
    if (type === 'credit_added') return '#276749';
    if (type === 'credit_refunded') return '#2b6cb0';
    return 'var(--charcoal)';
  }

  function formatDate(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        + ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <h1>Credits</h1>
        <p>Your credit balance and usage history</p>
      </div>

      <div className="screen-body">
        {/* Balance card */}
        <div style={{
          background: 'var(--charcoal)', color: '#fff', borderRadius: 16,
          padding: '28px 32px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 24,
        }}>
          <div style={{ fontSize: 48 }}>💳</div>
          <div>
            <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{credits ?? '—'}</div>
            <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>Available Credits</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7, textAlign: 'right' }}>
            <div>1 credit = 1 batch image</div>
            <div>3 credits = 1 instant 2K image</div>
            <div style={{ marginTop: 8 }}>To recharge, contact admin</div>
          </div>
        </div>

        {/* Pricing info */}
        <div style={{
          background: 'var(--cream)', borderRadius: 12, padding: '16px 20px',
          marginBottom: 28, fontSize: 13,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Pricing</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '6px 24px', color: 'var(--gray-700)' }}>
            <span style={{ fontWeight: 600 }}>Amount</span>
            <span style={{ fontWeight: 600 }}>Credits</span>
            <span style={{ fontWeight: 600 }}>+GST (18%)</span>
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

        {/* Transaction log */}
        <div className="section-title" style={{ marginBottom: 12 }}>Transaction History</div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner spinner-dark" /></div>
        ) : transactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--gray-400)', fontSize: 13 }}>
            No transactions yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {transactions.map(tx => (
              <div key={tx.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 16px', background: '#fff',
                borderRadius: 8, border: '1px solid var(--gray-100)',
              }}>
                <span style={{ fontSize: 20 }}>{txIcon(tx.type)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: txColor(tx.type) }}>
                    {tx.description}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                    {formatDate(tx.timestamp)}
                  </div>
                </div>
                <div style={{
                  fontWeight: 700, fontSize: 14,
                  color: tx.type === 'credit_used' ? '#e53e3e' : '#276749',
                }}>
                  {tx.type === 'credit_used' ? '-' : '+'}{tx.amount}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';

type Diagnostics = {
  configuration: { ready: boolean; checks: Record<string, boolean> };
  backgroundDiscoveryEnabled: boolean;
  queue: { alert: boolean; counts: {status: string; count: number}[] };
  tests: {id: string; status: string; error_code?: string; created_at: number}[];
  evidence: string;
};
export function EmailDiagnostics() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const response = await fetch('/api/intelligence/email-diagnostics', {credentials:'include'});
      if (response.status === 401 || response.status === 403) { setData(null); return; }
      if (!response.ok) throw new Error('Unable to load email diagnostics.');
      setData(await response.json()); setError('');
    } catch { setError('Unable to refresh email diagnostics.'); }
  };
  useEffect(() => { void load(); }, []);
  if (!data) return null;
  return <details className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
    <summary className="cursor-pointer font-bold">Administrator email diagnostics</summary>
    <div className="space-y-3 pt-3">
      <p role="status">{data.configuration.ready ? 'SMTP configuration is complete.' : 'Email configuration needs attention.'} {data.queue.alert ? 'Delivery queue requires attention.' : ''}</p>
      <ul>{Object.entries(data.configuration.checks).map(([key, ok]) => <li key={key}>{key}: {ok ? 'Configured' : 'Missing or invalid'}</li>)}</ul>
      <p>Background conference matching: {data.backgroundDiscoveryEnabled ? 'Enabled' : 'Disabled'}</p>
      <p>Queue: {data.queue.counts.map(row => `${row.status}: ${row.count}`).join(', ') || 'Empty'}</p>
      <p>{data.evidence}</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left font-bold">Recent email tests</caption><thead><tr><th>Request</th><th>Outcome</th><th>Code</th></tr></thead><tbody>{data.tests.map(test => <tr key={test.id}><td className="pr-3 font-mono">{test.id}</td><td className="pr-3">{test.status}</td><td>{test.error_code || '—'}</td></tr>)}</tbody></table></div>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => void load()} className="rounded border px-3 py-2">Refresh diagnostics</button>
    </div>
  </details>;
}

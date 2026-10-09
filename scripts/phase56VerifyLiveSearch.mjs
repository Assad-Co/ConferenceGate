const base = 'https://conferencegate.onrender.com/api/search/conferences';

async function get(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  console.log(`GET ${url} -> ${response.status}`);
  if (!response.ok) {
    console.log(text.slice(0, 1000));
    return [];
  }
  const data = JSON.parse(text);
  return Array.isArray(data?.results) ? data.results : [];
}

function wpc(rows) {
  return rows.filter((row) => {
    const title = String(row?.title || '').toLowerCase();
    const organization = String(row?.organization || '').toLowerCase();
    return title.includes('wpc') || title.includes('world petroleum') || organization.includes('wpc energy');
  });
}

const browse = await get(`${base}?browse=true&limit=10000`);
console.log('BROWSE_COUNT=' + browse.length);
console.log('BROWSE_WPC=' + JSON.stringify(wpc(browse).slice(0, 5)));

for (const q of ['WPC', 'World Petroleum', 'Riyadh', 'ADIPEC']) {
  const rows = await get(`${base}?q=${encodeURIComponent(q)}`);
  console.log(`SEARCH_${q.replace(/\s+/g, '_').toUpperCase()}_COUNT=${rows.length}`);
  console.log(`SEARCH_${q.replace(/\s+/g, '_').toUpperCase()}_WPC=` + JSON.stringify(wpc(rows).slice(0, 5)));
  if (q === 'ADIPEC') {
    console.log('SEARCH_ADIPEC_SAMPLE=' + JSON.stringify(rows.slice(0, 3).map((r) => ({ title: r.title, startDate: r.startDate, prepared: r.prepared }))));
  }
}

if (wpc(browse).length === 0) {
  throw new Error('WPC is absent from the live customer-visible stored browse catalogue');
}
if (wpc(await get(`${base}?q=WPC`)).length === 0) {
  throw new Error('WPC is present in browse but missing from typed search');
}
console.log('LIVE_WPC_VERIFIED=true');
// re-run after Phase 56.1 production deployment

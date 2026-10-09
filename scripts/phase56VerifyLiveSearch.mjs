const endpoint = 'https://conferencegate.onrender.com/api/search/conferences?q=WPC';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= 18; attempt += 1) {
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) {
      console.log(`attempt=${attempt} http=${response.status} body=${text.slice(0, 300)}`);
    } else {
      const data = JSON.parse(text);
      const rows = Array.isArray(data?.results) ? data.results : [];
      const match = rows.find((row) => {
        const title = String(row?.title || '').toLowerCase();
        return title.includes('wpc') || title.includes('world petroleum');
      });
      if (match) {
        console.log('LIVE_WPC_MATCH=' + JSON.stringify({
          title: match.title,
          startDate: match.startDate,
          endDate: match.endDate,
          location: match.location,
          organization: match.organization,
          prepared: match.prepared,
          sections: match.sections,
        }));
        process.exit(0);
      }
      console.log(`attempt=${attempt} results=${rows.length} no-wpc-match`);
    }
  } catch (error) {
    console.log(`attempt=${attempt} error=${error?.message || error}`);
  }
  await sleep(10000);
}

throw new Error('WPC not found in live ConferenceGate stored search after retries');

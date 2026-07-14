// Server-side score verification for PC Golf Tryouts.
// Runs on Vercel — no browser CORS limits, works from any device.
// GET /api/verify?url=<results link>&name=<player name>&score=<18-hole score>
// Returns { ok: boolean, reason?: string }

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cell += ch; }
    } else if (ch === '"') { inQuote = true; }
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else { cell += ch; }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function matchRows(rows, playerName, expectedScore) {
  const nameLower = playerName.toLowerCase();
  const parts = nameLower.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  let foundName = false;
  for (const row of rows) {
    const rowLower = row.join(' ').toLowerCase();
    // Accept "First Last", "Last, First", or last name + first initial.
    const nameHit = rowLower.includes(nameLower)
      || (parts.length > 1 && rowLower.includes(`${last}, ${first}`))
      || (parts.length > 1 && rowLower.includes(last) && rowLower.includes(`${first[0]}.`))
      || (parts.length > 1 && rowLower.includes(last));
    if (!nameHit) continue;
    foundName = true;
    const scoreHit = row.some(c => {
      // Exact-score cell match; strips things like "75*" or "+75".
      const n = parseInt(String(c).replace(/[^0-9-]/g, ''), 10);
      return n === expectedScore;
    }) || (row.length === 1 && (row[0].match(/\d+/g) || []).some(n => parseInt(n, 10) === expectedScore));
    if (scoreHit) return { ok: true };
  }
  return { ok: false, reason: foundName ? 'Score does not match the results' : 'Name not found on the results page' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { url, name, score } = req.query || {};
  const expected = parseInt(score, 10);
  if (!url || !name || isNaN(expected)) {
    return res.status(400).json({ ok: false, reason: 'Missing url, name, or score' });
  }
  try {
    let rows;
    const sheetIdMatch = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (sheetIdMatch) {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/gviz/tq?tqx=out:csv`;
      const resp = await fetch(csvUrl, { redirect: 'follow' });
      if (!resp.ok) return res.status(200).json({ ok: false, reason: 'Sheet not publicly accessible' });
      rows = parseCsv(await resp.text());
    } else {
      if (!/^https?:\/\//i.test(String(url))) {
        return res.status(200).json({ ok: false, reason: 'Not a valid results link' });
      }
      const resp = await fetch(String(url), {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PCGolfVerify/1.0)' }
      });
      if (!resp.ok) return res.status(200).json({ ok: false, reason: `Results link returned ${resp.status}` });
      const html = await resp.text();
      // Strip scripts/styles/tags into text lines; each line acts as a row.
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
      rows = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l]);
    }
    return res.status(200).json(matchRows(rows, String(name), expected));
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'Could not verify automatically' });
  }
}

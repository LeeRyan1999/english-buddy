// English Buddy backend: proxies Gemini/OpenAI + Notion. All secrets come from env vars.
import express from 'express';
const {
  PORT = 3000, GEMINI_API_KEY, GEMINI_MODEL = 'gemini-2.5-flash',
  OPENAI_API_KEY, OPENAI_MODEL = 'gpt-4o-mini', AI_PROVIDER,
  NOTION_TOKEN, NOTION_DATABASE_ID, APP_ACCESS_CODE,
  ALLOWED_ORIGINS = 'https://leeryan1999.github.io'
} = process.env;
const origins = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
const app = express();
app.use(express.json({ limit: '50kb' }));

app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && origins.includes(o)) {
    res.set('Access-Control-Allow-Origin', o);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  } else if (o) return res.status(403).json({ error: 'origin not allowed' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/health', (req, res) => res.json({ ok: true, ai: provider(), notion: !!(NOTION_TOKEN && NOTION_DATABASE_ID) }));
app.use('/api', (req, res, next) => {
  if (!APP_ACCESS_CODE) return res.status(500).json({ error: 'APP_ACCESS_CODE not set on server' });
  const c = req.get('X-Access-Code') || '';
  if (c.length !== APP_ACCESS_CODE.length || !timingSafe(c, APP_ACCESS_CODE)) return res.status(401).json({ error: '存取碼錯誤' });
  next();
});
function timingSafe(a, b) { let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
// tiny rate limit: 60 req / 10 min per IP
const hits = new Map();
app.use('/api', (req, res, next) => {
  const k = req.ip, now = Date.now(), arr = (hits.get(k) || []).filter(t => now - t < 600000);
  arr.push(now); hits.set(k, arr);
  if (arr.length > 60) return res.status(429).json({ error: '太頻繁，請稍後再試' });
  next();
});

function provider() { return AI_PROVIDER || (GEMINI_API_KEY ? 'gemini' : OPENAI_API_KEY ? 'openai' : null); }
async function askJSON(prompt) {
  const p = provider();
  if (p === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Gemini error');
    return JSON.parse(j.candidates?.[0]?.content?.parts?.map(x => x.text).join('') || '{}');
  }
  if (p === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, response_format: { type: 'json_object' }, temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'OpenAI error');
    return JSON.parse(j.choices[0].message.content);
  }
  throw new Error('No AI key configured (GEMINI_API_KEY or OPENAI_API_KEY)');
}
const txt = v => String(v ?? '').slice(0, 1000);
const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(502).json({ error: e.message }); } };

app.post('/api/translate', wrap(req => askJSON(
  `Translate this Traditional Chinese (Taiwan) text into natural English. Return JSON {"english": string, "alt": string (a more casual alternative), "note": string (short zh-TW note on usage, optional)}.\nText: ${txt(req.body.text)}`)));
app.post('/api/correct', wrap(req => askJSON(
  `You are an English teacher for a Taiwanese learner. Correct the grammar of the sentence (keep meaning; if already correct, return it unchanged). Return JSON {"corrected": string, "isCorrect": boolean, "explanation": string (short Traditional Chinese explanation of each fix, 1-3 sentences)}.\nSentence: ${txt(req.body.text)}`)));
app.post('/api/explain', wrap(req => askJSON(
  `Explain the English word or phrase for a Taiwanese learner. Return JSON {"word": string, "ipa": string, "pos": string, "definition": string (simple English), "zh": string (Traditional Chinese meaning), "example": string, "exampleZh": string}.\nWord: ${txt(req.body.word).slice(0, 80)}`)));
app.post('/api/quizcheck', wrap(req => askJSON(
  `A learner was asked what the English word "${txt(req.body.word).slice(0,80)}" means (reference meaning: ${txt(req.body.meaning).slice(0,200)}). Their answer: "${txt(req.body.answer).slice(0,300)}". Answers may be in English or Chinese. Return JSON {"correct": boolean, "feedback": string (short, Traditional Chinese, encouraging)}.`)));

// ---- Notion ----
const NV = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
let schema = null; // {title: 'Word'}
async function notion(path, method = 'GET', body) {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) throw new Error('Notion not configured (NOTION_TOKEN / NOTION_DATABASE_ID)');
  const r = await fetch('https://api.notion.com/v1/' + path, { method, headers: NV, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error('Notion: ' + (j.message || r.status));
  return j;
}
async function ensureSchema() {
  if (schema) return schema;
  const db = await notion('databases/' + NOTION_DATABASE_ID);
  const titleName = Object.entries(db.properties).find(([, p]) => p.type === 'title')[0];
  const add = {};
  if (titleName !== 'Word' && !db.properties.Word) add[titleName] = { name: 'Word' };
  if (!db.properties.Meaning) add.Meaning = { rich_text: {} };
  if (!db.properties.Example) add.Example = { rich_text: {} };
  if (!db.properties.Added) add.Added = { date: {} };
  if (Object.keys(add).length) await notion('databases/' + NOTION_DATABASE_ID, 'PATCH', { properties: add });
  return (schema = { title: db.properties.Word ? titleName : 'Word' });
}
const plain = p => (p?.title || p?.rich_text || []).map(t => t.plain_text).join('');
app.get('/api/vocab', wrap(async () => {
  const s = await ensureSchema(); const words = []; let cursor;
  do {
    const j = await notion(`databases/${NOTION_DATABASE_ID}/query`, 'POST', { page_size: 100, start_cursor: cursor });
    for (const pg of j.results) words.push({ id: pg.id, word: plain(pg.properties[s.title]), meaning: plain(pg.properties.Meaning), example: plain(pg.properties.Example), added: pg.properties.Added?.date?.start || null });
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && words.length < 2000);
  return { words: words.filter(w => w.word) };
}));
app.post('/api/vocab', wrap(async req => {
  const s = await ensureSchema();
  let { word, meaning, example, added } = req.body;
  word = txt(word).trim().slice(0, 100);
  if (!word) throw new Error('word required');
  if (!meaning || !example) {
    try { const e = await askJSON(`For the English word "${word}" return JSON {"zh": Traditional Chinese meaning, "example": short example sentence}.`); meaning ||= e.zh; example ||= e.example; } catch {}
  }
  const rt = v => ({ rich_text: [{ text: { content: txt(v).slice(0, 1900) } }] });
  const pg = await notion('pages', 'POST', { parent: { database_id: NOTION_DATABASE_ID }, properties: {
    [s.title]: { title: [{ text: { content: word } }] }, Meaning: rt(meaning || ''), Example: rt(example || ''),
    Added: { date: { start: (added || new Date().toISOString()).slice(0, 10) } } } });
  return { ok: true, id: pg.id, word, meaning, example };
}));

app.listen(PORT, () => console.log('english-buddy server on', PORT, 'AI:', provider()));

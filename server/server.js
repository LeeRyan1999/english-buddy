// English Buddy backend: proxies Gemini/OpenAI + Notion. All secrets come from env vars.
import express from 'express';
const {
  PORT = 3000, GEMINI_API_KEY, GEMINI_MODEL = 'gemini-3.5-flash-lite',
  OPENAI_API_KEY, OPENAI_MODEL = 'gpt-4o-mini', AI_PROVIDER,
  NOTION_TOKEN, NOTION_DATABASE_ID, NOTION_PAGE_ID, APP_ACCESS_CODE,
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
app.get('/health', (req, res) => res.json({ ok: true, ai: provider(), notion: NOTION_TOKEN ? (NOTION_PAGE_ID ? 'page' : NOTION_DATABASE_ID ? 'database' : false) : false }));
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
  if (arr.length > 120) return res.status(429).json({ error: '太頻繁，請稍後再試' });
  next();
});

function provider() { return AI_PROVIDER || (GEMINI_API_KEY ? 'gemini' : OPENAI_API_KEY ? 'openai' : null); }
async function askJSON(prompt) {
  const p = provider();
  if (p === 'gemini') {
    const models = [GEMINI_MODEL, ...(process.env.GEMINI_FALLBACKS || 'gemini-flash-lite-latest,gemini-flash-latest').split(',')].filter((m, i, a) => m && a.indexOf(m) === i);
    let last;
    for (const m of models) {
      let r; try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        signal: AbortSignal.timeout(20000), body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } })
      });
      } catch (e) { last = new Error('Gemini timeout (' + m + ')'); continue; }
      const j = await r.json().catch(() => ({}));
      if (r.ok) return JSON.parse(j.candidates?.[0]?.content?.parts?.filter(x => !x.thought).map(x => x.text).join('') || '{}');
      last = new Error(j.error?.message || 'Gemini error ' + r.status);
      if (![429, 500, 503, 404, 400].includes(r.status)) break;
    }
    throw last;
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


const LEVELS={beginner:'Use only very simple, common words (A1-A2) and short sentences.',intermediate:'Use everyday vocabulary (B1-B2).',advanced:'Use natural, rich, idiomatic English (C1).'};
const SCEN={order:'ordering food at a restaurant (you are the waiter)',travel:'travel / at the airport (you are airline or airport staff)',interview:'a job interview (you are the interviewer)',shopping:'shopping in a store (you are the shop assistant)',chat:'casual small talk with a friend'};
app.post('/api/chat', wrap(async req => {
  const msgs = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-16).map(m => `${m.role === 'user' ? 'Learner' : 'You'}: ${txt(m.text).slice(0, 500)}`).join('\n');
  const scen = SCEN[req.body.scenario] || txt(req.body.scenario).slice(0, 200) || SCEN.chat;
  const lvl = LEVELS[req.body.level] || LEVELS.intermediate;
  return askJSON(`You are an English conversation partner for a Taiwanese learner. Role-play scenario: ${scen}. ${lvl} Reply in 1-3 short sentences and ALWAYS end with a question to keep the conversation going. Also check the learner's LAST message for grammar.
Return JSON {"reply": string, "correction": {"corrected": string, "isCorrect": boolean, "note": string (short Traditional Chinese explanation, empty if correct)}}.
If there is no learner message yet, start the conversation and set correction to null.
Conversation so far:\n${msgs || '(none)'}`);
}));


// ---- Gemini Live: mint single-use ephemeral tokens locked to model + config ----
const LIVE_MODEL = process.env.LIVE_MODEL || 'gemini-3.8-live';
app.post('/api/live-token', wrap(async req => {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const scen = SCEN[req.body.scenario] || txt(req.body.scenario).slice(0, 200) || SCEN.chat;
  const lvl = LEVELS[req.body.level] || LEVELS.intermediate;
  const VOICES = ['Puck','Charon','Kore','Fenrir','Aoede','Leda','Orus','Zephyr'];
  const voice = VOICES.includes(req.body.voice) ? req.body.voice : 'Puck';
  const slow = req.body.speed === 'slow';
  const handle = typeof req.body.handle === 'string' && /^[\w\-.:/+=]{1,4096}$/.test(req.body.handle) ? req.body.handle : null;
  const sys = `You are a warm, encouraging English conversation partner for a Taiwanese learner named Lee. Speak ONLY English. Role-play scenario: ${scen}. ${lvl} ${slow ? 'Speak SLOWLY and clearly, with short pauses between phrases and simple words.' : 'Speak at a natural, relaxed pace.'} Keep every reply short: 1-3 sentences, then ALWAYS end with a question to keep the conversation going. Do not lecture about grammar (corrections are shown separately); if Lee seems stuck, gently rephrase your question more simply. When the conversation starts, greet Lee in character. If the session is resumed, continue naturally without greeting again.`;
  const now = Date.now();
  const r = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ uses: 1, expireTime: new Date(now + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(now + 60e3).toISOString(),
      bidiGenerateContentSetup: { model: 'models/' + LIVE_MODEL, generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        systemInstruction: { parts: [{ text: sys }] }, inputAudioTranscription: {}, outputAudioTranscription: {},
        sessionResumption: handle ? { handle } : {}, contextWindowCompression: { slidingWindow: {} },
        realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 200, silenceDurationMs: 800 } } } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('auth_tokens: ' + (j.error?.message || r.status));
  return { token: j.name, model: LIVE_MODEL, voice, resumed: !!handle, expiresInSec: 1800, startWithinSec: 60 };
}));

// ---- Notion ----
const NV = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
let schema = null; // {title: 'Word'}
async function notion(path, method = 'GET', body) {
  if (!NOTION_TOKEN || !(NOTION_DATABASE_ID || NOTION_PAGE_ID)) throw new Error('Notion not configured (NOTION_TOKEN / NOTION_DATABASE_ID)');
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

// ---- Notion page mode: bullets like  word（PRON）：中文解釋 ----
const LINE = /^\s*([A-Za-z][A-Za-z'’.\- ]*?)\s*(?:[（(]([^）)]*)[）)])?\s*[：:]\s*(.+)$/s;
async function pageBullets() {
  const out = []; let cursor;
  do {
    const j = await notion(`blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`);
    for (const b of j.results) if (b.type === 'bulleted_list_item') {
      const t = b.bulleted_list_item.rich_text.map(x => x.plain_text).join('');
      const m = t.match(LINE);
      if (m) out.push({ id: b.id, word: m[1].trim(), pron: (m[2] || '').trim(), meaning: m[3].trim() });
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}
app.get('/api/vocab', (req, res, next) => NOTION_PAGE_ID ? wrap(async () => ({ mode: 'page', words: await pageBullets() }))(req, res) : next());
app.post('/api/vocab', (req, res, next) => NOTION_PAGE_ID ? wrap(async req => {
  let { word, meaning, example, pron } = req.body;
  word = txt(word).trim().slice(0, 100);
  if (!/^[A-Za-z][A-Za-z'’.\- ]*$/.test(word)) throw new Error('請輸入英文單字');
  const existing = await pageBullets();
  const dup = existing.find(w => w.word.toLowerCase() === word.toLowerCase());
  if (dup) return { ok: true, skipped: true, ...dup };
  if (!meaning || !example || !pron) {
    try { const e = await askJSON(`For the English word "${word}" return JSON {"pron": KK/IPA pronunciation without slashes, "zh": concise Traditional Chinese (Taiwan) meaning, "example": short English example sentence}.`); pron ||= e.pron; meaning ||= e.zh; example ||= e.example; } catch {}
  }
  meaning = txt(meaning).replace(/[。\s]+$/, '');
  const line = `${word}${pron ? `（${txt(pron).replace(/^\/|\/$/g, '')}）` : ''}：${meaning}。${example ? `例句：${txt(example)}` : ''}`;
  if (req.body.dryRun || req.query.dryRun) return { ok: true, dryRun: true, line, word, meaning, example };
  await notion(`blocks/${NOTION_PAGE_ID}/children`, 'PATCH', { children: [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(0, 1900) } }] } }] });
  return { ok: true, word, meaning, example, pron };
})(req, res) : next());

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

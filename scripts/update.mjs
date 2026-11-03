// AI Rehberi otomatik g\u00fcncelleyici (Node 20+, ba\u011f\u0131ml\u0131l\u0131ks\u0131z)
import fs from 'node:fs/promises';

const E = process.env;
const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
const headers = { 'User-Agent': 'ai-rehberi-bot/1.0' };
const ghHeaders = { ...headers, Accept: 'application/vnd.github+json', ...(E.GITHUB_TOKEN ? { Authorization: 'Bearer ' + E.GITHUB_TOKEN } : {}) };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEARCH_WAIT = E.FAST ? 0 : 2300;
const CFG = { MAX_TOOLS: 8000, GH_PAGES_PER_RUN: 12, MIN_STARS: 300, NEW_MIN_STARS: 120, CHECK_PER_RUN: 150, TR_PER_RUN: 40, FAIL_LIMIT: 4, NEW_DAYS: 14 };

if (E.ANTHROPIC_API_KEY || E.GEMINI_API_KEY) CFG.TR_PER_RUN = 160;
const FEEDS = [
  ['TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'en'],
  ['The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'en'],
  ['VentureBeat', 'https://venturebeat.com/category/ai/feed/', 'en'],
  ['MIT Technology Review', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'en'],
  ['OpenAI', 'https://openai.com/news/rss.xml', 'en'],
  ['Google', 'https://blog.google/technology/ai/rss/', 'en'],
  ['Hugging Face', 'https://huggingface.co/blog/feed.xml', 'en'],
  ['Webrazzi', 'https://webrazzi.com/feed/', 'tr'],
  ['ShiftDelete', 'https://shiftdelete.net/feed', 'tr'],
  ['Webtekno', 'https://www.webtekno.com/rss.xml', 'tr']
];
const AI_RE = /yapay zek|chatgpt|openai|gemini|claude|llm|\bai\b|\u00fcretken|derin \u00f6\u011fren|makine \u00f6\u011fren|nvidia|copilot|deepseek/i;

/* ---------- Yard\u0131mc\u0131lar ---------- */
// JSON'u sadece ASCII karakterle yazar: T\u00fcrk\u00e7e harfler Not Defteri'nde bozulmaz
const asc = s => s.replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const read = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
async function save(f, text) { let old = null; try { old = await fs.readFile(f, 'utf8'); } catch {} if (old !== text) await fs.writeFile(f, text); }
const listBody = a => '[\n' + a.map(x => asc(JSON.stringify(x))).join(',\n') + '\n]';
async function saveList(f, key, arr) {
  const old = await read(f, {});
  const same = listBody(old[key] || []) === listBody(arr);
  const stamp = same && old.updatedAt ? old.updatedAt : now.toISOString();
  await save(f, '{"updatedAt":"' + stamp + '","' + key + '":' + listBody(arr) + '}\n');
}
async function get(url, opt = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
  try { return await fetch(url, { redirect: 'follow', ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d); } catch { return m; } })
  .replace(/&(nbsp|hellip|rsquo|lsquo|ldquo|rdquo|ndash|mdash);/g, (m, n) => ({ nbsp: ' ', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-' })[n]);
const strip = s => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (b, n) => { const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>', 'i')); return m ? m[1] : ''; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isTr = t => /[\u011f\u011e\u015f\u015e\u0131\u0130]/.test(t || '');

/* ---------- T\u00fcrk\u00e7e \u00e7eviri ----------
   ANTHROPIC_API_KEY tan\u0131ml\u0131ysa Claude ile (daha kaliteli), de\u011filse \u00fccretsiz Google \u00e7eviri u\u00e7 noktas\u0131yla \u00e7evirir. */
/* ---------- Turkce ceviri ----------
   Saglayici sirasi: Gemini (ucretsiz anahtar) -> Claude -> Google gtx -> Lingva -> MyMemory
   Hangi anahtar tanimliysa o kullanilir; hicbiri yoksa anahtarsiz servisler denenir. */
const TSTAT = { ok: 0, fail: 0, provider: '', tried: {}, lastError: '' };
const dead = {};
const NONLATIN = new RegExp('[' + [[0x400,0x4ff],[0x590,0x6ff],[0x900,0xdff],[0xe00,0xe7f],[0x3040,0x30ff],[0x3400,0x9fff],[0xac00,0xd7af]].map(function(r){return String.fromCharCode(r[0])+'-'+String.fromCharCode(r[1]);}).join('') + ']');
const SYS_TR = 'Sen yapay zeka haberleri ve araclari konusunda uzman bir Turkce editorsun. Verilen JSON dizisindeki her metni dogal, akici ve dogru Turkceye cevir. Urun, marka ve model adlarini cevirme. Yalnizca ayni uzunlukta bir JSON dizisi dondur, baska hicbir sey yazma.';

function parseArr(txt, n) {
  const a = txt.indexOf('['), b = txt.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('dizi bulunamadi');
  const arr = JSON.parse(txt.slice(a, b + 1));
  if (!Array.isArray(arr) || arr.length !== n) throw new Error('uzunluk uyumsuz (' + (arr || []).length + '/' + n + ')');
  return arr.map(String);
}

/* --- Gemini: Google AI Studio ucretsiz anahtari (GEMINI_API_KEY) --- */
let geminiModel = null;
async function geminiPick() {
  if (geminiModel) return geminiModel;
  const r = await get('https://generativelanguage.googleapis.com/v1beta/models?key=' + E.GEMINI_API_KEY, { headers });
  if (!r.ok) throw new Error('model listesi HTTP ' + r.status);
  const ms = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && !/embedding|aqa|image|vision|tts|audio|video|learnlm/i.test(m.name));
  if (!ms.length) throw new Error('uygun model yok');
  const score = m => {
    const n = m.name; let s = 0;
    if (/flash/i.test(n)) s += 20;
    if (/lite/i.test(n)) s += 4;
    if (/pro/i.test(n)) s += 2;
    if (/preview|exp|thinking/i.test(n)) s -= 8;
    const v = parseFloat((n.match(/-(\d+(?:\.\d+)?)-/) || [])[1] || 0);
    return s + v;
  };
  ms.sort((a, b) => score(b) - score(a));
  geminiModel = ms[0].name.replace(/^models\//, '');
  console.log('Gemini modeli:', geminiModel);
  return geminiModel;
}
async function geminiTr(texts) {
  const model = await geminiPick();
  const r = await get('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + E.GEMINI_API_KEY, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYS_TR }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(texts) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: 'application/json' }
    })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const parts = (((await r.json()).candidates || [])[0] || {}).content;
  return parseArr(((parts || {}).parts || []).map(p => p.text || '').join(''), texts.length);
}

/* --- Claude (ANTHROPIC_API_KEY) --- */
async function claudeTr(texts) {
  const r = await get('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 4000, system: SYS_TR, messages: [{ role: 'user', content: JSON.stringify(texts) }] })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return parseArr(((await r.json()).content || []).map(c => c.text || '').join(''), texts.length);
}

/* --- Anahtarsiz ucretsiz servisler (metin metin) --- */
async function gtx(text) {
  const r = await get('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=' + encodeURIComponent(text.slice(0, 1500)), { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j[0].map(x => x[0]).join('');
}
async function lingva(text) {
  const hosts = ['lingva.ml', 'lingva.garudalinux.org', 'translate.plausibility.cloud'];
  let last = '';
  for (const h of hosts) {
    try {
      const r = await get('https://' + h + '/api/v1/auto/tr/' + encodeURIComponent(text.slice(0, 1200)), { headers });
      if (!r.ok) { last = 'HTTP ' + r.status; continue; }
      const t = (await r.json()).translation;
      if (t && t.trim()) return t;
      last = 'bos yanit';
    } catch (e) { last = e.message; }
  }
  throw new Error(last || 'ulasilamadi');
}
async function mymemory(text) {
  if (NONLATIN.test(text)) throw new Error('latin disi metin');
  const mail = E.MYMEMORY_EMAIL ? '&de=' + encodeURIComponent(E.MYMEMORY_EMAIL) : '';
  const r = await get('https://api.mymemory.translated.net/get?langpair=en%7Ctr' + mail + '&q=' + encodeURIComponent(text.slice(0, 450)), { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(), t = j && j.responseData && j.responseData.translatedText;
  if (!t || Number(j.responseStatus) !== 200 || /MYMEMORY WARNING|QUERY LENGTH|INVALID|LIMIT/i.test(t)) throw new Error(String(j.responseDetails || t || 'bos').slice(0, 80));
  return t;
}

async function translate(texts) {
  const batch = [];
  if (E.GEMINI_API_KEY) batch.push(['gemini', geminiTr]);
  if (E.ANTHROPIC_API_KEY) batch.push(['claude', claudeTr]);
  for (const [name, fn] of batch) {
    if (dead[name] >= 3) continue;
    TSTAT.tried[name] = (TSTAT.tried[name] || 0) + 1;
    try {
      const r = await fn(texts);
      dead[name] = 0; TSTAT.ok += r.length; TSTAT.provider = name;
      return r;
    } catch (e) {
      dead[name] = (dead[name] || 0) + 1;
      TSTAT.lastError = name + ': ' + String(e.message).slice(0, 120);
      console.warn('Ceviri hatasi (' + name + '):', e.message);
    }
  }
  const solo = [['gtx', gtx], ['lingva', lingva], ['mymemory', mymemory]];
  const out = [];
  for (const t of texts) {
    let res = null;
    for (const [name, fn] of solo) {
      if (dead[name] >= 5) continue;
      TSTAT.tried[name] = (TSTAT.tried[name] || 0) + 1;
      try {
        const v = await fn(t);
        if (v && v.trim()) { dead[name] = 0; TSTAT.provider = name; res = v; break; }
        dead[name] = (dead[name] || 0) + 1;
      } catch (e) {
        dead[name] = (dead[name] || 0) + 1;
        TSTAT.lastError = name + ': ' + String(e.message).slice(0, 120);
      }
    }
    if (res) TSTAT.ok++; else TSTAT.fail++;
    out.push(res);
    await sleep(E.FAST ? 0 : 300);
  }
  return out;
}

/* ---------- 1) HABERLER ---------- */
async function updateNews() {
  const old = await read('data/news.json', { items: [] });
  old.items.forEach(i => { i.title = strip(i.title || ''); i.description = strip(i.description || ''); if (i.titleOrig) i.titleOrig = strip(i.titleOrig); });
  const map = new Map(old.items.map(i => [i.link, i]));
  for (const [source, url, lang] of FEEDS) {
    try {
      const r = await get(url, { headers }); if (!r.ok) throw new Error(r.status);
      const xml = await r.text();
      for (const b of (xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || []).slice(0, 15)) {
        const link = strip(tag(b, 'link')) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
        if (!/^https?:\/\//.test(link) || map.has(link)) continue;
        const d = new Date(strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated')) || now);
        const title = strip(tag(b, 'title'));
        const description = strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded')).slice(0, 400);
        if (isNaN(d) || !title) continue;
        if (lang === 'tr' && !AI_RE.test(title + ' ' + description)) continue;
        map.set(link, { title, titleOrig: title, link, source, lang, tr: lang === 'tr', description, pubDate: d.toISOString().replace('T', ' ').slice(0, 19) });
      }
    } catch (e) { console.warn('Haber kayna\u011f\u0131 al\u0131namad\u0131:', source, e.message); }
  }
  const items = [...map.values()].sort((a, b) => b.pubDate.localeCompare(a.pubDate)).slice(0, 150);
  const todo = items.filter(i => !i.tr).slice(0, CFG.TR_PER_RUN);
  for (let i = 0; i < todo.length; i += 8) {
    const b = todo.slice(i, i + 8);
    b.forEach(n => { n.titleOrig = n.titleOrig || n.title; });
    const out = await translate(b.flatMap(n => [n.titleOrig, n.description || '.']));
    b.forEach((n, k) => { const t = out[2 * k], d = out[2 * k + 1]; if (t) { n.title = t; if (d && n.description) n.description = d; n.tr = true; } });
  }
  await saveList('data/news.json', 'items', items);
  console.log('Haber:', items.length, '| \u00e7evrilen:', todo.filter(n => n.tr).length);
}

/* ---------- 2) ARA\u00c7LAR ---------- */
const CATS_KW = [
  ['Video', /video|animation|3d|film/], ['M\u00fczik', /music|audio|voice|speech|tts|asr|whisper|song|sound/],
  ['G\u00f6rsel', /image|diffusion|photo|logo|illustration|drawing|design/], ['Kodlama', /code|coding|developer|programming|copilot|sdk|ide\b/],
  ['\u00dcretkenlik', /agent|workflow|automation|productivity|rag|knowledge|assistant|seo|marketing|slides|meeting/]
];
const guess = t => { t = (t || '').toLowerCase(); for (const [c, re] of CATS_KW) if (re.test(t)) return c; return 'Metin'; };
const ghNote = t => t.source === 'github' ? '\n\nA\u00e7\u0131k kaynak proje. GitHub: https://github.com/' + t.repo + ' (\u2b50 ' + (t.stars || 0).toLocaleString('tr-TR') + ')' : '';
const compose = t => ((t.descTr || t.descOrig || '') + ghNote(t)).trim();
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const JUNK = /(^|[^a-z])(awesome|tutorials?|courses?|roadmaps?|cheat.?sheets?|interviews?|handbooks?|curriculum|bootcamp|lectures?|notes?|papers?|surveys?|collections?|resources?|guides?|books?|examples?|demos?|templates?|boilerplate|starter|playground|exercises?|practice|learning|study|zero.to|from.scratch|100.?days|prompts?|katas?|challenges?|portfolio|blog|docs?|dotfiles|config)([^a-z]|$)/i;
const isJunk = t => JUNK.test(t) || String(t).length < 25;
const GH_TOPICS = ['llm', 'chatgpt', 'generative-ai', 'ai-agents', 'large-language-models', 'text-to-image', 'stable-diffusion', 'text-to-speech', 'speech-recognition', 'code-generation', 'rag', 'ai-tools', 'openai', 'langchain', 'image-generation', 'text-to-video', 'ai-assistant', 'chatbot'];

async function ghSearch(q, page) {
  const r = await get('https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&sort=stars&order=desc&per_page=100&page=' + page, { headers: ghHeaders });
  if (r.status === 403 || r.status === 429) return null;
  return r.ok ? ((await r.json()).items || []) : [];
}
async function alive(url) {
  try {
    let r = await get(url, { method: 'HEAD', headers });
    if ([403, 405, 501].includes(r.status)) r = await get(url, { headers });
    return r.status < 400 || [401, 403, 429].includes(r.status);
  } catch { return false; }
}

async function updateTools() {
  const db = await read('data/tools.json', { tools: [] });
  const block = await read('data/blocklist.json', { ids: [], words: [] });
  const state = await read('data/state.json', {});
  const log = await read('data/changelog.json', []);
  const ev = (type, t) => { log.unshift({ at: now.toISOString(), type, id: t.id, title: t.title }); console.log(type, t.title); };
  let tools = db.tools;
  // eski bi\u00e7imden d\u00f6n\u00fc\u015ft\u00fcr
  for (const t of tools) {
    if (t.descOrig === undefined) {
      if (t.source === 'github') { t.descOrig = (t.desc || '').split('\n\nA\u00e7\u0131k kaynak')[0]; t.tr = false; }
      else { t.descOrig = t.desc || ''; t.tr = true; }
    }
  }
  tools = tools.filter(t => !(t.source === 'github' && (NONLATIN.test(t.descOrig || '') || isJunk(t.title + ' ' + (t.descOrig || '')))));
  const byId = new Map(tools.map(t => [t.id, t]));
  const hosts = new Set(tools.map(t => hostOf(t.url)));
  const bad = txt => block.words.some(w => txt.includes(w));

  const addRepo = (p, announce) => {
    const id = 'gh-' + slug(p.full_name);
    const text = (p.name + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
    if (byId.has(id) || block.ids.includes(id) || p.fork || p.archived || !p.description || NONLATIN.test(p.description) || bad(text) || tools.length >= CFG.MAX_TOOLS) return;
    if (isJunk(p.name + ' ' + p.description)) return;
    const t = { id, title: p.name, category: guess(text), price: '\u00dccretsiz', url: p.homepage && /^https?:/.test(p.homepage) ? p.homepage : p.html_url,
      featured: false, descOrig: p.description, tr: false, source: 'github', repo: p.full_name, stars: p.stargazers_count,
      status: 'active', failCount: 0, addedAt: (p.created_at || now.toISOString()).slice(0, 10) };
    tools.push(t); byId.set(id, t);
    if (announce) ev('added', t);
  };

  // a) Yeni \u00e7\u0131kan a\u00e7\u0131k kaynak projeler (son 10 g\u00fcn)
  const since = new Date(now - 10 * 864e5).toISOString().slice(0, 10);
  for (const topic of GH_TOPICS.slice(0, 6)) {
    const items = await ghSearch(`topic:${topic} created:>${since} stars:>${CFG.NEW_MIN_STARS} fork:false`, 1);
    if (items === null) { console.warn('GitHub arama limiti'); break; }
    items.forEach(p => addRepo(p, true)); await sleep(SEARCH_WAIT);
  }
  // b) Geriye d\u00f6n\u00fck tarama: her \u00e7al\u0131\u015fmada kald\u0131\u011f\u0131 yerden devam eder, zamanla t\u00fcm pop\u00fcler projeleri toplar
  let { t: ti = 0, p: pg = 1 } = state.gh || {};
  for (let n = 0; n < CFG.GH_PAGES_PER_RUN && tools.length < CFG.MAX_TOOLS; n++) {
    const topic = GH_TOPICS[ti % GH_TOPICS.length];
    const items = await ghSearch(`topic:${topic} stars:>${CFG.MIN_STARS} fork:false archived:false`, pg);
    if (items === null) { console.warn('GitHub arama limiti'); break; }
    items.forEach(p => addRepo(p, false));
    if (items.length < 100 || pg >= 10) { ti++; pg = 1; } else pg++;
    await sleep(SEARCH_WAIT);
  }
  state.gh = { t: ti % GH_TOPICS.length, p: pg };

  // c) Product Hunt (ticari yeni ara\u00e7lar) - PRODUCTHUNT_TOKEN tan\u0131ml\u0131ysa \u00e7al\u0131\u015f\u0131r
  if (E.PRODUCTHUNT_TOKEN) {
    const q = 'query($after:String){ posts(topic:"artificial-intelligence", order:NEWEST, first:20, after:$after){ pageInfo{endCursor hasNextPage} edges{ node{ name tagline description website createdAt } } } }';
    const pages = [null, state.ph && state.ph.after ? state.ph.after : null];
    let cursor = null;
    for (let i = 0; i < 6; i++) {
      const after = i === 0 ? null : cursor || (i === 1 ? (state.ph && state.ph.after) || null : null);
      if (i > 0 && !after) break;
      try {
        const r = await get('https://api.producthunt.com/v2/api/graphql', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', Authorization: 'Bearer ' + E.PRODUCTHUNT_TOKEN }, body: JSON.stringify({ query: q, variables: { after } }) });
        if (!r.ok) throw new Error(r.status);
        const posts = (await r.json()).data.posts;
        for (const { node: n } of posts.edges) {
          const id = 'ph-' + slug(n.name);
          if (byId.has(id) || block.ids.includes(id) || tools.length >= CFG.MAX_TOOLS || bad((n.name + ' ' + n.tagline).toLowerCase())) continue;
          let site = ''; try { site = new URL((await get(n.website, { headers })).url).origin; } catch {}
          if (!site || /producthunt\.com/.test(site) || hosts.has(hostOf(site))) continue;
          const t = { id, title: n.name, category: guess(n.name + ' ' + n.tagline + ' ' + (n.description || '')), price: 'Belirsiz', url: site, featured: false,
            descOrig: (n.tagline + '. ' + (n.description || '')).slice(0, 300), tr: false, source: 'producthunt', status: 'active', failCount: 0, addedAt: n.createdAt.slice(0, 10) };
          tools.push(t); byId.set(id, t); hosts.add(hostOf(site)); ev('added', t);
        }
        cursor = posts.pageInfo.hasNextPage ? posts.pageInfo.endCursor : null;
        if (i >= 1) state.ph = { after: cursor };
      } catch (e) { console.warn('Product Hunt hatas\u0131:', e.message); break; }
    }
  }

  // d) Sa\u011fl\u0131k kontrol\u00fc: en uzun s\u00fcredir bak\u0131lmayan ara\u00e7lar (her \u00e7al\u0131\u015fmada bir k\u0131sm\u0131)
  const batch = tools.filter(t => !t.locked).sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || '')).slice(0, CFG.CHECK_PER_RUN);
  const check = async t => {
    t.checkedAt = now.toISOString();
    if (t.source === 'github') {
      const r = await get('https://api.github.com/repos/' + t.repo, { headers: ghHeaders }).catch(() => null);
      if (r && (r.status === 404 || r.status === 451)) { t.remove = true; return ev('removed', t); }
      if (r && r.ok) {
        const p = await r.json();
        if (p.archived) { t.remove = true; return ev('removed', t); }
        t.stars = p.stargazers_count;
        if (p.description && p.description !== t.descOrig) { t.descOrig = p.description; t.tr = false; delete t.descTr; }
        if (p.homepage && /^https?:/.test(p.homepage)) t.url = p.homepage;
      }
      if (hostOf(t.url) === 'github.com') return;
    }
    if (await alive(t.url)) { if (t.status === 'inactive') ev('restored', t); t.failCount = 0; t.status = 'active'; }
    else { t.failCount = (t.failCount || 0) + 1; if (t.failCount >= CFG.FAIL_LIMIT && t.status !== 'inactive') { t.status = 'inactive'; ev('hidden', t); } }
  };
  for (let i = 0; i < batch.length; i += 8) await Promise.all(batch.slice(i, i + 8).map(check));
  tools = tools.filter(t => !t.remove);

  // e) T\u00fcrk\u00e7e \u00e7eviri (her \u00e7al\u0131\u015fmada en pop\u00fcler \u00e7evrilmemi\u015flerden bir k\u0131sm\u0131)
  tools.forEach(t => { if (!t.tr && isTr(t.descOrig)) t.tr = true; });
  const need = tools.filter(t => !t.tr && t.descOrig).sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, CFG.TR_PER_RUN);
  for (let i = 0; i < need.length; i += 8) {
    const b = need.slice(i, i + 8);
    const out = await translate(b.map(t => t.descOrig.slice(0, 300)));
    b.forEach((t, k) => { if (out[k]) { t.descTr = out[k]; t.tr = true; } });
  }

  // f) Son r\u00f6tu\u015flar
  tools.forEach(t => { t.desc = compose(t); t.isNew = (now - new Date(t.addedAt)) < CFG.NEW_DAYS * 864e5; });
  await saveList('data/tools.json', 'tools', tools);
  await save('data/state.json', asc(JSON.stringify(state)) + '\n');
  await save('data/changelog.json', asc(JSON.stringify(log.slice(0, 100), null, 1)) + '\n');
  console.log('Toplam ara\u00e7:', tools.length, '| \u00e7evrilen:', need.filter(t => t.tr).length);
}

/* ---------- 3) CLAUDE EKLENTILERI (MCP sunuculari, Claude Code araclari) ---------- */
const PLUGIN_QUERIES = [
  ['topic:mcp-server stars:>20 fork:false archived:false', 'MCP Sunucusu'],
  ['topic:model-context-protocol stars:>20 fork:false archived:false', 'MCP Sunucusu'],
  ['topic:mcp stars:>60 fork:false archived:false', 'MCP Sunucusu'],
  ['topic:claude-code stars:>15 fork:false archived:false', 'Claude Code'],
  ['topic:claude stars:>40 fork:false archived:false', 'Claude Araci'],
  ['topic:anthropic stars:>40 fork:false archived:false', 'Claude Araci'],
  ['"claude code" plugin in:name,description stars:>25 fork:false archived:false', 'Claude Code']
];
function pluginCat(p, fallback) {
  const s = (p.name + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
  if (/\bsdk\b|client library|api client/.test(s)) return 'SDK';
  if (/mcp[- ]?server|model.context.protocol/.test(s)) return 'MCP Sunucusu';
  if (/claude.code|slash command|subagent|skill/.test(s)) return 'Claude Code';
  if (/awesome|curated|list of/.test(s)) return 'Derleme';
  return fallback || 'Claude Araci';
}
async function updatePlugins() {
  const db = await read('data/plugins.json', { plugins: [] });
  const block = await read('data/blocklist.json', { ids: [], words: [] });
  let plugins = db.plugins || [];
  const byId = new Map(plugins.map(p => [p.id, p]));

  for (const [q, cat] of PLUGIN_QUERIES) {
    const items = await ghSearch(q, 1);
    if (items === null) { console.warn('GitHub arama limiti (eklenti)'); break; }
    for (const p of items) {
      const id = 'gh-' + slug(p.full_name);
      const text = (p.name + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
      if (byId.has(id) || block.ids.includes(id) || !p.description || NONLATIN.test(p.description)) continue;
      if (block.words.some(w => text.includes(w)) || plugins.length >= 600) continue;
      const t = { id, repo: p.full_name, title: p.name, url: p.html_url, desc: '', descOrig: p.description, tr: false,
        stars: p.stargazers_count, owner: (p.owner || {}).login || p.full_name.split('/')[0],
        category: pluginCat(p, cat), status: 'active', failCount: 0, addedAt: (p.created_at || now.toISOString()).slice(0, 10) };
      plugins.push(t); byId.set(id, t);
    }
    await sleep(SEARCH_WAIT);
  }

  // Saglik kontrolu ve guncelleme
  const batch = plugins.sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || '')).slice(0, 60);
  for (let i = 0; i < batch.length; i += 8) await Promise.all(batch.slice(i, i + 8).map(async t => {
    t.checkedAt = now.toISOString();
    const r = await get('https://api.github.com/repos/' + t.repo, { headers: ghHeaders }).catch(() => null);
    if (r && (r.status === 404 || r.status === 451)) { t.remove = true; return; }
    if (r && r.ok) {
      const p = await r.json();
      if (p.archived) { t.remove = true; return; }
      t.stars = p.stargazers_count;
      t.url = p.html_url;
      t.owner = (p.owner || {}).login || t.owner;
      if (p.description && p.description !== t.descOrig) { t.descOrig = p.description; t.tr = false; delete t.descTr; }
      t.category = pluginCat(p, t.category);
    }
  }));
  plugins = plugins.filter(p => !p.remove);

  // Turkce ceviri
  plugins.forEach(p => { if (!p.tr && isTr(p.descOrig)) p.tr = true; });
  const need = plugins.filter(p => !p.tr && p.descOrig).sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 60);
  for (let i = 0; i < need.length; i += 8) {
    const b = need.slice(i, i + 8);
    const out = await translate(b.map(p => p.descOrig.slice(0, 300)));
    b.forEach((p, k) => { if (out[k]) { p.descTr = out[k]; p.tr = true; } });
  }
  plugins.forEach(p => { p.desc = (p.descTr || p.descOrig || '').trim(); p.isNew = (now - new Date(p.addedAt)) < CFG.NEW_DAYS * 864e5; });
  plugins.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  await saveList('data/plugins.json', 'plugins', plugins);
  console.log('Claude eklentisi:', plugins.length, '| cevrilen:', need.filter(p => p.tr).length);
}

/* ---------- 4) E-KITAPLAR (baglanti sagligi) ---------- */
async function updateEbooks() {
  const db = await read('data/ebooks.json', { books: [] });
  const books = db.books || [];
  if (!books.length) return;
  const batch = books.sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || '')).slice(0, 20);
  for (let i = 0; i < batch.length; i += 5) await Promise.all(batch.slice(i, i + 5).map(async b => {
    b.checkedAt = now.toISOString();
    if (await alive(b.url)) { b.failCount = 0; b.status = 'active'; }
    else { b.failCount = (b.failCount || 0) + 1; if (b.failCount >= CFG.FAIL_LIMIT) b.status = 'inactive'; }
  }));
  await saveList('data/ebooks.json', 'books', books);
  console.log('E-kitap:', books.length, '| erisilemeyen:', books.filter(b => b.status === 'inactive').length);
}

await updateNews();
await updateTools();
await updatePlugins();
await updateEbooks();
await save('data/status.json', JSON.stringify({ translate: TSTAT }) + '\n');
console.log('Ceviri durumu:', JSON.stringify(TSTAT));

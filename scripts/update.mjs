// AI Rehberi otomatik g\u00fcncelleyici (Node 20+, ba\u011f\u0131ml\u0131l\u0131ks\u0131z)
import fs from 'node:fs/promises';

const E = process.env;
const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
const headers = { 'User-Agent': 'ai-rehberi-bot/1.0' };
const ghHeaders = { ...headers, Accept: 'application/vnd.github+json', ...(E.GITHUB_TOKEN ? { Authorization: 'Bearer ' + E.GITHUB_TOKEN } : {}) };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEARCH_WAIT = E.FAST ? 0 : 2300;
const CFG = { MAX_TOOLS: 8000, GH_PAGES_PER_RUN: 12, MIN_STARS: 300, NEW_MIN_STARS: 50, CHECK_PER_RUN: 150, TR_PER_RUN: 40, FAIL_LIMIT: 4, NEW_DAYS: 14 };

if (E.ANTHROPIC_API_KEY) CFG.TR_PER_RUN = 160;
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
async function gtx(text) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=' + encodeURIComponent(text.slice(0, 1500));
  const r = await get(u, { headers }); if (!r.ok) throw new Error(r.status);
  const j = await r.json(); return j[0].map(x => x[0]).join('');
}
async function claudeTr(texts) {
  const r = await get('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 4000,
      system: 'Sen yapay zeka haberleri ve ara\u00e7lar\u0131 konusunda uzman bir T\u00fcrk\u00e7e edit\u00f6rs\u00fcn. Verilen JSON dizisindeki her metni do\u011fal, ak\u0131c\u0131 ve do\u011fru T\u00fcrk\u00e7eye \u00e7evir. \u00dcr\u00fcn, marka ve model adlar\u0131n\u0131 \u00e7evirme. Yaln\u0131zca ayn\u0131 uzunlukta bir JSON dizisi d\u00f6nd\u00fcr, ba\u015fka hi\u00e7bir \u015fey yazma.',
      messages: [{ role: 'user', content: JSON.stringify(texts) }]
    })
  });
  if (!r.ok) throw new Error('Claude ' + r.status);
  const txt = ((await r.json()).content || []).map(c => c.text || '').join('');
  const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('Claude \u00e7\u0131kt\u0131s\u0131 uyumsuz');
  return arr.map(String);
}
const TSTAT = { ok: 0, fail: 0, provider: '', lastError: '' };
const dead = { gtx: 0, mymemory: 0 };
const NONLATIN = /[\u0400-\u04ff\u0590-\u06ff\u0900-\u0dff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
async function mymemory(text) {
  if (NONLATIN.test(text)) throw new Error('latin disi metin');
  const r = await get('https://api.mymemory.translated.net/get?langpair=en%7Ctr&q=' + encodeURIComponent(text.slice(0, 450)), { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); const t = j && j.responseData && j.responseData.translatedText;
  if (!t || Number(j.responseStatus) !== 200 || /MYMEMORY WARNING|QUERY LENGTH|INVALID/i.test(t)) throw new Error('yanit: ' + String(j.responseDetails || t || 'bos').slice(0, 80));
  return t;
}
async function translate(texts) {
  if (E.ANTHROPIC_API_KEY) {
    try { const r = await claudeTr(texts); TSTAT.ok += r.length; TSTAT.provider = 'claude'; return r; }
    catch (e) { TSTAT.lastError = 'claude: ' + e.message; console.warn('Claude ceviri hatasi:', e.message); }
  }
  const out = [];
  for (const t of texts) {
    let res = null;
    for (const [name, fn] of [['gtx', gtx], ['mymemory', mymemory]]) {
      if (dead[name] >= 4) continue;
      try { res = await fn(t); if (res && res.trim()) { dead[name] = 0; TSTAT.provider = name; break; } res = null; dead[name]++; }
      catch (e) { dead[name]++; TSTAT.lastError = name + ': ' + String(e.message).slice(0, 100); }
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
  tools = tools.filter(t => !(t.source === 'github' && !t.tr && NONLATIN.test(t.descOrig || '')));
  const byId = new Map(tools.map(t => [t.id, t]));
  const hosts = new Set(tools.map(t => hostOf(t.url)));
  const bad = txt => block.words.some(w => txt.includes(w));

  const addRepo = (p, announce) => {
    const id = 'gh-' + slug(p.full_name);
    const text = (p.name + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
    if (byId.has(id) || block.ids.includes(id) || p.fork || p.archived || !p.description || NONLATIN.test(p.description) || bad(text) || tools.length >= CFG.MAX_TOOLS) return;
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

await updateNews();
await updateTools();
await save('data/status.json', JSON.stringify({ translate: TSTAT }) + '\n');
console.log('Ceviri durumu:', JSON.stringify(TSTAT));

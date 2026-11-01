// AI Rehberi otomatik güncelleyici. Node 20+, bağımlılık yok.
import fs from 'node:fs/promises';

const FEEDS = [
  ['TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['VentureBeat', 'https://venturebeat.com/category/ai/feed/'],
  ['MIT Technology Review', 'https://www.technologyreview.com/topic/artificial-intelligence/feed'],
  ['OpenAI', 'https://openai.com/news/rss.xml'],
  ['Google', 'https://blog.google/technology/ai/rss/'],
  ['Hugging Face', 'https://huggingface.co/blog/feed.xml']
];
const MIN_STARS = 150;      // otomatik eklenecek yeni açık kaynak araç için alt sınır
const FAIL_LIMIT = 4;       // üst üste bu kadar başarısız kontrolde araç gizlenir
const NEW_DAYS = 14;        // "Yeni" rozeti süresi
const now = new Date();
const headers = { 'User-Agent': 'ai-rehberi-bot/1.0' };
const ghHeaders = { ...headers, Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) };

const read = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const write = (f, o) => fs.writeFile(f, JSON.stringify(o, null, 2));
async function get(url, opt = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
  try { return await fetch(url, { redirect: 'follow', ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
const strip = s => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (b, n) => { const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>', 'i')); return m ? m[1] : ''; };

/* ---------- 1) HABERLER ---------- */
async function updateNews() {
  const old = await read('data/news.json', { items: [] });
  const map = new Map(old.items.map(i => [i.link, i]));
  for (const [source, url] of FEEDS) {
    try {
      const r = await get(url, { headers }); if (!r.ok) throw new Error(r.status);
      const xml = await r.text();
      const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
      for (const b of blocks.slice(0, 15)) {
        let link = strip(tag(b, 'link')) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
        if (!/^https?:\/\//.test(link)) continue;
        const d = new Date(strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated')) || now);
        if (isNaN(d)) continue;
        if (map.has(link)) continue;
        map.set(link, {
          title: strip(tag(b, 'title')), link, source,
          description: strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded')).slice(0, 400),
          pubDate: d.toISOString().replace('T', ' ').slice(0, 19)
        });
      }
    } catch (e) { console.warn('Haber kaynağı alınamadı:', source, e.message); }
  }
  const items = [...map.values()].filter(i => i.title).sort((a, b) => b.pubDate.localeCompare(a.pubDate)).slice(0, 120);
  await write('data/news.json', { updatedAt: now.toISOString(), items });
  console.log('Haber sayısı:', items.length);
}

/* ---------- 2) ARAÇLAR ---------- */
const guess = t => {
  t = t.toLowerCase();
  if (/(video|animation|3d|diffusion video)/.test(t)) return 'Video';
  if (/(music|audio|voice|speech|tts|asr)/.test(t)) return 'Müzik';
  if (/(image|diffusion|text-to-image|design)/.test(t)) return 'Görsel';
  if (/(code|coding|developer|ide|agent for dev)/.test(t)) return 'Kodlama';
  if (/(agent|workflow|automation|productivity|rag|knowledge)/.test(t)) return 'Üretkenlik';
  return 'Metin';
};

async function alive(url) {
  try {
    let r = await get(url, { method: 'HEAD', headers });
    if (r.status === 405 || r.status === 403 || r.status === 501) r = await get(url, { headers });
    // 401/403/429: bot engeli, site ayakta sayılır
    return r.status < 400 || [401, 403, 429].includes(r.status);
  } catch { return false; }
}

async function updateTools() {
  const db = await read('data/tools.json', { tools: [] });
  const block = await read('data/blocklist.json', { ids: [], words: [] });
  const log = await read('data/changelog.json', []);
  const ev = (type, t) => { log.unshift({ at: now.toISOString(), type, id: t.id, title: t.title }); console.log(type, t.title); };
  let tools = db.tools;
  const byId = new Map(tools.map(t => [t.id, t]));

  // a) Yeni araç keşfi (GitHub'da son 10 günde açılan, popüler AI depoları)
  const since = new Date(now - 10 * 864e5).toISOString().slice(0, 10);
  for (const topic of ['llm', 'ai-agent', 'generative-ai', 'text-to-image', 'speech-recognition']) {
    try {
      const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>${MIN_STARS}`);
      const r = await get(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=10`, { headers: ghHeaders });
      if (!r.ok) continue;
      for (const p of (await r.json()).items || []) {
        const id = 'gh-' + p.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const text = (p.name + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
        if (byId.has(id) || block.ids.includes(id) || p.fork || p.archived || !p.description) continue;
        if (block.words.some(w => text.includes(w))) continue;
        const t = { id, title: p.name, category: guess(text), price: 'Ücretsiz', url: p.homepage && /^https?:/.test(p.homepage) ? p.homepage : p.html_url,
          featured: false, desc: p.description + '\n\nAçık kaynak proje. GitHub: ' + p.html_url + ' (⭐ ' + p.stargazers_count + ')',
          source: 'github', repo: p.full_name, status: 'active', failCount: 0, addedAt: now.toISOString().slice(0, 10) };
        tools.push(t); byId.set(id, t); ev('added', t);
      }
    } catch (e) { console.warn('Keşif hatası', topic, e.message); }
  }

  // b) Mevcut araçların sağlık kontrolü ve güncelleme
  const check = async t => {
    if (t.locked) return;
    if (t.source === 'github') {
      const r = await get('https://api.github.com/repos/' + t.repo, { headers: ghHeaders }).catch(() => null);
      if (r && (r.status === 404 || r.status === 451)) { t.remove = true; return ev('removed', t); }
      if (r && r.ok) {
        const p = await r.json();
        if (p.archived) { t.remove = true; return ev('removed', t); }
        if (p.description && !t.desc.startsWith(p.description)) t.desc = p.description + '\n\nAçık kaynak proje. GitHub: ' + p.html_url + ' (⭐ ' + p.stargazers_count + ')';
        if (p.homepage && /^https?:/.test(p.homepage)) t.url = p.homepage;
      }
    }
    const ok = await alive(t.url);
    if (ok) { if (t.status === 'inactive') ev('restored', t); t.failCount = 0; t.status = 'active'; }
    else { t.failCount = (t.failCount || 0) + 1; if (t.failCount >= FAIL_LIMIT && t.status !== 'inactive') { t.status = 'inactive'; ev('hidden', t); } }
  };
  for (let i = 0; i < tools.length; i += 8) await Promise.all(tools.slice(i, i + 8).map(check));
  tools = tools.filter(t => !t.remove);

  // c) "Yeni" rozeti
  tools.forEach(t => { t.isNew = (now - new Date(t.addedAt)) < NEW_DAYS * 864e5; });

  await write('data/tools.json', { updatedAt: now.toISOString(), tools });
  await write('data/changelog.json', log.slice(0, 100));
  console.log('Toplam araç:', tools.length);
}

await updateNews();
await updateTools();

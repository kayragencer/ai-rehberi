// Arama motorları için gerçek adresli sayfalar üretir:
//   /arac/<id>/         her hazır araç için bir sayfa
//   /kategori/<slug>/   kategori listeleri
//   /rehber/<slug>/     konu rehberleri (ücretsiz, Türkçe bilen araçlar vb.)
// Ayrıca sitemap.xml'i yeniler. Çalıştırma: node scripts/build-pages.mjs
// Veri: data/tools.json + data/tr-info.json. Sayfalar site.css kullanır, sitenin ana uygulamasından bağımsızdır.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://seninyapayzekan.com';
const today = new Date().toISOString().slice(0, 10);

const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tools.json'), 'utf8')).tools;
const trAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tr-info.json'), 'utf8'));
const tr = trAll.tools || trAll;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const J = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const CATS = {
  Metin: ['metin-sohbet', 'Metin & Sohbet', 'Yazı yazma, özetleme, çeviri ve sohbet için yapay zeka araçları.'],
  Görsel: ['gorsel-tasarim', 'Görsel & Tasarım', 'Görsel üretme, logo, tasarım ve fotoğraf düzenleme araçları.'],
  Müzik: ['muzik-ses', 'Müzik & Ses', 'Müzik üretme, seslendirme ve ses düzenleme araçları.'],
  Kodlama: ['kodlama', 'Kodlama', 'Kod yazmayı ve hata ayıklamayı kolaylaştıran yapay zeka araçları.'],
  Video: ['video-3d', 'Video & 3D', 'Video üretme, düzenleme ve 3D araçları.'],
  Üretkenlik: ['uretkenlik-seo', 'Üretkenlik & SEO', 'Günlük işleri, sunumları, notları ve SEO çalışmalarını hızlandıran araçlar.'],
};

// Sitede gösterilen hazır araçlar: elle seçilmiş, kapanmamış, kalite filtresinden geçmiş
const list = tools.filter((t) => {
  const d = tr[t.id];
  return t.source === 'curated' && t.status !== 'inactive' && t.qc !== 'bad' && d && !d.closed && d.access !== 'kapandi' && CATS[t.category];
});
const byId = Object.fromEntries(list.map((t) => [t.id, t]));

const TRL = { evet: 'Evet', kismen: 'Kısmen', hayir: 'Hayır' };
const FREE = { yeterli: 'Yeterli', sinirli: 'Sınırlı', yok: 'Yok' };
const first = (t) => String(t.desc || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const logo = (t) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(t.url))}&sz=128`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function page({ title, desc, canonical, body, ld = [], type = 'website' }) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Senin Yapay Zekan">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
${ld.map((o) => `<script type="application/ld+json">${J(o)}</script>`).join('\n')}
</head>
<body>
<header class="top"><div class="wrap bar">
  <a class="brand" href="/"><img src="/logo-header.png" width="32" height="32" alt=""><span>Senin Yapay Zekan</span></a>
  <nav><a href="/">Ana Sayfa</a><a href="/#araclar">Araçlar</a><a href="/#haberler">Haberler</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="foot"><div class="wrap">
  <div class="links"><a href="/#yasal/gizlilik">Gizlilik Politikası</a><a href="/#yasal/kvkk">KVKK Aydınlatma Metni</a><a href="/#yasal/kullanim-sartlari">Kullanım Şartları</a><a href="/#yasal/cerezler">Çerez Politikası</a></div>
  <div>© 2026 Senin Yapay Zekan</div>
</div></footer>
</body>
</html>
`;
}

function card(t) {
  const d = tr[t.id] || {};
  const badges = [];
  if (d.tr === 'evet') badges.push('<span class="b ok">Türkçe</span>');
  if (d.free === 'yeterli') badges.push('<span class="b ok">Ücretsizi yeter</span>');
  else if (t.price === 'Ücretsiz') badges.push('<span class="b ok">Ücretsiz</span>');
  else if (t.price === 'Ücretli') badges.push('<span class="b">Ücretli</span>');
  else badges.push('<span class="b">' + esc(t.price) + '</span>');
  return `<a class="card" href="/arac/${esc(t.id)}/"><img src="${esc(logo(t))}" width="44" height="44" alt="" loading="lazy"><div><div class="ct">${esc(t.title)}</div><div class="cd">${esc(clip(first(t), 110))}</div><div class="bs">${badges.join('')}</div></div></a>`;
}

const urls = [{ loc: '/', pri: '1.0', freq: 'hourly' }];
function write(rel, html) {
  const f = path.join(ROOT, rel, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
}

// ---------- Araç sayfaları ----------
fs.rmSync(path.join(ROOT, 'arac'), { recursive: true, force: true });
for (const t of list) {
  const d = tr[t.id];
  const cat = CATS[t.category];
  const url = `/arac/${t.id}/`;
  const paras = String(t.desc || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const related = list.filter((x) => x.category === t.category && x.id !== t.id && tr[x.id].tr !== 'hayir')
    .sort((a, b) => (tr[a.id].tr === 'evet' ? 0 : 1) - (tr[b.id].tr === 'evet' ? 0 : 1)).slice(0, 6);
  const steps = (d.steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
  const title = `${t.title}: Türkçe biliyor mu, ücretsiz mi? | Senin Yapay Zekan`;
  const metaDesc = clip(`${first(t)} Türkçe: ${TRL[d.tr]}. Ücretsiz sürüm: ${FREE[d.free]}. ${d.note || ''}`, 300);
  const body = `
<nav class="crumbs" aria-label="Sayfa yolu"><a href="/">Ana Sayfa</a> › <a href="/kategori/${cat[0]}/">${esc(cat[1])}</a> › <span>${esc(t.title)}</span></nav>
<section class="hero">
  <img src="${esc(logo(t))}" width="72" height="72" alt="${esc(t.title)} logosu">
  <div>
    <h1>${esc(t.title)}</h1>
    <div class="bs"><a class="b p" href="/kategori/${cat[0]}/">${esc(cat[1])}</a><span class="b">${esc(t.price)}</span>${d.tr === 'evet' ? '<span class="b ok">Türkçe</span>' : ''}</div>
  </div>
</section>
<section class="box"><h2>Araç hakkında</h2>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
<section class="box"><h2>Türkiye’den kullanırken</h2>
  <div class="facts">
    <div><span>Türkçe biliyor mu?</span><b>${TRL[d.tr]}</b></div>
    <div><span>Türkiye’den erişim</span><b>${d.access === 'evet' ? 'Evet' : 'Sorunlu'}</b></div>
    <div><span>Ücretsiz sürümü</span><b>${FREE[d.free]}</b></div>
  </div>
  ${d.note ? `<p>${esc(d.note)}</p>` : ''}
  ${steps ? `<h3>3 adımda kullanım</h3><ol>${steps}</ol>` : ''}
</section>
<div class="cta">
  <a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">Aracı aç</a>
  <a class="btn ghost" href="/#arac/${esc(t.id)}">Yorumlar ve favoriler</a>
</div>
${related.length ? `<section><h2 class="sh">Benzer araçlar</h2><div class="grid">${related.map(card).join('')}</div></section>` : ''}
<p class="fine">Bilgiler otomatik sistemler ve yapay zeka yardımıyla derlenir; fiyat ve özellikleri aracın kendi sitesinden kontrol et. Son güncelleme: ${today}.</p>`;
  write(`arac/${t.id}`, page({
    title, desc: metaDesc, canonical: url, body,
    ld: [
      { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: t.title, description: first(t), applicationCategory: 'MultimediaApplication', operatingSystem: 'Web', url: t.url, inLanguage: d.tr === 'evet' ? 'tr' : undefined },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: cat[1], item: `${SITE}/kategori/${cat[0]}/` },
        { '@type': 'ListItem', position: 3, name: t.title, item: SITE + url } ] },
    ],
  }));
  urls.push({ loc: url, pri: '0.6', freq: 'weekly' });
}

// ---------- Liste sayfaları ----------
function listPage(rel, h1, intro, items, title, metaDesc) {
  const body = `
<nav class="crumbs"><a href="/">Ana Sayfa</a> › <span>${esc(h1)}</span></nav>
<h1 class="ph">${esc(h1)}</h1>
<p class="intro">${esc(intro)}</p>
<div class="grid">${items.map(card).join('')}</div>
<div class="cta"><a class="btn" href="/#araclar">Tüm araçları ara</a></div>
<p class="fine">Liste sitedeki elle seçilmiş araçlardan otomatik hazırlanır. Son güncelleme: ${today}.</p>`;
  write(rel, page({
    title, desc: metaDesc, canonical: `/${rel}/`, body,
    ld: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: h1, itemListElement: items.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/arac/${t.id}/`, name: t.title })) }],
  }));
  urls.push({ loc: `/${rel}/`, pri: '0.8', freq: 'weekly' });
}

for (const f of ['kategori', 'rehber']) fs.rmSync(path.join(ROOT, f), { recursive: true, force: true });
const rank = (t) => (tr[t.id].tr === 'evet' ? 0 : tr[t.id].tr === 'kismen' ? 1 : 2) * 10 + (tr[t.id].free === 'yeterli' ? 0 : tr[t.id].free === 'sinirli' ? 1 : 2) - (t.featured ? 100 : 0);
const sorted = (arr) => arr.slice().sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'tr'));

for (const [key, [slug, name, blurb]] of Object.entries(CATS)) {
  const items = sorted(list.filter((t) => t.category === key));
  listPage(`kategori/${slug}`, `${name} yapay zeka araçları`, `${blurb} ${items.length} araç, Türkçe bilenler ve ücretsizi yetenler önde.`, items,
    `${name} yapay zeka araçları (Türkçe notlarla) | Senin Yapay Zekan`, `${name} kategorisinde ${items.length} yapay zeka aracı: Türkçe biliyor mu, Türkiye’den açılıyor mu, ücretsizi yetiyor mu.`);
}

const freeOk = (t) => tr[t.id].free === 'yeterli' || t.price === 'Ücretsiz';
const GUIDES = [
  ['ucretsiz-turkce-yapay-zeka-araclari', 'Türkçe bilen, ücretsizi yeten yapay zeka araçları', 'Kredi kartı vermeden denenebilecek, Türkçe yazıp konuşabildiğin araçlar.', (t) => tr[t.id].tr === 'evet' && freeOk(t)],
  ['turkce-bilen-yapay-zeka-araclari', 'Türkçe bilen yapay zeka araçları', 'Türkçe arayüzü ya da Türkçe komutu iyi anlayan araçlar.', (t) => tr[t.id].tr === 'evet'],
  ['ucretsiz-yapay-zeka-araclari', 'Ücretsiz yapay zeka araçları', 'Ücretsiz sürümü günlük işlere yeten ya da tamamen ücretsiz araçlar.', freeOk],
  ['chatgpt-alternatifleri', 'ChatGPT alternatifleri', 'Yazı, sohbet ve soru-cevap için ChatGPT yerine kullanabileceğin araçlar.', (t) => t.category === 'Metin' && t.id !== 'chatgpt-openai' && tr[t.id].tr !== 'hayir'],
  ['ucretsiz-yapay-zeka-gorsel-uretme', 'Ücretsiz yapay zeka ile görsel üretme araçları', 'Yazıdan görsel üreten, ücretsiz kullanılabilen araçlar.', (t) => t.category === 'Görsel' && freeOk(t)],
  ['yapay-zeka-ile-video-yapma', 'Yapay zeka ile video yapma araçları', 'Video üretmek ve düzenlemek için araçlar.', (t) => t.category === 'Video' && tr[t.id].tr !== 'hayir'],
  ['yapay-zeka-ile-muzik-yapma', 'Yapay zeka ile müzik yapma araçları', 'Şarkı, fon müziği ve ses üretimi için araçlar.', (t) => t.category === 'Müzik' && tr[t.id].tr !== 'hayir'],
  ['yazilimcilar-icin-yapay-zeka-araclari', 'Kod yazmaya yardımcı yapay zeka araçları', 'Kod yazmayı, hata bulmayı ve proje kurmayı hızlandıran araçlar.', (t) => t.category === 'Kodlama'],
];
for (const [slug, h1, blurb, fn] of GUIDES) {
  const items = sorted(list.filter(fn)).slice(0, 30);
  if (items.length < 3) continue;
  listPage(`rehber/${slug}`, h1, `${blurb} ${items.length} araç listeleniyor.`, items,
    `${h1} | Senin Yapay Zekan`, `${blurb} Her araç için Türkçe biliyor mu, Türkiye’den açılıyor mu, ücretsizi yetiyor mu bilgisi var.`);
}

// ---------- sitemap ----------
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url>\n    <loc>${SITE}${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
console.log(`Tamam: ${list.length} araç sayfası, ${urls.length} adres.`);

/*
 * Senin Yapay Zekan - Gemini köprüsü (Cloudflare Worker, ücretsiz plan)
 *
 * Neden var: Gemini anahtarı tarayıcıda görünmesin diye site Gemini'ye doğrudan değil, bu Worker üzerinden bağlanır.
 *
 * Uçlar:
 *   POST /ask   { messages:[{role,content}], tools:[{title,category,price,desc}], lang }  -> { reply }
 *   POST /pick  { q, lang, items:[{id,title,category,price,desc}] }                      -> { picks:[{id,why}] }
 *
 * Cloudflare ayarları:
 *   Secret  : GEMINI_API_KEY   (Kayra kendi yapıştırır, kimse görmez)
 *   KV      : LIMITS           (günlük sınır sayaçları; IP değil, IP'nin tuzlu özeti saklanır)
 *   Değişken: MODEL (varsayılan gemini-flash-lite-latest), DAILY_PER_IP (varsayılan 40)
 */

const ALLOWED = ['https://seninyapayzekan.com', 'https://www.seninyapayzekan.com'];

const SITE_FACTS = `Site: Senin Yapay Zekan (seninyapayzekan.com). Türkçe yapay zeka araçları rehberi; 6.000'den fazla araç, her saat güncellenen Türkçe yapay zeka haberleri, yapay zekayla iş modelleri, Claude eklentileri, e-kitaplar ve prompt oluşturucu var. Her şey ücretsiz.
Arama: Ana sayfadaki kutuya ne yapmak istediğini kendi cümlenle yaz (ör. "logo yapmak istiyorum"). Önce en iyi 5 öneri, sonra ilgili tüm araçlar popülerliğe göre listelenir. Araçlar sayfasında kategori ve fiyat filtresi var. "Yazılımcılar için" sekmesinde kurulum gerektiren GitHub projeleri var.
Hesap: Sağ üstteki profil butonu -> Giriş Yap / Kayıt Ol. Ad, e-posta, şifre yeterli. Kayıttan sonra e-postaya doğrulama bağlantısı gelir (gelmezse Spam'e bak). Şifremi unuttum bağlantısı giriş ekranında. Hesap Profil sayfasından tamamen silinebilir.
Favoriler: Kartlardaki kalp simgesi. Hesapsız da çalışır; hesap açılınca her cihazda görünür. Profil menüsü -> Favorilerim.
Yorumlar: Araç sayfasında, giriş yapınca yorum yazılır; kendi yorumunu silebilirsin; uygunsuz yorumu "Şikâyet et" ile bildirebilirsin.
Premium: Henüz açılmadı, hiçbir ödeme alınmıyor; sağ üstteki Premium butonundan bekleme listesine katılınabilir.
Dil: Menüdeki Dil / Language seçeneğiyle İngilizce.
Gizlilik: Hesap verileri Avrupa'da (Frankfurt) saklanır. Ayrıntı: menüdeki Yasal bölümünde Gizlilik Politikası ve KVKK Aydınlatma Metni.
İletişim: Profil sayfasındaki Öneri / Şikâyet formu veya iletisim@seninyapayzekan.com.
Sorun: Sayfayı yenile (Ctrl+F5), olmazsa başka tarayıcıda dene, sonra bize yaz.`;

function cors(origin) {
  const o = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
}
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

async function ipKey(ip, day, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + day + '|' + ip));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function overLimit(env, request) {
  if (!env.LIMITS) return false;
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || 'yok';
  const key = 'd:' + day + ':' + await ipKey(ip, day, env.SALT || 'syz');
  const max = parseInt(env.DAILY_PER_IP || '40', 10);
  const n = parseInt((await env.LIMITS.get(key)) || '0', 10);
  if (n >= max) return true;
  await env.LIMITS.put(key, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  return false;
}

async function gemini(env, system, user, asJson) {
  const model = env.MODEL || 'gemini-flash-lite-latest';
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: Object.assign({ temperature: 0.3, maxOutputTokens: 900 }, asJson ? { responseMimeType: 'application/json' } : {})
    })
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const d = await r.json();
  const parts = ((((d.candidates || [])[0] || {}).content || {}).parts) || [];
  return parts.map(p => p.text || '').join('').trim();
}

async function handleAsk(body, env) {
  const en = body.lang === 'en';
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-8)
    .map(m => (m.role === 'assistant' ? 'Asistan: ' : 'Kullanıcı: ') + clip(m.content, 500)).join('\n');
  const tools = (Array.isArray(body.tools) ? body.tools : []).slice(0, 8)
    .map(t => '- ' + clip(t.title, 60) + ' (' + clip(t.category, 30) + ', ' + clip(t.price, 20) + '): ' + clip(t.desc, 160)).join('\n');
  const system = `Sen "Senin Yapay Zekan" sitesinin yardım asistanısın. ${en ? 'Reply in English.' : 'Türkçe, samimi ama kısa yaz.'}
Kurallar: En fazla 4 kısa cümle ya da 3 maddelik liste. Sadece aşağıdaki site bilgilerine ve verilen araç listesine dayan; bilmediğin bir şeyi uydurma, emin değilsen "Bunu bilmiyorum, iletisim@seninyapayzekan.com adresine yazabilirsin" de. Araç önerirken yalnızca listedeki araçların adlarını kullan. Kullanıcıdan kişisel bilgi (şifre, telefon, kimlik) isteme. Konu dışı isteklerde (ödev, kod yazma, sohbet) kibarca sitenin konusuna dön. Markdown başlığı kullanma.
SİTE BİLGİLERİ:
${SITE_FACTS}`;
  const user = 'Konuşma:\n' + msgs + (tools ? '\n\nKullanıcının sorusuyla ilgili sitedeki araçlar:\n' + tools : '');
  const reply = await gemini(env, system, user, false);
  return { reply: clip(reply, 1500) };
}

async function handlePick(body, env) {
  const en = body.lang === 'en';
  const q = clip(body.q, 200);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30)
    .map(t => ({ id: clip(t.id, 80), title: clip(t.title, 60), category: clip(t.category, 30), price: clip(t.price, 20), desc: clip(t.desc, 200) }));
  if (!q || items.length < 2) return { picks: [] };
  const ids = new Set(items.map(t => t.id));
  const system = `You pick AI tools for a Turkish AI tools directory. From the candidate list, choose the ${Math.min(5, items.length)} tools that best fit what the user wants to do, best first. Prefer tools that directly do the task, are easy for a non-technical person, and well known; respect "ücretsiz/free" if the user asks for it. Only use ids from the list.
For each pick write "why": one short sentence (max 90 characters) ${en ? 'in English' : 'in natural Turkish'} saying why it fits THIS request. No marketing words, no emojis.
Return ONLY JSON: [{"id":"...","why":"..."}]`;
  const out = await gemini(env, system, JSON.stringify({ request: q, candidates: items }), true);
  let arr = [];
  try { arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)); } catch (e) { arr = []; }
  const seen = new Set();
  const picks = (Array.isArray(arr) ? arr : []).filter(p => p && ids.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 5).map(p => ({ id: p.id, why: clip(p.why, 120) }));
  return { picks };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method !== 'POST' || !['/ask', '/pick'].includes(path)) return json({ error: 'not_found' }, 404, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'not_configured' }, 503, origin);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }
    if (await overLimit(env, request)) return json({ error: 'limit' }, 429, origin);
    try {
      return json(path === '/ask' ? await handleAsk(body, env) : await handlePick(body, env), 200, origin);
    } catch (e) {
      return json({ error: 'upstream' }, 502, origin);
    }
  }
};

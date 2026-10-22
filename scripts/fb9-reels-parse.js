// Разбор рилсов Facebook (сырьё — fb9-reels.js) → data/fbr9-candidates.json, миниатюры в img/fbr/.
// Правила те же, что у Marketplace и групп (lib-fb9.js): только с ценой в подписи, только дома,
// без аренды/участков/дач/долей/недостроя. Точки у рилса нет вовсе, поэтому место — только из
// текста: село («с. Жоравка») или город справочника, геокод в контуре области. Область — из текста;
// не названа — село ищется во всех трёх, берётся, если нашлось ровно в одной.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib9');
const F = require('./lib-fb9');
const D = path.join(__dirname, 'data') + path.sep;
const RAW = D + 'fb9-raw' + path.sep + 'reels' + path.sep;
const IMG = path.join(__dirname, '..', 'img', 'fbr') + path.sep;
const FF = 'D:/soft/video/ffmpeg.exe';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const VET = fs.existsSync(D + 'photo-vet.json') ? rd(D + 'photo-vet.json') : {};
const db = fs.existsSync(RAW + 'reels.json') ? rd(RAW + 'reels.json') : {};
const PICK = fs.existsSync(D + 'fbr9-pick.json') ? rd(D + 'fbr9-pick.json') : {};
const WANT = /(^|[^а-яіїєґ])(шукаю|шукаємо|куплю|купимо|викупимо|придбаю|придбаємо)(?![а-яіїєґ])/i;
const DACHA = /\bдач[аиіуне]\b|дачн|садов\S*\s+(будин|ділянк|товарист)/i;
// город справочника, названный в тексте («будинок у Яготині»): основа без последней буквы
const CITY_RE = L.CITIES9.map(([n, la, lo]) => {
  const base = n.replace(/ \((Хм|Київ|Кір)\)/, '');
  const stem = base.length > 5 ? base.slice(0, -1) : base;
  return [base, la, lo, new RegExp('(?<![а-яіїєґʼ\'’-])' + stem.replace(/[ʼ'’]/g, "['’ʼ]") + '[а-яіїєґ]{0,3}(?![а-яіїєґ])')];
});
const capFix = t => t.replace(/[А-ЯІЇЄҐ'’ʼ]{3,}/g, w => w[0] + w.slice(1).toLowerCase());

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const why = {};
  const no = r => { why[r] = (why[r] || 0) + 1; return null; };
  const rows = [];
  for (const x of Object.values(db)) {
    if (!x.home) continue;
    // реплики автора рилса в комментариях (fb9-reels-comments.js) — там продавец часто пишет цену
    const t = L.deLatin([String(x.cap || '').trim(), ...(x.authorComments || [])].join('\n'));
    const head = t.slice(0, 300);
    if (!F.HOUSE.test(t)) { no('не дом'); continue; }
    if (F.FLAT.test(head) && head.search(F.FLAT) < head.search(F.HOUSE)) { no('квартира'); continue; }
    if (WANT.test(head)) { no('ищу/куплю'); continue; }
    if (F.RENT.test(head) || F.SOLD.test(head)) { no('аренда/продано'); continue; }
    if (F.LAND.test(t)) { no('участок'); continue; }
    if (DACHA.test(head)) { no('дача'); continue; }
    const pr = F.priceOf(t);
    if (!pr) { no('без цены'); continue; }
    if (!L.inBudgetKind(pr.usd, 'house')) { no('цена вне бюджета'); continue; }
    const area = F.areaOf(t);
    if (area != null && area < L.houseAreaMin(pr.usd)) { no('меньше порога площади'); continue; }
    if (L.SHARE.test(t.slice(0, 400))) { no('доля'); continue; }
    if (F.badText(t)) { no('недострой/под ремонт'); continue; }
    if (!fs.existsSync(RAW + x.id + '-1.jpg')) { no('нет кадра'); continue; }
    if (VET['FB' + x.id] === 'no') { no('на кадре не жильё'); continue; }
    if (F.OTHER_OBL.test(t)) { no('чужая область в тексте'); continue; }
    const txtObls = F.OBL_RE.filter(([, re]) => re.test(t)).map(([o]) => o);
    const loc = F.locOf(t) || F.locOf(capFix(t));
    let lat = null, lon = null, place = null, obl = null, exact = false;
    if (loc) {
      const tries = txtObls.length === 1 ? txtObls : Object.keys(F.ZONE);
      const hits = [];
      for (const o of tries) { const g = await F.geocode(loc, o); if (g) hits.push([o, g]); }
      if (hits.length === 1) { [obl, { lat, lon }] = [hits[0][0], hits[0][1]]; place = loc; exact = true; }
    }
    if (!place) {
      const c = CITY_RE.find(([, , , re]) => re.test(t));
      if (c) { lat = c[1]; lon = c[2]; place = c[0]; obl = L.oblastOf(lat, lon, F.shapes); }
    }
    if (!place) { no('место не названо'); continue; }
    if (!obl || !F.ZONE[obl]) { no('место вне наших областей'); continue; }
    rows.push({ x, t, pr, area, obl, lat, lon, place, exact });
  }
  // один дом в нескольких рилсах: тот же автор и цена, или то же место, площадь и цена
  const seen = new Set(), out = [];
  for (const r of rows) {
    const k1 = (r.x.author || '') + '|' + r.pr.usd, k2 = r.place + '|' + (r.area || '') + '|' + r.pr.usd;
    if (seen.has(k1) || seen.has(k2)) { no('перевыкладывание'); continue; }
    seen.add(k1); seen.add(k2);
    const id = 'FB' + r.x.id;
    const thumb = IMG + id + '.jpg';
    // какой кадр на миниатюру: первый бывает калиткой или забором — тогда второй (data/fbr9-pick.json)
    const pick = PICK[id] || 1;
    if (!fs.existsSync(thumb) || PICK[id]) {
      try { execFileSync(FF, ['-y', '-i', RAW + r.x.id + '-' + pick + '.jpg', '-vf', 'scale=360:-2', '-q:v', '5', thumb], { stdio: 'ignore' }); } catch (e) {}
    }
    const title = r.t.split('\n').map(s => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim()).find(s => s.length > 8) || 'Будинок';
    out.push({
      id, kind: 'house', title: title.slice(0, 90), url: r.x.url,
      price: r.pr.usd, cur: r.pr.cur, rawPrice: r.pr.raw,
      area: r.area, land: F.landOf(r.t), rooms: F.roomsOf(r.t),
      loc: r.place, zone: F.ZONE[r.obl], lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5), locExact: r.exact,
      date: (r.x.at || '').slice(0, 10),
      photoList: fs.existsSync(thumb) ? ['img/fbr/' + id + '.jpg'] : [],
      text: r.t.replace(/\s+/g, ' ').slice(0, 900), author: r.x.author || null,
    });
  }
  fs.writeFileSync(D + 'fbr9-candidates.json', JSON.stringify(out, null, 1));
  const by = {}; out.forEach(r => { by[r.zone] = (by[r.zone] || 0) + 1; });
  console.log('рилсов в базе', Object.keys(db).length, '| про продажу дома', Object.values(db).filter(x => x.home).length, '| кандидатов', out.length);
  console.log('отсев:', JSON.stringify(why));
  console.log('по областям:', JSON.stringify(by));
})();

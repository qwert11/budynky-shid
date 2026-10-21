// Rieltor.ua — источник на платформе LUN Group (общий CDN market-images.lunstatic.net
// и общие -lun- CSS-классы с lun.ua, но своя база лотов и свой URL-роутинг: не дубли,
// а отдельный набор объявлений). Фильтр цены живёт только в гривне (price_min/price_max),
// параметр currency/cash_type в URL не действует — поэтому берём широкую полосу в грн
// с запасом и режем строго по факту выведенной в карточке цене в $ (data-label).
// Карточка поиска уже содержит всё нужное: id, координаты (data-longitude/latitude —
// точка, которую сам продавец поставил на карте, а не зашумлённый пин OLX), адрес,
// площадь/комнаты/этаж/сотки, короткое описание — отдельный запрос на объявление не нужен.
// → data/rieltor9-candidates.json (формат loadExt() в units9.js).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [city-slug, украинское название по умолчанию, зона — как в OBL_ZONE units9.js]
// Восток (21.10.2026): поиск по области целиком — у Rieltor это /houses-sale/<Область>-r<id>/;
// неизвестный адрес области сайт молча подменяет Львовом, поэтому id взяты с живых страниц
// (кнопка «Вся область» на странице облцентра). [путь, облцентр, зона]
const CITY = {
  kyi: ['houses-sale/%D0%9A%D0%B8%D1%97%D0%B2%D1%81%D1%8C%D0%BA%D0%B0-r111', 'Київ', 'Киевщина'],
  dnp: ['houses-sale/%D0%94%D0%BD%D1%96%D0%BF%D1%80%D0%BE%D0%BF%D0%B5%D1%82%D1%80%D0%BE%D0%B2%D1%81%D1%8C%D0%BA%D0%B0-r119', 'Дніпро', 'Днепропетровщина'],
  kir: ['houses-sale/%D0%9A%D1%96%D1%80%D0%BE%D0%B2%D0%BE%D0%B3%D1%80%D0%B0%D0%B4%D1%81%D1%8C%D0%BA%D0%B0-r114', 'Кропивницький', 'Кировоградщина'],
};
const TYPES = { 'houses-sale': 'house' };   // восток — только дома
// широкая полоса в грн с запасом вокруг $30-45k (курс плавает, точный отсекаем по $ из карточки)
// восток: дома $20–35 тыс. ≈ 0,87–1,52 млн грн; полоса режется на куски, чтобы каждый влез в MAXPAGE страниц
const PBANDS = [[800000, 1050000], [1050000, 1300000], [1300000, 1650000]];
const MAXPAGE = 25;

// curl и Node Rieltor режет 429 через несколько запросов — страницы берём браузером br
const { brHtml, brClose } = require('./lib-br9');
async function fetchHtml(url) {
  return brHtml(url, { ready: 'document.querySelector("[data-listing-items]") || document.querySelector(".catalog-empty")' });
}
async function fetchHtmlCurl(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'uk' } });
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(2000 * (t + 1)); }
  }
  return null;
}

function parseCards(html) {
  const iMain = html.indexOf('data-listing-items');
  const iAdd = html.indexOf('data-listing-add-items-part');
  if (iMain < 0) return [];
  const seg = html.slice(iMain, iAdd > iMain ? iAdd : html.length);
  const cardRe = /<div class="catalog-card [^"]*"\s+data-label="([^"]*)"[^>]*data-jss="catalog-item"\s+data-catalog-item-id="(\d+)"\s+data-longitude="([^"]*)"\s+data-latitude="([^"]*)">/g;
  const starts = [];
  let m;
  while ((m = cardRe.exec(seg))) starts.push({ idx: m.index, label: m[1], id: m[2], lon: +m[3], lat: +m[4] });
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], end = i + 1 < starts.length ? starts[i + 1].idx : seg.length;
    const chunk = seg.slice(s.idx, end);
    const priceM = /^([\d\s]+)\s*\$/.exec(s.label.trim());
    if (!priceM || !(s.lat && s.lon)) continue; // цена не в $ или нет координат — не сравнить/не привязать надёжно
    const price = +priceM[1].replace(/\s/g, '');
    const link = (chunk.match(/href="(https:\/\/rieltor\.ua\/[a-z0-9-]+\/(?:flats|houses)-sale\/view\/\d+\/)"/) || [])[1] || null;
    const address = ((chunk.match(/catalog-card-address">([^<]*)</) || [])[1] || '').trim();
    const region = [...chunk.matchAll(/card-click-region"[^>]*>\s*([^<]+?)\s*</g)].map(x => x[1].trim());
    const roomsM = /(\d+)\s*кімнат/.exec(chunk);
    const area3 = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*м²/.exec(chunk);
    const area1 = area3 || /(\d+(?:[.,]\d+)?)\s*м²/.exec(chunk);
    const floorM = /поверх\s*(\d+)\s*з\s*(\d+)/.exec(chunk);
    const floorsOnly = /(\d+)\s*поверх(?:и|ів)?\s*<\/span>/.exec(chunk);
    // \b не работает после кириллицы (границей слова JS считает только латиницу/цифры) —
    // граница задаётся лукахедом, а не \b
    const landM = /(\d+(?:[.,]\d+)?)\s*сот(?![а-яіїєґА-ЯІЇЄҐ])/.exec(chunk);
    const descM = /catalog-card-description"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(chunk);
    // "offer-photo-slider-slide-image" — фото самого объекта; на аватар риелтора
    // (класс "…-avatar", папка /avatars/ в URL) не претендуем
    const photoM = /class="offer-photo-slider-slide-image[^"]*"\s+src="([^"]+)"/.exec(chunk);
    out.push({
      id: 'RIEL' + s.id, price, lat: s.lat, lon: s.lon, link,
      address, region,
      rooms: roomsM ? +roomsM[1] : null,
      area: area1 ? +String(area1[1]).replace(',', '.') : null,
      floor: floorM ? +floorM[1] : null,
      floors: floorM ? +floorM[2] : (floorsOnly ? +floorsOnly[1] : null),
      land: landM ? +String(landM[1]).replace(',', '.') : null,
      desc: descM ? descM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) : '',
      photo: photoM ? photoM[1] : null,
    });
  }
  return out;
}

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = {};
  const stats = { pages: 0, raw: 0, kept: 0, byObl: {} };
  for (const [obl, [slug, cityUa, zone]] of Object.entries(CITY)) {
    for (const [typePath, kind] of Object.entries(TYPES)) {
      let list = [];
      for (const [PMIN, PMAX] of PBANDS)
      for (let page = 1; page <= MAXPAGE; page++) {
        const url = `https://rieltor.ua/${slug}/?page=${page}&price_min=${PMIN}&price_max=${PMAX}`;
        const html = await fetchHtml(url);
        stats.pages++;
        await sleep(1800 + Math.random() * 900);
        if (!html) break;
        const cards = parseCards(html);
        if (!cards.length) break;
        list = list.concat(cards);
        if (cards.length < 20) break; // последняя страница
      }
      stats.raw += list.length;
      for (const c of list) {
        if (!L.inBudgetKind(c.price, kind)) continue;
        const title = c.address || cityUa;
        const desc = c.desc || '';
        const txt = title + ' ' + desc;
        if (kind === 'house' && (c.area || 0) < L.houseAreaMin(c.price)) continue;
        if (kind === 'flat' && ((c.area || 0) < 50 || (c.rooms != null && c.rooms < 2))) continue;
        if (L.SHARE.test(txt)) continue;
        if (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt)) continue;
        store[c.id] = {
          id: c.id, kind, title, url: c.link, price: c.price,
          area: c.area, land: c.land, rooms: c.rooms, floor: c.floor, floors: c.floors,
          loc: c.region[0] || cityUa, zone,
          lat: c.lat, lon: c.lon, locExact: true,
          date: null, photoList: c.photo ? [c.photo] : [], text: desc,
        };
        stats.kept++;
        stats.byObl[obl] = (stats.byObl[obl] || 0) + 1;
      }
    }
  }
  fs.writeFileSync(D + 'rieltor9-candidates.json', JSON.stringify(Object.values(store)));
  console.log('rieltor9: страниц', stats.pages, '| карточек всего', stats.raw, '| в бюджете и по правилам', stats.kept);
  console.log('по областям:', stats.byObl);
  await brClose();
})();

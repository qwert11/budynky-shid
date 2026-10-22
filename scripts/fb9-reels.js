// Facebook Reels — лента рекомендаций (facebook.com/reel/) в браузере br с входом покупателя.
// Просьба покупателя 22.10.2026, дословно: «нахуй ты ищешь на маркетплейсе — facebook.com/reel/
// тут дохуя есть, или рекомендации бери». Лента у его аккаунта уже настроена на дома: риелторы
// выкладывают обход дома видео с подписью «💰22 500$, Мала Виска…».
//
// Листаем кнопкой «Следующая карточка», как человек: 4–8 с на рилс. У каждого рилса — подпись
// (раскрытая «Ещё»), автор, а если подпись похожа на продажу дома — два кадра видео (через 1 и
// 4 с после открытия) для миниатюры и фотопроверки. Разбор — fb9-reels-parse.js.
//
// usage: node fb9-reels.js [сколько рилсов, по умолч. 300]
// → data/fb9-raw/reels/reels.json (кэш, в git не идёт; повторный запуск дописывает), кадры <id>-1.jpg / -2.jpg
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/xetr11/Documents/tools/browser-cli/lib/cdp.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = +(process.argv[2] || 300);
// старт — с рилса о продаже дома (по умолчанию дом покупателя в Малой Виске): лента после него
// подбирает похожие. Лента учится на времени просмотра: дома смотрим 40–60 с (почти весь ролик), остальное листаем
// за пару секунд — иначе через сотню рилсов она уходит в общий развлекательный поток (22.10.2026:
// при ровном темпе 7 домов из 365)
const START = process.argv[3] || 'https://www.facebook.com/reel/1742989860262916';
const OUT = path.join(__dirname, 'data', 'fb9-raw', 'reels') + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const DB = OUT + 'reels.json';
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : {};
// продажа дома: слово про дом и про продажу, без аренды
const HOUSEY = /будин|будиноч|\bдім\b|\bдом\b|хат[аиу]\b|котедж|садиб|домик/i;
const SALEY = /прода|продаж|продам|ціна|цена|\$|дол|тис|грн|у\.?\s?о/i;

(async () => {
  const t = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable');
  const ev = async e => { const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? null : r.result.value; };
  async function frame(file) {
    const box = await ev(`(() => { const v = [...document.querySelectorAll('video')].find(v => { const r = v.getBoundingClientRect(); return r.top > -20 && r.top < 200 && r.height > 300; });
      if (!v) return null; const r = v.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }); })()`);
    if (!box) return false;
    const b = JSON.parse(box);
    const s = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 75, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: Math.min(1, 480 / b.w) } });
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
    return true;
  }
  // Подпись и автор — в колонке активного видео. Раньше брали только элементы, целиком видимые
  // на экране, и длинная раскрытая подпись (вылезает за верх) не читалась: 224 рилса из 448
  // остались без подписи, среди них дом покупателя в Малой Виске.
  const COL = `const v = [...document.querySelectorAll('video')].find(v => { const r = v.getBoundingClientRect(); return r.top > -20 && r.top < 200 && r.height > 300; });
    const vr = v ? v.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const inCol = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= vr.left - 10 && r.right <= vr.right + 10 && r.bottom > vr.top && r.top < vr.bottom + 60; };`;
  async function readReel(id) {
    await sleep(1000);
    const f1 = OUT + id + '-1.jpg';
    const shot1 = await frame(f1);
    await ev(`(() => { ${COL} const m = [...document.querySelectorAll('div[role=button], span[role=button]')].filter(inCol).find(x => /^(Ещё|Ще|See more)$/.test((x.innerText||'').trim())); if (m) m.click(); })()`);
    let meta = {};
    for (let k = 0; k < 4; k++) {
      await sleep(1200);
      meta = JSON.parse(await ev(`(() => { ${COL}
        const o = [...document.querySelectorAll('div[dir=auto], span[dir=auto]')].filter(inCol).map(d => d.innerText.trim()).filter(s => s.length > 20 && !/Оригинальное аудио|Оригінальне аудіо|Original audio/.test(s));
        o.sort((a, b) => b.length - a.length);
        const a = [...document.querySelectorAll('a[href*="/profile.php"], a[href*="facebook.com/"][role=link]')].filter(inCol)
          .map(x => ({ h: x.href, n: (x.innerText || '').trim() })).find(x => x.n && x.n.length < 60 && !/reel|Reels/.test(x.n));
        return JSON.stringify({ cap: (o[0] || '').replace(/\\s*(Показать меньше|Згорнути|See less)\\s*$/, ''), author: a ? a.n : null, authorUrl: a ? a.h.split('?')[0] : null });
      })()`) || '{}');
      if (meta.cap) break;
    }
    const home = HOUSEY.test(meta.cap || '') && SALEY.test(meta.cap || '');
    if (home) { await sleep(1500); await frame(OUT + id + '-2.jpg'); }
    else if (shot1 && fs.existsSync(f1)) fs.unlinkSync(f1);
    db[id] = { id, url: 'https://www.facebook.com/reel/' + id, at: (db[id] && db[id].at) || new Date().toISOString(), home, ...meta };
    return home;
  }
  let seen = 0, fresh = 0, homes = 0, stuck = 0, lastId = null, anchor = START;
  // usage: node fb9-reels.js recap — перечитать рилсы с пустой подписью по прямым ссылкам
  if (process.argv[2] === 'recap') {
    const todo = Object.values(db).filter(x => !x.cap);
    console.log('перечитать подписей:', todo.length);
    for (const x of todo) {
      await c.send('Page.navigate', { url: x.url });
      await sleep(6000);
      const url = await ev('location.href') || '';
      if (!url.includes(x.id)) continue;
      if (await readReel(x.id)) homes++;
      if (++seen % 10 === 0) { fs.writeFileSync(DB, JSON.stringify(db)); console.log('перечитано', seen, '/', todo.length, '| про продажу дома', homes); }
      await sleep(2000 + Math.random() * 2000);
    }
  } else {
  await c.send('Page.navigate', { url: START });
  await sleep(8000);
  for (let i = 0; i < N; i++) {
    const url = await ev('location.href') || '';
    const id = (url.match(/\/reel\/(\d+)/) || [])[1];
    if (!id) { console.log('не рилс:', url); break; }
    if (id === lastId) {
      // пачка подгруженных рилсов кончилась: стрелка вниз и пауза, потом — лента заново со старта
      stuck++;
      if (stuck >= 8) { console.log('лента не листается — стоп'); break; }
      // не со старта (так лента шла по кругу), а с последнего найденного дома — от него Facebook
      // подбирает похожие; второй раз подряд — чистая лента рекомендаций
      if (stuck % 4 === 0) { await c.send('Page.navigate', { url: stuck % 8 === 4 ? anchor : 'https://www.facebook.com/reel/' }); await sleep(9000); continue; }
      for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
      await sleep(6000);
      continue;
    } else stuck = 0;
    lastId = id;
    let dwell = 1500 + Math.random() * 1500;
    if (db[id] && db[id].home) dwell = 40000 + Math.random() * 20000;
    if (!db[id] || !db[id].cap) {
      if (await readReel(id)) { homes++; anchor = 'https://www.facebook.com/reel/' + id; dwell = 40000 + Math.random() * 20000; }
      fresh++;
      if (fresh % 10 === 0) fs.writeFileSync(DB, JSON.stringify(db));
    }
    seen++;
    const r = await ev(`(() => { const b = [...document.querySelectorAll('[aria-label]')].find(x => /^(Следующая карточка|Наступна картка|Next card)$/i.test(x.getAttribute('aria-label'))); if (b) { b.click(); return 1; } return 0; })()`);
    // кнопки нет (рилс ещё грузится или рекламная карточка) — листаем стрелкой вниз
    if (!r) for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    if (i % 20 === 0) console.log(`рилсов ${seen}, новых ${fresh}, про продажу дома ${homes}, в базе ${Object.keys(db).length}`);
    await sleep(dwell);
  }
  }
  fs.writeFileSync(DB, JSON.stringify(db));
  console.log(`готово: рилсов ${seen}, новых ${fresh}, про продажу дома ${homes}, в базе ${Object.keys(db).length}`);
  c.close(); await fetch('http://127.0.0.1:9333/json/close/' + t.id).catch(() => {});
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

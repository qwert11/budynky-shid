// Цена из комментариев автора рилса (просьба покупателя 22.10.2026: «можешь в комментах смотреть,
// иногда автор пишет»). Проход по рилсам о продаже дома, у которых в подписи цены нет: открыть
// комментарии, раскрыть ветки ответов, взять реплики самого автора рилса. Чужие комментарии
// («Яка ціна?», «за 20 продасте?») не считаются — цену называет только продавец.
// usage: node fb9-reels-comments.js → дописывает authorComments в data/fb9-raw/reels/reels.json
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/xetr11/Documents/tools/browser-cli/lib/cdp.js');
const F = require('./lib-fb9');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DB = path.join(__dirname, 'data', 'fb9-raw', 'reels', 'reels.json');
const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ]/gi, '');

(async () => {
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const todo = Object.values(db).filter(x => x.home && !F.priceOf(x.cap || '') && x.authorComments === undefined && x.author);
  console.log('рилсов без цены в подписи:', todo.length);
  const t = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable');
  const ev = async e => { const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? null : r.result.value; };
  let found = 0, k = 0;
  for (const x of todo) {
    await c.send('Page.navigate', { url: x.url });
    await sleep(7000);
    const url = await ev('location.href') || '';
    if (!url.includes(x.id)) { x.authorComments = null; continue; }   // рилс удалён или увёл в ленту
    await ev(`(() => { const b = [...document.querySelectorAll('[aria-label]')].find(e => /^(Оставить комментарий|Комментарий|Коментувати|Залишити коментар|Leave a comment|Comment)$/i.test(e.getAttribute('aria-label'))); if (b) b.click(); })()`);
    await sleep(4000);
    // ветки ответов: «Посмотреть все ответы», «Відповіді: 2», «View replies»
    for (let round = 0; round < 3; round++) {
      const n = await ev(`(() => { let n = 0; for (const b of document.querySelectorAll('div[role=button], span[role=button]')) { const s = (b.innerText || '').trim(); if (/^(Посмотреть|Показать|Переглянути|View|See)\\b.*(ответ|відповід|repl)|^(Ответы|Відповіді|Replies)|ответ(а|ов)?:\\s*\\d|відповід\\S*:\\s*\\d/i.test(s) && s.length < 60) { b.click(); n++; } } return n; })()`);
      if (!n) break;
      await sleep(2500);
    }
    const arts = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[role=article]')].map(a => (a.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)))`) || '[]');
    const me = norm(x.author);
    x.authorComments = arts.filter(a => norm(a.split(' · ')[0]).startsWith(me.slice(0, 12)) && me.length >= 4)
      .map(a => a.replace(/^[^·]*·\s*\S+\s+\S+\s*/, '').replace(/\s*(Ответить|Відповісти|Reply)\s*\d*\s*$/, ''));
    if (x.authorComments.some(s => F.priceOf(s))) found++;
    if (++k % 5 === 0) { fs.writeFileSync(DB, JSON.stringify(db)); console.log('пройдено', k, '/', todo.length, '| цена от автора у', found); }
    await sleep(3000 + Math.random() * 3000);
  }
  fs.writeFileSync(DB, JSON.stringify(db));
  console.log('готово: пройдено', k, '| цена в комментариях автора у', found);
  c.close(); await fetch('http://127.0.0.1:9333/json/close/' + t.id).catch(() => {});
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

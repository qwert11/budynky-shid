// Страница целиком через браузер br (CDP, порт 9333) — для площадок, которые режут curl и Node
// (Rieltor.ua отвечает 429 уже на четвёртый запрос curl, а в браузере покупателя открывается).
// Своя вкладка на процесс: вкладку Facebook (fb9-market.js) не трогаем.
// Браузер запускается командой `br start`.
const { connect } = require('C:/Users/xetr11/Documents/tools/browser-cli/lib/cdp.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let c = null, tabId = null;
async function tab() {
  if (c) return c;
  const t = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
  tabId = t.id;
  c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable');
  return c;
}
// ready — JS-выражение, истинное, когда нужное на странице появилось; ждём до timeout мс
async function brHtml(url, { ready = 'document.readyState === "complete"', timeout = 20000, settle = 800 } = {}) {
  const cc = await tab();
  await cc.send('Page.navigate', { url });
  const t0 = Date.now();
  await sleep(1500);
  while (Date.now() - t0 < timeout) {
    const r = await cc.send('Runtime.evaluate', { expression: `!!(${ready})`, returnByValue: true });
    if (r.result && r.result.value) break;
    await sleep(500);
  }
  await sleep(settle);
  const r = await cc.send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
  return r.result ? r.result.value : null;
}
async function brClose() {
  if (c) { try { c.close(); } catch (e) {} c = null; }
  if (tabId) await fetch('http://127.0.0.1:9333/json/close/' + tabId).catch(() => {});
}
module.exports = { brHtml, brClose };

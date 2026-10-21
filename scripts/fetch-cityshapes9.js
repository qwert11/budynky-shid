// Контуры крупных городов карты (жёлтая заливка) с Nominatim → data/city-shapes.json.
// На западе контуры достались из прежней сборки; для востока собираются этим скриптом.
// Path — в «старой» системе координат карты, как у областей (см. fetch-shapes9.js).
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'data', 'city-shapes.json');
const wx = lon => (lon - 21.9) * 123.3 + 20;
const wy = lat => (51.15 - lat) * 187.5 + 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CITIES = ['Київ', 'Дніпро', 'Кривий Ріг', 'Кропивницький', 'Камʼянське', 'Біла Церква', 'Бровари',
  'Нікополь', 'Павлоград', 'Олександрія'];
const ringsOf = g => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
(async () => {
  const out = [];
  for (const name of CITIES) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&polygon_geojson=1&polygon_threshold=0.002&countrycodes=ua&q=' + encodeURIComponent(name.replace('ʼ', "'") + ', Україна');
    const r = await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
    const js = await r.json();
    const hit = js.find(h => h.geojson && /Polygon/.test(h.geojson.type) && /city|town|administrative/.test(h.type + h.addresstype));
    if (!hit) { console.log(name, 'нет полигона'); await sleep(1500); continue; }
    const p = ringsOf(hit.geojson).filter(r => r.length > 8).map(r => {
      const step = Math.max(1, Math.floor(r.length / 160));
      return 'M' + r.filter((_, i) => i % step === 0).map(([lon, lat]) => wx(lon).toFixed(1) + ' ' + wy(lat).toFixed(1)).join('L') + 'Z';
    }).join('');
    out.push({ name, path: p });
    console.log(name, 'ok', p.length, 'B');
    await sleep(1500);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('saved', out.length, '→', OUT);
})();

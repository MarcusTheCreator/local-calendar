// Builds a single self-contained HTML file of the public calendar with the
// current database's events baked in. Handy for sharing a preview.
// Run: node build-preview.js [output.html]
const fs = require('node:fs');
const path = require('node:path');
const { yearData } = require('./server');

const out = process.argv[2] || 'preview.html';
const pub = (f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
const thisYear = new Date().getFullYear();
const data = {};
for (const y of [thisYear - 1, thisYear, thisYear + 1]) data[y] = yearData(y);

const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');
const html = pub('index.html')
  .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${pub('style.css')}\n</style>`)
  .replace('<script src="/app.js"></script>', () => `<script>window.CALENDAR_DATA = ${safeJson};</script>\n<script>\n${pub('app.js')}\n</script>`);

fs.writeFileSync(out, html);
console.log(`Wrote ${out}`);

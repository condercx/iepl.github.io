const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const dir = join(__dirname, '../p/daily-news');
const script = readFileSync(join(dir, 'edition.js'), 'utf8');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const key = 'daily-news:last-photo-edition:v1';
const cached = {
  date: '2025-01-02', updated: '2025-01-01T18:00:00Z',
  stories: Array.from({length: 10}, (_, i) => ({region: i < 4 ? '国内' : '国际',
    title: `News ${i}`, summary: 'A detailed report with sufficient additional context.',
    source: 'Source', url: 'https://example.org/', image_source: 'https://example.org/image',
    image: 'data:image/jpeg;base64,/9j/AAAA/9k=', published: '2025-01-01T17:00:00Z', score: 10 - i}))
};

function reader(cache, fetch) {
  const store = new Map([[key, JSON.stringify(cache)]]);
  function element(tag) {
    return {append(...children) { this.children = children; }, replaceChildren(...children) { this.children = children; },
      setAttribute() {}, addEventListener(event, fn) { this[event] = fn; },
      ...(tag === 'img' && {decode: async () => {}, naturalWidth: 320, naturalHeight: 180})};
  }
  const ui = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  let now = '2025-01-02T17:04:05Z';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  vm.runInNewContext(script, {document: {querySelector: selector => ui[selector.slice(1)], createElement: element, documentElement: {dataset: {}}},
    localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)}, matchMedia: () => ({matches: false}),
    fetch, Date: Clock, AbortController, URL, atob, setTimeout, clearTimeout});
  return {ui, store, setNow(value) { now = value; }};
}

test('page permits only same-origin connections', () => {
  assert.match(html, /connect-src 'self'\s*[;"]/);
});

test('one read per check; preserve complete edition and distinguish failure, unchanged and new', async () => {
  const calls = [];
  let reply = async () => { throw Error('offline'); };
  const {ui, store, setNow} = reader(cached, (url, options) => {
    calls.push([url, options.method ?? 'GET']);
    return reply();
  });
  await new Promise(setImmediate);
  assert.deepEqual(calls, [['./edition.json', 'GET']]);
  assert.match(ui.feedback.textContent, /检查失败/);
  assert.match(ui.date.textContent, /2025-01-02 02:00/);
  assert.match(ui.checked.textContent, /2025-01-03 01:04/);
  const original = ui.sections.children;
  assert.equal(original[1].children.length, 10);
  assert.deepEqual(JSON.parse(store.get(key)), cached);

  let finish;
  reply = () => new Promise(resolve => { finish = data => resolve({ok: true, json: async () => data}); });
  const pending = ui.refresh.click();
  setNow('2025-01-02T18:09:00Z');
  assert.match(ui.checked.textContent, /01:04/);
  finish(cached);
  await pending;
  assert.match(ui.feedback.textContent, /没有新一期/);
  assert.match(ui.checked.textContent, /02:09/);
  assert.equal(ui.sections.children, original);

  const updated = {...cached, updated: '2025-01-02T00:15:00Z'};
  reply = async () => ({ok: true, json: async () => updated});
  await ui.refresh.click();
  assert.match(ui.feedback.textContent, /已载入新版/);
  assert.match(ui.date.textContent, /2025-01-02 08:15/);
  assert.deepEqual(JSON.parse(store.get(key)), updated);
  reply = async () => ({ok: true, json: async () => ({...updated, stories: []})});
  await ui.refresh.click();
  assert.match(ui.feedback.textContent, /检查失败/);
  assert.equal(ui.sections.children[1].children.length, 10);
  assert.deepEqual(JSON.parse(store.get(key)), updated);
  assert.deepEqual(calls, Array(4).fill(['./edition.json', 'GET']));
});

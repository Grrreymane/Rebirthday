// Dependency-free regression checks: node tools/check.js [--baseline <git-ref>]
// Runs the actual inline game script with a minimal browser/canvas shell.
// Canvas drawing is stubbed; these checks cover game logic and input, not visual layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const arg = process.argv.indexOf('--baseline');
const baselineRef = arg < 0 ? null : process.argv[arg + 1];
if (arg >= 0 && !baselineRef) throw new Error('--baseline requires a Git revision');
const noop = () => {};

function boot(source = html, storage = new Map(), initialSeed = 12345) {
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function newLife('));
  assert(script, 'main inline script exists');
  const listeners = {};
  let seed = initialSeed;
  const math = Object.create(Math);
  math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gradient = { addColorStop: noop };
  const canvasContext = new Proxy({
    measureText: s => ({ width: String(s).length * 7 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, { get: (target, key) => key in target ? target[key] : noop });
  const element = () => ({
    style: {}, getContext: () => canvasContext, addEventListener: noop,
    appendChild: noop, remove: noop,
    getBoundingClientRect: () => ({ width: 360, height: 640, left: 0, top: 0 }),
  });
  const document = {
    currentScript: { textContent: script }, getElementById: element, createElement: element,
    body: element(), addEventListener: noop, fonts: { addEventListener: noop, load: () => Promise.resolve([]) },
  };
  const window = { devicePixelRatio: 1, addEventListener: (name, fn) => (listeners[name] ||= []).push(fn) };
  window.parent = window;
  const context = vm.createContext({
    window, document, navigator: {}, console, Math: math, performance: { now: () => 0 },
    requestAnimationFrame: noop, setTimeout: noop, clearTimeout: noop,
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  });
  // Scene pixel generation is unrelated to these checks; retain valid stage bounds.
  const instrumented = script.replace(/\nbuildScenes\(\);/, '\nfor (const key of Object.keys(SCENE_NAME)) SCN[key] = { walk: [20, 160], fy: [95, 110] };')
    .replace(/\}\)\(\);\s*$/, 'globalThis.gameEval = code => eval(code);\n})();');
  vm.runInContext(instrumented, context, { timeout: 15000 });
  return {
    storage, run: code => context.gameEval(code),
    key: key => (listeners.keydown || []).forEach(fn => fn({ key, repeat: false, preventDefault: noop })),
    event: (name, data) => (listeners[name] || []).forEach(fn => fn({ preventDefault: noop, ...data })),
  };
}

function test(name, fn) { fn(); console.log('PASS ' + name); }
const pts = '{ CHR: 5, INT: 5, STR: 5, MNY: 5 }';
const newLife = (g, talents = ['changshou', 'jinli', 'yibing']) => g.run(`newLife(${JSON.stringify(talents)}, ${pts});`);
const json = (g, expression) => JSON.parse(g.run(`JSON.stringify(${expression})`));
const center = (g, rect) => json(g, `({x: ${rect}[0] + ${rect}[2] / 2, y: ${rect}[1] + ${rect}[3] / 2})`);
const tap = (g, fn, p) => g.run(`${fn}(${JSON.stringify(p)})`);

test('all event IDs are unique', () => {
  const g = boot(), ids = json(g, 'EV.map(e => e.id)');
  assert.equal(new Set(ids).size, ids.length);
});

if (baselineRef) test('event priorities, conditions, weights and registration order match baseline', () => {
  const baseline = execFileSync('git', ['show', `${baselineRef}:index.html`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const before = boot(baseline), after = boot();
  const snapshot = `EV.map(e => Object.fromEntries(['id','a0','a1','w','_g','m','p','rep','cd','x','sched','love','nx','c'].map(k => [k, typeof e[k] === 'function' ? e[k].toString() : e[k] ?? null])))`;
  const oldEvents = json(before, snapshot), events = json(after, snapshot);
  // The property-market event previously shared the debt collector's ID.
  oldEvents.forEach(e => { if (e.id === 'debt' && e.a0 === 28 && e.a1 === 55) e.id = 'house_debt'; });
  assert.deepEqual(events, oldEvents);
  for (const fn of ['eligible', 'weight', 'pickEvent', 'wpick']) assert.equal(after.run(`${fn}.toString()`), before.run(`${fn}.toString()`), fn);
  assert.equal(after.run('EVI.zb_cure._g'), 1, 'cure retains luck weighting');
  console.log(`  Compared ${events.length} event registrations against ${baselineRef}`);
});

test('rerolls exclude fixed fate and repeated talents apply once', () => {
  const g = boot();
  const ids = json(g, 'TAL_IDS');
  for (const fate of ids) {
    for (let i = 0; i < 25; i++) {
      const pool = json(g, `drawTalents(${JSON.stringify(fate)})`);
      assert(!pool.includes(fate), fate);
      assert.equal(new Set(pool).size, pool.length);
      assert.equal(pool.length, 10);
    }
  }
  g.run("META.inh = 'yibing'; META.inh2 = 'yibing';");
  assert(!json(g, "drawTalents('yibing')").includes('yibing'));
  newLife(g, ['yibing', 'yibing']);
  assert.equal(g.run('L.a.CHR'), 6);
  assert.equal(g.run('L.tl.length'), 1);
});

test('failed cure has no victory banner/reward/highlight; success still does', () => {
  const g = boot();
  assert.equal(g.run('EVI.zb_cure._g'), 1, 'cure retains luck weighting');
  for (const peace of [0, 1]) for (const success of [false, true]) {
    newLife(g, []);
    g.run(`L.age = 30; L.path = 'zb'; L.zbAge = 20; L.f.radio = 1; L.f.zbpeace = ${peace};
      YR = { lines: [], sc: null, em: null, big: null, d: {}, g: 0, dead: false };
      L.log.push({ a: L.age, l: YR.lines, g: 0 });
      Math.random = () => ${success ? '.6' : '.1'};
      doEvent(EVI.zb_cure); finishYear();`);
    assert.equal(g.run('L.a.SPR'), success ? 8 : 3);
    assert.equal(Boolean(g.run('L.f.savior')), success);
    assert.equal(Boolean(g.run('YR.big')), success);
    assert.equal(g.run('(L.hl || []).length'), success ? 1 : 0);
    assert.equal(g.run('L.path'), success ? null : 'zb');
    if (success) assert.equal(g.run('YR.em'), 'star');
    else assert.notEqual(g.run('YR.em'), 'star');
    assert.equal(g.run('YR.g'), success ? 1 : -1);
  }
});

test('debt collection and property downturn have independent occurrence flags', () => {
  const g = boot(); newLife(g, []);
  g.run('L.age = 35; L.f.loan = 1; L.f.house = 30; L.a.MNY = 0; L.used.debt = 1; L.at.debt = 31;');
  assert(g.run('eligible(EVI.house_debt)'));
  assert(g.run('eligible(EVI.debt)'));
  g.run('L.used.house_debt = 1;');
  assert(!g.run('eligible(EVI.house_debt)'));
  assert(g.run('eligible(EVI.debt)'));
});

test('legacy debt histories migrate independently and reload idempotently', () => {
  for (const kind of ['house', 'both', 'collector']) {
    let g = boot(); newLife(g, []);
    const hasHouse = kind !== 'collector', count = kind === 'house' ? 0 : 2;
    g.run(`L.age = 40; L.f.loan = 1; L.f.house = 28; L.a.MNY = 0;
      L.log = [];
      ${hasHouse ? "L.log.push({a: 30, l: [EVI.house_debt.t], g: -1});" : ''}
      ${count ? "for (const a of [34, 38]) L.log.push({a, l: ['你欠了一屁股债，催债电话一天打十几个。', '▶ 慢慢还'], g: -1});" : ''}
      L.used.debt = ${count + Number(hasHouse)}; L.at.debt = ${count ? 38 : 30}; saveRun();`);
    for (let reload = 0; reload < 3; reload++) {
      g = boot(html, g.storage); g.run('resumeLife();');
      assert.equal(g.run('L.used.house_debt || 0'), hasHouse ? 1 : 0, kind);
      assert.equal(g.run('L.used.debt || 0'), count, kind);
      assert.equal(g.run('L.at.debt'), count ? 38 : undefined, kind);
      if (hasHouse) assert.equal(g.run('L.at.house_debt'), 30, kind);
      assert.equal(g.run('eligible(EVI.house_debt)'), !hasHouse, kind);
      assert.equal(g.run('eligible(EVI.debt)'), !count, 'collector cooldown is separate');
      g.run('saveRun();');
    }
    g.run('L.age = 42;');
    assert(g.run('eligible(EVI.debt)'), 'collector still recurs after cooldown');
  }
});

test('stat popup freezes years and blocks keyboard choices and progression', () => {
  const g = boot(); newLife(g, []); g.run("go('life'); nextYear(); auto = 2; banner = null; yearT = 9;");
  tap(g, 'tapLife', { x: 40, y: 20 });
  const age = g.run('L.age');
  const timer = g.run('yearT');
  assert(g.run('statInfo'));
  g.run('update(2)'); g.key(' '); g.key('Enter');
  assert.equal(g.run('L.age'), age);
  assert.equal(g.run('yearT'), timer, 'year timer stays paused');
  assert.equal(g.run('auto'), 2, 'selected autoplay speed is preserved');
  g.run("L.pend = 'gk';"); g.key('1'); g.key('2');
  assert.equal(g.run('L.pend'), 'gk');
  assert(!g.run('L.f.fudu'));
  g.key('Escape');
  assert(!g.run('statInfo'));
  assert(!g.run('menuOpen'));
  g.run('L.pend = null; banner = null; update(.1);');
  assert.equal(g.run('L.age'), age + 1, 'autoplay resumes after close');
  assert.equal(g.run('auto'), 2);
  g.run('banner = null;'); g.key('Enter');
  assert.equal(g.run('L.age'), age + 2, 'normal keyboard works after close');
});

test('settled lives survive reload, settle once, and clear only after inheritance', () => {
  let g = boot(); newLife(g);
  g.run("go('life'); nextYear(); L.end = true; L.cause = '验证'; finishLife();");
  const summary = json(g, '({lives: META.lives, rp: META.rp, book: META.book, talents: L.tl, grade: L.grade, score: L.score})');
  assert(g.storage.has('rl-run'));
  const storage = g.storage;
  for (let i = 0; i < 3; i++) {
    g = boot(html, storage);
    assert(g.run('SAVED && SAVED.end && SAVED.settled'));
    g.run('resumeLife(); finishLife();');
    assert.equal(g.run('state'), 'end');
    assert.deepEqual(json(g, '({lives: META.lives, rp: META.rp, book: META.book, talents: L.tl, grade: L.grade, score: L.score})'), summary);
  }
  tap(g, 'tapEnd', center(g, 'BTN.nextLife'));
  assert.equal(g.run('state'), 'inherit');
  tap(g, 'tapInherit', { x: 90, y: 107 });
  // Refreshing the inheritance screen also leaves the just-finished talents recoverable.
  g = boot(html, storage); g.run('resumeLife();');
  assert.equal(g.run('state'), 'end');
  assert.deepEqual(json(g, 'L.tl'), summary.talents);
  tap(g, 'tapEnd', center(g, 'BTN.nextLife'));
  tap(g, 'tapInherit', { x: 90, y: 107 });
  const selected = g.run('inhSel[0]');
  tap(g, 'tapInherit', center(g, 'BTN.inhGo'));
  assert.equal(g.run('META.inh'), selected);
  assert(!storage.has('rl-run'));
  assert.equal(g.run('state'), 'gacha');
  assert.equal(boot(html, storage).run('SAVED'), null);
});

test('legacy active saves and pending choices still resume', () => {
  for (const pending of [false, true]) {
    let g = boot(); newLife(g, []); g.run('runYear();');
    if (pending) g.run("L.pend = 'gk';");
    g.run('saveRun();');
    const before = json(g, 'L');
    g = boot(html, g.storage); g.run('resumeLife();');
    assert.equal(g.run('state'), 'life');
    assert.deepEqual(json(g, 'L'), before);
    if (pending) { g.key('1'); assert(g.run('L.f.fudu')); assert(!g.run('L.pend')); }
    else { g.run('nextYear();'); assert.equal(g.run('L.age'), before.age + 1); }
  }
});

test('300 seeded lives finish, including every hidden route and serialized choices', () => {
  const g = boot();
  const result = json(g, `(() => {
    const routes = new Set(), talents = [null, 'xianyuan', 'yaoxue', 'yishijie', 'mori', 'yiti', 'haizi', 'chuanyue', 'waixing'];
    let years = 0, choices = 0, maxAge = 0;
    for (let n = 0; n < 300; n++) {
      newLife([talents[n % talents.length], 'tianxuan', 'changshou'].filter(Boolean), ${pts});
      let steps = 0;
      while (!L.end) {
        if (++steps > 2000) throw new Error('life failed to finish: ' + n);
        runYear(); years++; if (L.path) routes.add(L.path);
        L = JSON.parse(JSON.stringify(L));
        if (L.pend) { resolveChoice(n % 2); choices++; }
        for (const k of STATS) if (!Number.isFinite(L.a[k])) throw new Error('invalid stat: ' + k);
        if (L.log.some(e => !e.l.length || e.l.some(t => typeof t !== 'string'))) throw new Error('invalid log');
      }
      finishLife(); if (!L.settled || !L.grade) throw new Error('missing settlement');
      maxAge = Math.max(maxAge, L.age);
    }
    return { years, choices, maxAge, routes: [...routes].sort() };
  })()`);
  for (const route of ['xian', 'isekai', 'zb', 'cy', 'pi', 'gu']) assert(result.routes.includes(route), route);
  assert(result.choices > 0);
  console.log('  ' + JSON.stringify(result));
});
console.log('All regression checks passed.');

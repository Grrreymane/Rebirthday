// Store-page trailer director: ~15 s vertical video.
// Record:  python D:/Minigame/_workflow/tools/record_video.py D:/Minigame/人生重开模拟器 tools/trailer.js --out trailer.mp4
// Runs inside the game closure (see record_video.py), so it calls game functions directly.
{
  // same random numbers every take, so a good take can be re-recorded
  let seed = 11;
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const FPS = 30, DT = 1 / FPS;
  wantedTrack = () => 'kid';          // one tune all the way through, instead of a new one at every cut
  META.muted = false;
  const gameTxt = txt; txt = (s, ...o) => { if (!/^(点击屏幕继续|自动中|快进中)/.test(s)) gameTxt(s, ...o); }; // the bottom-bar hints go too
  button = () => {};                  // no buttons anywhere: the captions sit in the bottom bar instead
  const PTS = { CHR: 6, INT: 5, STR: 6, MNY: 3 };

  const uiReset = () => { logScroll = 0; auto = 0; endT = 0; cast = []; banner = null; POPS = []; P = []; emote = null; lastG = 0; TOASTS = []; menuOpen = false; statInfo = false; };
  const step1 = () => { if (L.pend) choose(0); else nextYear(); };
  // Simulate lives quietly until pred() is true after a year, then replay that year on screen.
  function lifeUntil(tids, pred) {
    for (let tries = 0; tries < 400; tries++) {
      newLife(tids, PTS); const st_ = {};
      while (!L.end) {
        const s = JSON.stringify(L), sd = seed;
        runYear(); if (L.pend) resolveChoice(0);
        if (!L.end && pred(st_)) { L = JSON.parse(s); seed = sd; uiReset(); go('life'); nextYear(); if (L.pend) choose(0); TOASTS = []; return; }
      }
    }
    REC.log('no life found for ' + tids);
  }
  // a run of years on a route, a couple of years in (past the crossing-over itself)
  const onRoute = (p, n = 3) => s => (L.path === p ? (s.k = (s.k || 0) + 1) : (s.k = 0)) >= n;

  const shots = [];
  // 1. the talent gacha: shake, drop, a legendary fate card
  shots.push({ len: 2.6, caption: '抽天赋', capY: 306, start() {
    uiReset(); startGacha(); gacha.fate = 'jiuming'; gacha.ph = 'shake'; gacha.t = 0;
  }, during() { if (gacha.ph === 'wait' && gacha.t > .2) { gacha.ph = 'open'; gacha.t = 0; } }, speed: 1.6 });
  // 2. a life from the first cry: a year every 0.3 s
  shots.push({ len: 3.3, caption: '重开一次人生', capY: 306, start() {
    pickTal = ['jiuming'].concat(gacha.tal.filter(t => t !== 'jiuming').slice(0, 2));
    newLife(pickTal, PTS); uiReset(); go('life'); nextYear(); this.n = 1;
  }, during(t) { if (t > this.n * .3) { this.n++; step1(); TOASTS = []; } } });
  // 3. love and a family
  shots.push({ len: .9, caption: '结婚生娃', capY: 306, start() { lifeUntil(['taohua'], () => L.mar && L.marAge === L.age && L.age < 32); } });
  shots.push({ len: .9, caption: '结婚生娃', capY: 306, start() { lifeUntil(['taohua'], () => L.kids.length && L.kids[L.kids.length - 1].born === L.age && L.kids.length === 1 && L.age < 36); } });
  // 4. other worlds, one cut each
  [['yishijie', 'isekai'], ['xianyuan', 'xian'], ['haizi', 'pi'], ['yiti', 'cy'], ['mori', 'zb'], ['chuanyue', 'gu']].forEach(([tid, p]) =>
    shots.push({ len: .62, caption: '穿越 修仙 当海盗', capY: 306, start() { lifeUntil([tid], onRoute(p)); } }));
  // 5. the tombstone and a top grade
  shots.push({ len: 2.6, caption: '这一生，值吗？', capY: 306, start() {
    for (let i = 0; i < 400; i++) {
      newLife(['changshou', 'tianxuan'], PTS);
      while (!L.end) { runYear(); if (L.pend) resolveChoice(0); }
      if (/^S/.test(letterOf(lifeScore())) && L.mar && L.kids.length) break;
    }
    uiReset(); finishLife(); go('end'); TOASTS = [];
  } });
  // 6. the title as the end card, without the menu buttons
  shots.push({ len: 2.4, start() {
    uiReset(); SAVED = null; META.lives = 0; go('title');
  }, after() { if (Math.floor(T * 2) % 2 === 0) txt('点击开始新人生', 90, 160, 11, '#ffffff', 'center', OUT); } });
  const total = shots.reduce((s, x) => s + x.len, 0);

  // caption: big outlined words that slide in
  function caption(s, age, len, capY) {
    const a = Math.min(1, age / .12, (len - age) / .12), c = textSprite({ s, size: 15, col: '#ffe14a', stroke: OUT });
    const slide = (1 - Math.min(1, age / .15)) * 8;
    ctx.globalAlpha = Math.max(0, a); ctx.drawImage(c.cv, R(W * K / 2 - c.w / 2), R((capY + slide) * K - c.h / 2)); ctx.globalAlpha = 1;
  }

  let cur = -1, t0 = 0, capStart = 0, lastCap = null;
  REC.run({ fps: FPS, seconds: total, canvas: cv, audio: true,
    async setup(ac) { AC = ac; MUS.cur = null; MUS.bus = null; try { await document.fonts.ready; for (const f of ['15px "ZCOOL QingKe HuangYou"', '8px "Fusion Pixel"']) await document.fonts.load(f, ALLTEXT); } catch (e) {} TXC.clear();
      // exact pixel scale for the requested size (fit() would follow the headless window instead)
      removeEventListener('resize', fit); cv.width = REC.width; cv.height = REC.height; K = cv.width / W;
      REC.log('canvas ' + cv.width + 'x' + cv.height + ' K=' + K); },
    step(i, t) {
      let acc = 0, k = 0; while (k < shots.length - 1 && t >= acc + shots[k].len - 1e-6) acc += shots[k++].len;
      if (k !== cur) { cur = k; t0 = acc; shots[k].start(); }
      const sh = shots[k], lt = t - t0;
      if (sh.during) sh.during(lt);
      if (i > 0) update(DT * (sh.speed || 1));
      shake = 0;
      render();
      if (sh.after) { sh.after(); flush(); }
      musicUpdate(wantedTrack());
      // a caption shared by consecutive shots stays up across the cuts
      if (sh.caption !== lastCap) { lastCap = sh.caption; capStart = t; }
      if (sh.caption) {
        let end = acc + sh.len, j = k + 1; while (j < shots.length && shots[j].caption === sh.caption) end += shots[j++].len;
        caption(sh.caption, t - capStart, end - capStart, sh.capY);
      }
    } });
}

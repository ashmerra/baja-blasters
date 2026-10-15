(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  // Logical playfield is 400 units wide; height follows the screen's aspect.
  const LW = 400;
  const ROW_H = 6;
  const FOLLOW_GAP = 18;
  const MOSES_HALF = 9;
  const MAX_CHARGES = 3;
  const BOTTLES_PER_CHARGE = 5;
  const BEST_KEY = 'bajaBlasters.best';
  const MUTE_KEY = 'bajaBlasters.muted';

  const QUIPS = [
    'LET MY PEOPLE DEW',
    'DO THE DEW THROUGH',
    'SOME SEAS PART FOR FAITH',
    'THIS ONE PARTS FOR BAJA BLAST',
    'PART THE RED TEAM',
    'BLUE TEAM NEVER SINKS',
    'FORTY YEARS OF FLAVOR',
  ];

  let LH = 800;
  let MY = 520;
  let scale = 1;
  let dpr = 1;
  let state = 'title';
  let g = null;
  let last = 0;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function resize() {
    const r = app.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = r.width / LW;
    LH = r.height / scale;
    MY = Math.round(LH * 0.64);
    if (state !== 'play') render();
  }

  // ---------------------------------------------------------------- audio
  const Sfx = {
    ctx: null,
    master: null,
    spray: null,
    noiseBuf: null,
    muted: localStorage.getItem(MUTE_KEY) === '1',

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = (this.ctx = new AC());
      this.master = ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(ac.destination);

      const len = ac.sampleRate * 2;
      this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 0.6;
      this.spray = ac.createGain();
      this.spray.gain.value = 0;
      src.connect(bp).connect(this.spray).connect(this.master);
      src.start();
    },

    setMuted(m) {
      this.muted = m;
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 0.7;
    },

    setSpray(level) {
      if (!this.spray) return;
      this.spray.gain.setTargetAtTime(level, this.ctx.currentTime, 0.08);
    },

    tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
      if (!this.ctx) return;
      const ac = this.ctx;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    noise(dur, { vol = 0.3, freq = 1200, to = 0, type = 'lowpass', delay = 0 } = {}) {
      if (!this.ctx) return;
      const ac = this.ctx;
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(gn).connect(this.master);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
    },

    pickup() {
      this.tone(880, 0.09, { type: 'triangle', vol: 0.16 });
      this.tone(1320, 0.14, { type: 'triangle', vol: 0.14, delay: 0.06 });
    },
    charge() {
      [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.06, delay: i * 0.06 }));
    },
    join() {
      this.tone(523, 0.18, { type: 'sine', vol: 0.18 });
      this.tone(784, 0.25, { type: 'sine', vol: 0.14, delay: 0.08 });
    },
    faith() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'sine', vol: 0.12, delay: i * 0.07 }));
    },
    swept() {
      this.noise(0.35, { vol: 0.22, freq: 3000, to: 300 });
      this.tone(300, 0.2, { type: 'sine', vol: 0.08, slide: 120 });
    },
    lost() {
      this.noise(0.4, { vol: 0.2, freq: 800, to: 200 });
      this.tone(330, 0.25, { type: 'triangle', vol: 0.1, slide: 180 });
    },
    hit() {
      this.tone(140, 0.35, { type: 'sine', vol: 0.4, slide: 45 });
      this.noise(0.5, { vol: 0.35, freq: 1500, to: 150 });
    },
    blast() {
      this.noise(1.2, { vol: 0.45, freq: 300, to: 6000, type: 'bandpass' });
      this.tone(90, 0.9, { type: 'sawtooth', vol: 0.18, slide: 40 });
      this.tone(440, 0.5, { type: 'square', vol: 0.05, slide: 1760 });
    },
    over() {
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.14, delay: i * 0.16 }));
      this.noise(1.4, { vol: 0.4, freq: 2000, to: 100 });
    },
  };

  const buzz = (p) => {
    if (navigator.vibrate) {
      try { navigator.vibrate(p); } catch (_) { /* ignore */ }
    }
  };

  // ---------------------------------------------------------------- game state
  function newGame() {
    g = {
      t: 0,
      d: 0,
      v: 140,
      x: LW / 2,
      tx: LW / 2,
      vx: 0,
      hearts: 3,
      invuln: 0,
      dew: 100,
      bottles: 0,
      blastProg: 0,
      charges: 1,
      blastT: 0,
      followers: 5,
      peakFollowers: 5,
      rescued: 0,
      swept: 0,
      score: 0,
      rows: [],
      nextRowWy: 0,
      history: [],
      soldiers: [],
      items: [],
      particles: [],
      texts: [],
      seamPh: [rand(1000), rand(1000), rand(1000)],
      timers: { soldier: 6, bottle: 1.2, stray: 7, tablet: 30 },
      sprayAcc: 0,
      lossCd: 0,
      shake: 0,
      flash: 0,
      flashColor: '255,255,255',
      banner: null,
      nextMilestone: 250,
      quip: 0,
      warnedSoldiers: false,
      dying: 0,
      hitLog: [],
    };
    g.nextRowWy = Math.floor((-(LH - MY) - 60) / ROW_H) * ROW_H;
    g.history.push([g.d - 2000, g.x], [g.d, g.x]);
    spawnRows();
    showBanner('DO THE DEW THROUGH', '#3ff0c8');
  }

  const diff = () => clamp(g.d / 32000, 0, 1);

  function seamAt(wy, k) {
    const p = g.seamPh;
    const s =
      Math.sin(wy * 0.0021 + p[0]) * 0.55 +
      Math.sin(wy * 0.0047 + p[1]) * 0.3 +
      Math.sin(wy * 0.0109 + p[2]) * 0.15;
    return LW / 2 + (20 + 115 * k) * s;
  }

  function spawnRows() {
    const k = diff();
    while (g.nextRowWy < g.d + MY + 60) {
      const wy = g.nextRowWy;
      const intro = clamp((wy - 400) / 1600, 0, 1);
      const w = lerp(360, 150 - 50 * k, intro);
      const s = clamp(seamAt(wy, k * intro), 8 + w / 2, LW - 8 - w / 2);
      g.rows.push({ wy, L: s - w / 2, R: s + w / 2, s });
      g.nextRowWy += ROW_H;
    }
    const cutoff = g.d - (LH - MY) - 60;
    while (g.rows.length > 2 && g.rows[0].wy < cutoff) g.rows.shift();
  }

  function rowAt(wy) {
    const rows = g.rows;
    const i = Math.round((wy - rows[0].wy) / ROW_H);
    return rows[clamp(i, 0, rows.length - 1)];
  }

  function histX(wy) {
    const h = g.history;
    if (wy <= h[0][0]) return h[0][1];
    let lo = 0;
    let hi = h.length - 1;
    if (wy >= h[hi][0]) return h[hi][1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (h[mid][0] <= wy) lo = mid;
      else hi = mid;
    }
    const a = h[lo];
    const b = h[hi];
    return lerp(a[1], b[1], (wy - a[0]) / (b[0] - a[0] || 1));
  }

  // How strongly the bottles push water at a given distance ahead of Moses.
  function sprayFall(dy) {
    if (dy < -40 || dy > 260) return 0;
    if (dy < 0) return (dy + 40) / 40;
    if (dy < 80) return 1;
    return 1 - (dy - 80) / 180;
  }

  const visibleFollowers = () => Math.min(g.followers, Math.max(0, Math.floor((LH - MY - 14) / FOLLOW_GAP)));
  const followerPos = (i) => {
    const wy = g.d - FOLLOW_GAP * (i + 1);
    return [histX(wy), wy];
  };
  const multiplier = () => 1 + Math.floor(g.followers / 5);
  const sy = (wy) => MY - (wy - g.d);

  function showBanner(text, color = '#fff') {
    g.banner = { text, color, t: 0 };
  }

  function floatText(text, x, wy, color = '#fff', size = 18) {
    g.texts.push({ text, x, wy, color, size, t: 0 });
  }

  function splash(x, wy, n, colors, speed = 140) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const sp = rand(speed * 0.3, speed);
      g.particles.push({
        kind: 'drop',
        x,
        wy,
        vx: Math.cos(a) * sp,
        vwy: Math.sin(a) * sp,
        life: rand(0.35, 0.8),
        max: 0.8,
        size: rand(1.5, 4),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  const RED_DROPS = ['#ff4d5a', '#ffd0d0', '#c3121c', '#fff'];
  const TEAL_DROPS = ['#3ff0c8', '#c9fff1', '#0e9f86', '#fff'];

  // ---------------------------------------------------------------- update
  const keys = { left: false, right: false };

  function update(dt) {
    g.t += dt;
    if (g.banner) {
      g.banner.t += dt;
      if (g.banner.t > 2) g.banner = null;
    }
    g.flash = Math.max(0, g.flash - dt * 2.5);
    g.shake = Math.max(0, g.shake - dt * 30);

    if (g.dying > 0) {
      updateDying(dt);
      return;
    }

    const k = diff();
    g.v = 140 + 130 * k;
    const creep = 20 + 16 * k;
    const dewOn = g.dew > 0;
    const push = (82 + 30 * k) * (dewOn ? 1 : 0.4);
    const blasting = g.blastT > 0;

    const step = g.v * dt;
    g.d += step;
    g.score += (step / 40) * multiplier();
    g.dew = Math.max(0, g.dew - (4 + 1.5 * k) * dt);
    g.invuln = Math.max(0, g.invuln - dt);
    g.lossCd = Math.max(0, g.lossCd - dt);
    g.blastT = Math.max(0, g.blastT - dt);

    // Moses
    const kd = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    g.tx = clamp(g.tx + kd * 300 * dt, 14, LW - 14);
    const px = g.x;
    g.x += (g.tx - g.x) * Math.min(1, dt * 16);
    g.vx = dt > 0 ? (g.x - px) / dt : 0;
    g.history.push([g.d, g.x]);
    const histCut = g.d - (LH - MY) - 120;
    while (g.history.length > 2 && g.history[1][0] < histCut) g.history.shift();

    // Sea
    spawnRows();
    const screenBottom = -(LH - MY) - 60;
    for (const r of g.rows) {
      const dy = r.wy - g.d;
      r.L += creep * dt;
      r.R -= creep * dt;
      const f = sprayFall(dy);
      if (f > 0) {
        r.L -= push * f * dt;
        r.R += push * f * dt;
      }
      if (blasting && dy > screenBottom) {
        r.L -= 720 * dt;
        r.R += 720 * dt;
      }
      if (r.L < 6) r.L = 6;
      if (r.R > LW - 6) r.R = LW - 6;
      if (r.L > r.R) r.L = r.R = (r.L + r.R) / 2;
    }

    // Moses vs water
    const mr = rowAt(g.d);
    if (g.invuln <= 0 && (g.x - MOSES_HALF < mr.L || g.x + MOSES_HALF > mr.R)) {
      hurt('water');
      if (g.dying > 0) return;
    }

    // Followers vs water
    const nVis = visibleFollowers();
    if (g.lossCd <= 0) {
      for (let i = 0; i < nVis; i++) {
        const [fx, fwy] = followerPos(i);
        const r = rowAt(fwy);
        if (fx - 4 < r.L || fx + 4 > r.R) {
          loseFollower(fx, fwy, 'SWEPT AWAY');
          break;
        }
      }
    }

    spawnThings(dt, k);
    updateSoldiers(dt, k, dewOn, blasting);
    updateItems();
    updateParticles(dt, dewOn);

    for (const t of g.texts) {
      t.t += dt;
      t.wy += 50 * dt;
    }
    g.texts = g.texts.filter((t) => t.t < 1.1);

    const meters = g.d / 40;
    if (meters >= g.nextMilestone) {
      showBanner(`${g.nextMilestone} M · ${QUIPS[g.quip % QUIPS.length]}`, '#fff');
      g.quip++;
      g.nextMilestone += 250;
    }

    Sfx.setSpray(dewOn ? 0.05 : 0.018);
  }

  function updateDying(dt) {
    g.dying -= dt;
    for (const r of g.rows) {
      const m = (r.L + r.R) / 2;
      r.L = Math.min(m, r.L + 520 * dt);
      r.R = Math.max(m, r.R - 520 * dt);
    }
    updateParticles(dt, false);
    for (const t of g.texts) t.t += dt;
    if (g.dying <= 0) gameOver();
  }

  function hurt(cause) {
    g.hitLog.push([Math.floor(g.d / 40), cause]);
    g.hearts--;
    g.invuln = 1.6;
    g.shake = 14;
    g.flash = 0.8;
    g.flashColor = '255,40,50';
    buzz(140);
    Sfx.hit();
    splash(g.x, g.d, 26, RED_DROPS, 220);
    if (g.hearts <= 0) {
      g.dying = 1.2;
      Sfx.setSpray(0);
      Sfx.over();
      buzz([100, 60, 300]);
      return;
    }
    floatText('-FAITH', g.x, g.d + 30, '#ff5a5f', 20);
    // Emergency parting so the player can recover.
    for (const r of g.rows) {
      if (Math.abs(r.wy - g.d) < 90) {
        r.L = Math.min(r.L, g.x - 46);
        r.R = Math.max(r.R, g.x + 46);
      }
    }
  }

  function loseFollower(x, wy, label) {
    if (g.followers <= 0) return;
    g.followers--;
    g.lossCd = 0.35;
    splash(x, wy, 14, RED_DROPS, 150);
    floatText(label, x, wy, '#ff5a5f', 14);
    Sfx.lost();
    buzz(30);
  }

  function spawnThings(dt, k) {
    const T = g.timers;
    const top = g.rows[g.rows.length - 1];
    const spawnWy = top.wy;
    const inChannel = (frac) => {
      const half = Math.max(0, (top.R - top.L) / 2 - 16);
      return (top.L + top.R) / 2 + rand(-half, half) * frac;
    };

    T.bottle -= dt;
    if (T.bottle <= 0) {
      T.bottle = rand(1.1, 1.9) + k * 0.4;
      g.items.push({ type: 'bottle', x: inChannel(0.6), wy: spawnWy, t: rand(10) });
    }

    T.stray -= dt;
    if (T.stray <= 0) {
      T.stray = rand(5, 9);
      g.items.push({ type: 'stray', x: inChannel(0.35), wy: spawnWy, t: rand(10), look: (Math.random() * 5) | 0 });
    }

    T.tablet -= dt;
    if (T.tablet <= 0) {
      T.tablet = rand(28, 42);
      if (g.hearts < 3) g.items.push({ type: 'tablet', x: inChannel(0.5), wy: spawnWy, t: 0 });
    }

    T.soldier -= dt;
    if (T.soldier <= 0) {
      T.soldier = lerp(3.4, 1.15, k) * rand(0.75, 1.25);
      let n = 1;
      if (Math.random() < k * 0.6) n++;
      if (Math.random() < k * 0.3) n++;
      for (let i = 0; i < n; i++) {
        g.soldiers.push({
          x: inChannel(0.8),
          wy: spawnWy + i * 34,
          vx: 0,
          speed: rand(28, 48) + 30 * k,
          chase: 50 + 40 * k,
          t: rand(10),
        });
      }
      if (!g.warnedSoldiers) {
        g.warnedSoldiers = true;
        showBanner('THE RED TEAM APPROACHES', '#ff5a5f');
      }
    }
  }

  function updateSoldiers(dt, k, dewOn, blasting) {
    const nVis = visibleFollowers();
    const bottom = -(LH - MY) - 40;
    const keep = [];
    for (const s of g.soldiers) {
      s.t += dt;
      s.wy -= s.speed * dt;
      const dy = s.wy - g.d;
      const dx = s.x - g.x;

      // Soldiers aim at Moses from afar, then commit to their lane so they can be dodged.
      if (dy > 110) {
        const want = clamp(-dx * 1.4, -s.chase, s.chase);
        s.vx += (want - s.vx) * Math.min(1, dt * 2.2);
      }
      const f = sprayFall(dy);
      const side = Math.sign(dx) || (s.t % 2 < 1 ? 1 : -1);
      if (f > 0) {
        const aligned = clamp((Math.abs(dx) - 6) / 40, 0, 1);
        s.vx += side * 340 * f * aligned * (dewOn ? 1 : 0.35) * dt;
      }
      if (blasting && dy > bottom) s.vx += side * 1400 * dt;
      s.vx *= 1 - Math.min(1, dt * 1.2);
      s.x += s.vx * dt;

      const r = rowAt(s.wy);
      if (s.x < r.L || s.x > r.R) {
        g.swept++;
        g.score += 25;
        splash(s.x, s.wy, 18, RED_DROPS, 180);
        floatText('SWEPT +25', s.x, s.wy, '#3ff0c8', 15);
        Sfx.swept();
        continue;
      }

      if (Math.abs(dy) < 14 && Math.abs(dx) < 16) {
        if (g.invuln <= 0) {
          hurt('koala');
          splash(s.x, s.wy, 10, ['#968979', '#e3262f'], 120);
          if (g.dying > 0) return;
        }
        continue;
      }

      if (dy < -8) {
        let grabbed = false;
        for (let i = 0; i < nVis; i++) {
          const [fx, fwy] = followerPos(i);
          if (Math.abs(s.wy - fwy) < 12 && Math.abs(s.x - fx) < 14) {
            g.lossCd = 0;
            loseFollower(fx, fwy, 'CAPTURED');
            grabbed = true;
            break;
          }
        }
        if (grabbed) continue;
      }

      if (dy > bottom) keep.push(s);
    }
    g.soldiers = keep;
  }

  function updateItems() {
    const bottom = -(LH - MY) - 30;
    const keep = [];
    for (const it of g.items) {
      const dy = it.wy - g.d;
      if (dy < bottom) continue;
      const r = rowAt(it.wy);
      if (it.x < r.L + 2 || it.x > r.R - 2) {
        if (dy < MY) splash(it.x, it.wy, 6, RED_DROPS, 80);
        continue;
      }
      const dx = it.x - g.x;
      if (Math.abs(dy) < 22 && Math.abs(dx) < 24) {
        collect(it);
        continue;
      }
      keep.push(it);
    }
    g.items = keep;
  }

  function collect(it) {
    if (it.type === 'bottle') {
      g.dew = Math.min(100, g.dew + 20);
      g.bottles++;
      g.score += 10;
      splash(it.x, it.wy, 10, TEAL_DROPS, 120);
      if (g.charges < MAX_CHARGES) {
        g.blastProg++;
        if (g.blastProg >= BOTTLES_PER_CHARGE) {
          g.blastProg = 0;
          g.charges++;
          floatText('BLAST READY!', g.x, g.d + 40, '#3ff0c8', 18);
          Sfx.charge();
          buzz(25);
        } else {
          floatText('+DEW', it.x, it.wy, '#3ff0c8', 15);
          Sfx.pickup();
        }
      } else {
        floatText('+DEW', it.x, it.wy, '#3ff0c8', 15);
        Sfx.pickup();
      }
    } else if (it.type === 'stray') {
      g.followers++;
      g.rescued++;
      g.peakFollowers = Math.max(g.peakFollowers, g.followers);
      g.score += 15;
      floatText('+1 BLASTER', it.x, it.wy, '#fff', 15);
      Sfx.join();
    } else if (it.type === 'tablet') {
      g.hearts = Math.min(3, g.hearts + 1);
      g.score += 20;
      floatText('+FAITH', it.x, it.wy, '#ffe9a8', 18);
      Sfx.faith();
      buzz(20);
    }
  }

  function updateParticles(dt, dewOn) {
    // Moses sprays from both bottles continuously.
    if (g.dying <= 0) {
      g.sprayAcc += dt * (dewOn ? 110 : 35);
      while (g.sprayAcc >= 1) {
        g.sprayAcc--;
        for (const side of [-1, 1]) {
          g.particles.push({
            kind: 'spray',
            x: g.x + side * 25,
            wy: g.d + 27,
            vx: side * rand(360, 520) * (dewOn ? 1 : 0.6),
            vwy: rand(40, 260),
            life: 0.9,
            max: 0.9,
            size: rand(1.6, 3.4),
            color: Math.random() < 0.3 ? '#e6fff8' : '#3ff0c8',
          });
        }
      }
    }
    if (g.blastT > 0.55) {
      for (let i = 0; i < 18; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        g.particles.push({
          kind: 'spray',
          x: g.x + side * 20,
          wy: g.d + rand(-200, 400),
          vx: side * rand(600, 900),
          vwy: rand(-60, 60),
          life: 0.8,
          max: 0.8,
          size: rand(3, 7),
          color: Math.random() < 0.4 ? '#ffffff' : '#3ff0c8',
        });
      }
    }

    const keep = [];
    for (const p of g.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.wy += p.vwy * dt;
      if (p.kind === 'spray') {
        const r = rowAt(p.wy);
        if ((p.vx < 0 && p.x < r.L) || (p.vx > 0 && p.x > r.R)) {
          if (Math.random() < 0.18) splash(p.x, p.wy, 2, RED_DROPS.concat(TEAL_DROPS), 90);
          continue;
        }
      } else {
        p.vx *= 1 - dt * 3;
        p.vwy *= 1 - dt * 3;
      }
      keep.push(p);
    }
    if (keep.length > 900) keep.splice(0, keep.length - 900);
    g.particles = keep;
  }

  function blast() {
    if (state !== 'play' || !g || g.dying > 0 || g.charges <= 0 || g.blastT > 0) return;
    g.charges--;
    g.blastT = 0.85;
    g.dew = Math.min(100, g.dew + 30);
    g.flash = 1;
    g.flashColor = '63,240,200';
    g.shake = 10;
    showBanner('BAJA BLAST!', '#3ff0c8');
    Sfx.blast();
    buzz([40, 30, 90]);
  }

  // ---------------------------------------------------------------- render
  const PALETTE_ROBE = ['#d8c39a', '#b98d5a', '#c9a36b', '#8f6b45', '#e3d2b0'];
  const PALETTE_HEAD = ['#f0e6d0', '#7a5a3a', '#c2b08a', '#5a6e8a', '#a0522d'];

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!g) {
      ctx.fillStyle = '#e9d3a6';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const s = scale * dpr;
    let ox = 0;
    let oy = 0;
    if (g.shake > 0) {
      ox = rand(-g.shake, g.shake) * 0.5;
      oy = rand(-g.shake, g.shake) * 0.5;
    }
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);

    drawGround();
    drawWetSand();
    drawItems();
    drawFollowers();
    drawSoldiers();
    drawMoses();
    drawParticles('spray');
    drawWalls();
    drawParticles('drop');
    drawBlastRing();
    drawTexts();

    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawVignette();
    drawBanner();
    if (g.flash > 0) {
      ctx.fillStyle = `rgba(${g.flashColor},${g.flash * 0.35})`;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function drawGround() {
    const grd = ctx.createLinearGradient(0, 0, 0, LH);
    grd.addColorStop(0, '#d9b98a');
    grd.addColorStop(0.5, '#e7cf9f');
    grd.addColorStop(1, '#d6b483');
    ctx.fillStyle = grd;
    ctx.fillRect(-20, -20, LW + 40, LH + 40);

    const cell = 44;
    const first = Math.floor((g.d - (LH - MY) - cell) / cell);
    const lastC = Math.ceil((g.d + MY + cell) / cell);
    for (let c = first; c <= lastC; c++) {
      const base = c * cell;
      for (let j = 0; j < 5; j++) {
        const hx = hash(c * 7.13 + j * 1.7);
        const hy = hash(c * 3.71 + j * 9.1);
        const hs = hash(c * 1.37 + j * 4.3);
        const x = hx * LW;
        const y = sy(base + hy * cell);
        if (j < 3) {
          ctx.fillStyle = `rgba(120,82,45,${0.12 + hs * 0.18})`;
          ctx.beginPath();
          ctx.ellipse(x, y, 1.5 + hs * 3.5, 1 + hs * 2.2, hs * 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(150,110,70,0.18)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x - 10 - hs * 10, y);
          ctx.quadraticCurveTo(x, y - 3, x + 10 + hs * 10, y);
          ctx.stroke();
        }
      }
    }
  }

  function wob(wy, side) {
    const t = g.t;
    return 2.6 * Math.sin(wy * 0.045 + t * 2.6 + side) + 1.7 * Math.sin(wy * 0.11 - t * 4.1 + side * 2);
  }

  function edgePoints() {
    const left = [];
    const right = [];
    for (const r of g.rows) {
      const y = sy(r.wy);
      if (y < -30 || y > LH + 30) continue;
      left.push(r.L + wob(r.wy, 0), y);
      right.push(r.R - wob(r.wy, 3), y);
    }
    return [left, right];
  }

  function strokeEdge(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }

  function wallPath(pts, outerX) {
    ctx.beginPath();
    ctx.moveTo(outerX, pts[pts.length - 1] + 40);
    ctx.lineTo(outerX, pts[1] - 40);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }

  let edgeCache = null;

  function drawWetSand() {
    edgeCache = edgePoints();
    if (edgeCache[0].length < 4) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const pts of edgeCache) {
      ctx.strokeStyle = 'rgba(110,40,25,0.16)';
      ctx.lineWidth = 34;
      strokeEdge(pts);
      ctx.strokeStyle = 'rgba(90,25,20,0.18)';
      ctx.lineWidth = 14;
      strokeEdge(pts);
    }
  }

  function drawWalls() {
    const [left, right] = edgeCache;
    if (left.length < 4) return;
    const t = g.t;
    const sides = [
      [left, -40, -1],
      [right, LW + 40, 1],
    ];
    for (const [pts, outer, dir] of sides) {
      ctx.save();
      wallPath(pts, outer);
      ctx.fillStyle = '#7a0510';
      ctx.fill();
      ctx.clip();

      // Depth shading from the screen edge.
      const eg = ctx.createLinearGradient(dir < 0 ? 0 : LW, 0, dir < 0 ? 120 : LW - 120, 0);
      eg.addColorStop(0, 'rgba(30,0,4,0.55)');
      eg.addColorStop(1, 'rgba(30,0,4,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(0, 0, LW, LH);

      // Bands of brighter water near the face of the wall.
      ctx.lineJoin = 'round';
      const bands = [
        [64, '#8e0812'],
        [40, '#a80d18'],
        [24, '#c8141f'],
        [11, '#ec3036'],
      ];
      for (const [lw, col] of bands) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        strokeEdge(pts);
      }

      // Flowing streaks inside the wall.
      ctx.setLineDash([18, 26]);
      for (let j = 1; j <= 4; j++) {
        const off = j * 22 * -dir;
        ctx.lineDashOffset = -t * (70 + j * 25);
        ctx.strokeStyle = `rgba(255,140,140,${0.22 - j * 0.035})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i] + off + Math.sin(pts[i + 1] * 0.05 + t * 2 + j) * 4;
          if (i === 0) ctx.moveTo(x, pts[i + 1]);
          else ctx.lineTo(x, pts[i + 1]);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Foam crest along the dry edge.
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,215,215,0.85)';
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 13]);
      ctx.lineDashOffset = -t * 90;
      strokeEdge(pts);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 19]);
      ctx.lineDashOffset = t * 60;
      strokeEdge(pts);
      ctx.setLineDash([]);
    }
  }

  function drawShadow(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(60,35,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPerson(x, y, look, phase, armsUp = false) {
    const bob = Math.sin(g.t * 10 + phase) * 1.1;
    drawShadow(x, y + 8, 8, 3.5);
    y += bob;
    ctx.fillStyle = PALETTE_ROBE[look % PALETTE_ROBE.length];
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 4);
    ctx.quadraticCurveTo(x, y - 8, x + 6, y - 4);
    ctx.lineTo(x + 8, y + 8);
    ctx.quadraticCurveTo(x, y + 11, x - 8, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,15,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (armsUp) {
      ctx.strokeStyle = PALETTE_ROBE[look % PALETTE_ROBE.length];
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const wave = Math.sin(g.t * 12 + phase) * 2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 3);
      ctx.lineTo(x - 10, y - 12 + wave);
      ctx.moveTo(x + 5, y - 3);
      ctx.lineTo(x + 10, y - 12 - wave);
      ctx.stroke();
    }
    ctx.fillStyle = PALETTE_HEAD[(look * 3 + 1) % PALETTE_HEAD.length];
    ctx.beginPath();
    ctx.arc(x, y - 7, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawFollowers() {
    const n = visibleFollowers();
    for (let i = n - 1; i >= 0; i--) {
      const [fx, fwy] = followerPos(i);
      drawPerson(fx + Math.sin(i * 1.7) * 2, sy(fwy), i, i * 0.9);
    }
    if (g.followers > n) {
      ctx.font = '900 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      const label = `+${g.followers - n}`;
      const lx = histX(g.d - FOLLOW_GAP * n);
      ctx.strokeText(label, lx, LH - 8);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx, LH - 8);
    }
  }

  function drawItems() {
    for (const it of g.items) {
      const y = sy(it.wy);
      if (y < -30 || y > LH + 30) continue;
      it.t += 0.016;
      if (it.type === 'bottle') drawBottleItem(it.x, y, it.t);
      else if (it.type === 'stray') {
        ctx.strokeStyle = `rgba(255,255,255,${0.45 + Math.sin(it.t * 6) * 0.25})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(it.x, y + 1, 15, 0, Math.PI * 2);
        ctx.stroke();
        drawPerson(it.x, y, it.look, it.t, true);
      } else if (it.type === 'tablet') drawTablet(it.x, y, it.t);
    }
  }

  function drawBottle(x, y, angle, size = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    // body (pointing up the local -y axis)
    ctx.fillStyle = 'rgba(70,225,180,0.95)';
    ctx.strokeStyle = '#0a5c4c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, 8);
    ctx.lineTo(-4, -2);
    ctx.quadraticCurveTo(-4, -6, -2, -7);
    ctx.lineTo(-2, -10);
    ctx.lineTo(2, -10);
    ctx.lineTo(2, -7);
    ctx.quadraticCurveTo(4, -6, 4, -2);
    ctx.lineTo(4, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b3d2f';
    ctx.fillRect(-2.4, -12.5, 4.8, 3);
    ctx.fillStyle = '#e3141c';
    ctx.fillRect(-4, -0.5, 8, 3.2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(-2.8, -1, 1.2, 8);
    ctx.restore();
  }

  function drawBottleItem(x, y, t) {
    const pulse = 0.5 + Math.sin(t * 5) * 0.5;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 20);
    glow.addColorStop(0, `rgba(63,240,200,${0.45 + pulse * 0.25})`);
    glow.addColorStop(1, 'rgba(63,240,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    drawShadow(x + 2, y + 9, 6, 2.5);
    drawBottle(x, y - Math.sin(t * 4) * 1.5, Math.sin(t * 2) * 0.15, 1.15);
  }

  function drawTablet(x, y, t) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 24);
    glow.addColorStop(0, `rgba(255,236,170,${0.5 + Math.sin(t * 5) * 0.2})`);
    glow.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
    drawShadow(x, y + 10, 12, 3.5);
    for (const side of [-1, 1]) {
      const cx = x + side * 6;
      ctx.fillStyle = '#9b9285';
      ctx.strokeStyle = '#4e463c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 5.5, y + 9);
      ctx.lineTo(cx - 5.5, y - 5);
      ctx.arc(cx, y - 5, 5.5, Math.PI, 0);
      ctx.lineTo(cx + 5.5, y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(50,40,30,0.6)';
      ctx.lineWidth = 0.9;
      for (let l = 0; l < 4; l++) {
        ctx.beginPath();
        ctx.moveTo(cx - 3, y - 4 + l * 3.4);
        ctx.lineTo(cx + 3, y - 4 + l * 3.4);
        ctx.stroke();
      }
    }
  }

  function drawSoldiers() {
    for (const s of g.soldiers) {
      const y = sy(s.wy);
      if (y < -30 || y > LH + 30) continue;
      const x = s.x;
      const bob = Math.sin(s.t * 11) * 1.2;
      const lean = clamp(s.vx / 300, -0.5, 0.5);
      drawShadow(x, y + 10, 10, 4);
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.rotate(lean);
      const flap = Math.sin(s.t * 9);
      // cape
      ctx.fillStyle = '#b3141c';
      ctx.strokeStyle = '#5a0a0e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.quadraticCurveTo(-13 - flap * 2, 8, -11 - flap * 3, 15);
      ctx.lineTo(11 + flap * 3, 15);
      ctx.quadraticCurveTo(13 + flap * 2, 8, 6, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // palm branch
      ctx.save();
      ctx.translate(9, -3);
      ctx.rotate(0.25 + flap * 0.08);
      ctx.strokeStyle = '#5b4a22';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(0, -16);
      ctx.stroke();
      ctx.fillStyle = '#4f8a5b';
      for (let i = 0; i < 5; i++) {
        const ly = -14 + i * 3.4;
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(sx * 2.6, ly + 1.2, 3, 1.1, sx * -0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      // arms
      ctx.fillStyle = '#857869';
      ctx.strokeStyle = '#3b3128';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(-8.5, 4 + flap, 3, 5, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(8.5, -1, 3, 5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // body
      ctx.fillStyle = '#968979';
      ctx.beginPath();
      ctx.ellipse(0, 4, 8.5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d8cbb6';
      ctx.beginPath();
      ctx.ellipse(0, 6, 4.8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // scarf
      ctx.fillStyle = '#d61e26';
      ctx.beginPath();
      ctx.ellipse(0, -1.5, 7.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // ears
      for (const sx of [-1, 1]) {
        ctx.fillStyle = '#968979';
        ctx.strokeStyle = '#3b3128';
        ctx.beginPath();
        ctx.arc(sx * 7, -11, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f2e9dc';
        ctx.beginPath();
        ctx.arc(sx * 7.4, -10.5, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // head
      ctx.fillStyle = '#968979';
      ctx.strokeStyle = '#3b3128';
      ctx.beginPath();
      ctx.ellipse(0, -7, 7, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // headband and trailing tails
      ctx.strokeStyle = '#e3262f';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-7.4, -9);
      ctx.lineTo(7.4, -9);
      ctx.moveTo(6.8, -9);
      ctx.quadraticCurveTo(11, -10 + flap * 2, 15, -7 + flap * 3);
      ctx.moveTo(6.8, -9);
      ctx.quadraticCurveTo(10, -7 - flap, 13.5, -3 - flap * 2);
      ctx.stroke();
      // angry brows and eyes
      ctx.strokeStyle = '#1a1612';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-4.6, -8);
      ctx.lineTo(-1.4, -6.6);
      ctx.moveTo(4.6, -8);
      ctx.lineTo(1.4, -6.6);
      ctx.stroke();
      ctx.fillStyle = '#1a1612';
      ctx.beginPath();
      ctx.arc(-3, -5.6, 1, 0, Math.PI * 2);
      ctx.arc(3, -5.6, 1, 0, Math.PI * 2);
      ctx.fill();
      // nose
      ctx.fillStyle = '#26211d';
      ctx.beginPath();
      ctx.ellipse(0, -3.6, 2.4, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(-0.8, -4.6, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMoses() {
    const x = g.x;
    let y = MY;
    if (g.dying > 0 || (g.invuln > 0 && Math.floor(g.invuln * 12) % 2 === 0)) ctx.globalAlpha = 0.45;
    drawShadow(x, y + 15, 20, 7);
    y += Math.sin(g.t * 9) * 1.2;
    const tilt = clamp(g.vx / 900, -0.25, 0.25);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // cloak trailing in the wind
    const flap = Math.sin(g.t * 7) * 2;
    ctx.fillStyle = '#163ea6';
    ctx.strokeStyle = '#0a1f5c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-13, -8);
    ctx.quadraticCurveTo(0, -12, 13, -8);
    ctx.lineTo(19 + flap, 17);
    ctx.quadraticCurveTo(0, 22, -19 - flap, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,232,210,0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-7, -9);
    ctx.lineTo(-10 - flap * 0.5, 18);
    ctx.moveTo(7, -9);
    ctx.lineTo(10 + flap * 0.5, 18);
    ctx.stroke();
    ctx.fillStyle = '#7a4a22';
    ctx.fillRect(-12, 3, 24, 3.5);

    // arms raised outward, bottles spraying
    for (const side of [-1, 1]) {
      ctx.strokeStyle = '#1c48b8';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(side * 11, -7);
      ctx.lineTo(side * 21, -21);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240,232,210,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(side * 18, -16);
      ctx.lineTo(side * 21, -20);
      ctx.stroke();
      ctx.fillStyle = '#c99a72';
      ctx.beginPath();
      ctx.arc(side * 22, -23, 3, 0, Math.PI * 2);
      ctx.fill();
      drawBottle(side * 23, -25, side * 1.05, 0.95);
    }

    // head from behind: long white hair
    ctx.fillStyle = '#e9e3d6';
    ctx.strokeStyle = '#8f877a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -13, 8, Math.PI, 0);
    ctx.lineTo(8, -9);
    for (let i = 0; i <= 6; i++) {
      const hx = 8 - (16 * i) / 6;
      ctx.lineTo(hx, -5 + (i % 2 ? 2.5 : 0));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,130,115,0.6)';
    ctx.beginPath();
    ctx.moveTo(-3, -19);
    ctx.quadraticCurveTo(-4, -12, -5, -6);
    ctx.moveTo(3, -19);
    ctx.quadraticCurveTo(4, -12, 5, -6);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawParticles(kind) {
    for (const p of g.particles) {
      if (p.kind !== kind) continue;
      const y = sy(p.wy);
      if (y < -10 || y > LH + 10) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * (kind === 'spray' ? 0.85 : 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBlastRing() {
    if (g.blastT <= 0) return;
    const p = 1 - g.blastT / 0.85;
    ctx.strokeStyle = `rgba(63,240,200,${1 - p})`;
    ctx.lineWidth = 10 * (1 - p) + 2;
    ctx.beginPath();
    ctx.arc(g.x, MY, 30 + p * 520, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.8})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(g.x, MY, 20 + p * 380, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const t of g.texts) {
      const a = clamp(1.4 - t.t * 1.3, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `900 ${t.size}px "Arial Black", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const x = clamp(t.x, 50, LW - 50);
      const y = sy(t.wy);
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(LW / 2, LH * 0.55, LH * 0.3, LW / 2, LH * 0.55, LH * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(20,0,5,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, LW, LH);
    if (g.hearts === 1 && g.dying <= 0) {
      const a = 0.25 + Math.sin(g.t * 6) * 0.12;
      const r = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.25, LW / 2, LH / 2, LH * 0.75);
      r.addColorStop(0, 'rgba(255,0,20,0)');
      r.addColorStop(1, `rgba(255,0,20,${a})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function drawBanner() {
    const b = g.banner;
    if (!b) return;
    const inT = clamp(b.t / 0.25, 0, 1);
    const outT = clamp((2 - b.t) / 0.35, 0, 1);
    const a = Math.min(inT, outT);
    const sc = 0.6 + 0.4 * (1 - Math.pow(1 - inT, 3));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(LW / 2, LH * 0.3);
    ctx.scale(sc, sc);
    ctx.rotate(-0.04);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 30;
    ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    const maxW = LW - 40;
    const tw = ctx.measureText(b.text).width;
    if (tw > maxW) {
      size = Math.floor((size * maxW) / tw);
      ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#0b2a6b';
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    hearts: $('hearts'),
    followers: $('followers'),
    mult: $('mult'),
    score: $('score'),
    meters: $('meters'),
    dewFill: $('dewFill'),
    blastBtn: $('blastBtn'),
    blastCount: $('blastCount'),
    blastProgress: $('blastProgress'),
    cache: {},
  };

  function setText(key, el, val) {
    if (hud.cache[key] !== val) {
      hud.cache[key] = val;
      el.textContent = val;
    }
  }

  function updateHud() {
    if (hud.cache.hearts !== g.hearts) {
      hud.cache.hearts = g.hearts;
      hud.hearts.innerHTML = [0, 1, 2]
        .map((i) => `<span class="heart${i < g.hearts ? '' : ' empty'}">♥</span>`)
        .join('');
    }
    setText('followers', hud.followers, String(g.followers));
    const m = multiplier();
    setText('mult', hud.mult, m > 1 ? `x${m}` : '');
    setText('score', hud.score, Math.floor(g.score).toLocaleString());
    setText('meters', hud.meters, `${Math.floor(g.d / 40)} m`);
    const dew = Math.round(g.dew);
    if (hud.cache.dew !== dew) {
      hud.cache.dew = dew;
      hud.dewFill.style.transform = `scaleX(${dew / 100})`;
      hud.dewFill.classList.toggle('low', dew < 20);
    }
    setText('charges', hud.blastCount, String(g.charges));
    const prog = g.charges >= MAX_CHARGES ? 1 : g.blastProg / BOTTLES_PER_CHARGE;
    if (hud.cache.prog !== prog) {
      hud.cache.prog = prog;
      hud.blastProgress.style.strokeDashoffset = String(289 * (1 - prog));
    }
    const ready = g.charges > 0;
    if (hud.cache.ready !== ready) {
      hud.cache.ready = ready;
      hud.blastBtn.classList.toggle('ready', ready);
      hud.blastBtn.classList.toggle('empty', !ready);
    }
  }

  // ---------------------------------------------------------------- flow
  const screens = { title: $('title'), pause: $('pause'), over: $('over') };

  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    $('hud').classList.toggle('hidden', name === 'title' || name === 'over');
  }

  const getBest = () => Number(localStorage.getItem(BEST_KEY) || 0);

  function refreshBest() {
    const b = getBest();
    $('bestLine').textContent = b > 0 ? `BEST: ${b.toLocaleString()}` : '';
  }

  function start() {
    Sfx.init();
    resize();
    newGame();
    hud.cache = {};
    state = 'play';
    show(null);
    $('hud').classList.remove('hidden');
    updateHud();
    last = performance.now();
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    Sfx.setSpray(0);
    show('pause');
  }

  function resume() {
    if (state !== 'pause') return;
    Sfx.init();
    state = 'play';
    show(null);
    $('hud').classList.remove('hidden');
    last = performance.now();
  }

  function toTitle() {
    state = 'title';
    Sfx.setSpray(0);
    refreshBest();
    show('title');
  }

  function gameOver() {
    state = 'over';
    Sfx.setSpray(0);
    const score = Math.floor(g.score);
    const prev = getBest();
    const isBest = score > prev;
    if (isBest) localStorage.setItem(BEST_KEY, String(score));
    $('oScore').textContent = score.toLocaleString();
    $('oMeters').textContent = `${Math.floor(g.d / 40)} m`;
    $('oPeople').textContent = String(g.peakFollowers);
    $('oSwept').textContent = String(g.swept);
    $('oBottles').textContent = String(g.bottles);
    $('oBest').textContent = Math.max(score, prev).toLocaleString();
    $('overTitle').innerHTML = isBest
      ? 'THE RED TEAM<br>CLOSED IN<span class="new-best">★ NEW BEST ★</span>'
      : 'THE RED TEAM<br>CLOSED IN';
    show('over');
  }

  function frame(now) {
    const dt = clamp((now - last) / 1000 || 0, 0, 0.033);
    last = now;
    if (state === 'play') {
      update(dt);
      if (state === 'play') updateHud();
    }
    if (state !== 'title') render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- input
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    drag = { id: e.pointerId, x: e.clientX };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId || state !== 'play') return;
    const dx = (e.clientX - drag.x) / scale;
    drag.x = e.clientX;
    g.tx = clamp(g.tx + dx * 1.35, 14, LW - 14);
  });
  const endDrag = (e) => {
    if (drag && drag.id === e.pointerId) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = true;
    else if (k === 'arrowright' || k === 'd') keys.right = true;
    else if (k === ' ') {
      e.preventDefault();
      if (state === 'play') blast();
      else if (state === 'title' || state === 'over') start();
    } else if (k === 'escape' || k === 'p') {
      if (state === 'play') pause();
      else if (state === 'pause') resume();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    else if (k === 'arrowright' || k === 'd') keys.right = false;
  });

  $('blastBtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    blast();
  });
  $('pauseBtn').addEventListener('click', pause);
  $('playBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);
  $('homeBtn').addEventListener('click', toTitle);
  $('resumeBtn').addEventListener('click', resume);
  $('quitBtn').addEventListener('click', toTitle);

  const muteBtn = $('muteBtn');
  const syncMute = () => { muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; };
  muteBtn.addEventListener('click', () => {
    Sfx.setMuted(!Sfx.muted);
    syncMute();
  });
  syncMute();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // Debug hook for automated checks.
  window.__baja = { get state() { return state; }, get g() { return g; }, start, blast };

  refreshBest();
  resize();
  requestAnimationFrame(frame);
})();

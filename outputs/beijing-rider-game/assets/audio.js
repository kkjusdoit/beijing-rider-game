/* 我在北京挺好的：三日骑手 —— 环境音与配乐
   全部用 Web Audio 现场合成：雨声、雷声、车流、克制的氛围音。
   不引用任何外部音频文件，断网可用，也不涉及版权素材。 */
(function () {
  'use strict';

  var ctx = null;
  var master = null;      // 总音量
  var bus = {};           // 各声部
  var state = {
    ready: false,
    muted: true,
    volume: 0.6,
    weather: 'none',
    mood: 'none'
  };
  var thunderTimer = null;
  var musicTimer = null;

  function now() { return ctx.currentTime; }

  /* ---------- 基础工具 ---------- */

  // 一段循环的白噪声缓冲，雨声与车流都基于它
  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 棕噪声：比白噪声更低沉，适合车流与雷声尾巴
  function brownBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  function loopSource(buf) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function ramp(param, value, seconds) {
    var t = now();
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + (seconds || 1.2));
  }

  /* ---------- 声部构建 ---------- */

  function buildRain() {
    // 雨 = 高通白噪声（沙沙） + 中频层（雨点密度）
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);

    var hiss = loopSource(noiseBuffer(4));
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    var hissGain = ctx.createGain();
    hissGain.gain.value = 0.5;
    hiss.connect(hp); hp.connect(hissGain); hissGain.connect(g);

    var body = loopSource(noiseBuffer(4));
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 0.7;
    var bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.75;
    body.connect(bp); bp.connect(bodyGain); bodyGain.connect(g);

    hiss.start(); body.start();
    return { gain: g, tone: bp.frequency, air: hp.frequency };
  }

  function buildTraffic() {
    // 车流 = 低通棕噪声 + 缓慢起伏（车一辆辆过去）
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);

    var src = loopSource(brownBuffer(6));
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    src.connect(lp); lp.connect(g);

    // 用极低频 LFO 让车流有呼吸感
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    lfo.start(); src.start();
    return { gain: g };
  }

  function buildAmbience() {
    // 室内/晴天用的极轻底噪，避免完全死寂
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    var src = loopSource(brownBuffer(5));
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    src.connect(lp); lp.connect(g);
    src.start();
    return { gain: g };
  }

  /* ---------- 雷声 ---------- */

  function thunder(distant) {
    if (state.muted) return;
    var t = now();
    var g = ctx.createGain();
    g.connect(master);
    var peak = distant ? 0.16 : 0.34;

    var src = ctx.createBufferSource();
    src.buffer = brownBuffer(distant ? 2.6 : 3.6);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(distant ? 180 : 340, t);
    lp.frequency.linearRampToValueAtTime(70, t + (distant ? 2.4 : 3.2));
    src.connect(lp); lp.connect(g);

    // 先一下闷响，再拖一条长尾，不做爆裂的高频
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (distant ? 0.5 : 0.22));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (distant ? 2.6 : 3.6));

    src.start(t);
    src.stop(t + (distant ? 2.7 : 3.7));
    src.onended = function () { try { g.disconnect(); } catch (e) {} };
  }

  function scheduleThunder() {
    clearTimeout(thunderTimer);
    if (state.weather !== 'storm' && state.weather !== 'nightstorm') return;
    var wait = 7000 + Math.random() * 9000;
    thunderTimer = setTimeout(function () {
      thunder(Math.random() < 0.55);
      scheduleThunder();
    }, wait);
  }

  /* ---------- 配乐 ---------- */

  // 五声音阶，稀疏单音 + 长衰减，情绪跟着章节走
  var SCALES = {
    hope:   [220.00, 246.94, 293.66, 329.63, 440.00, 493.88],
    grey:   [196.00, 220.00, 261.63, 293.66, 392.00, 440.00],
    dark:   [146.83, 174.61, 196.00, 220.00, 261.63, 293.66],
    warm:   [174.61, 207.65, 233.08, 261.63, 311.13, 349.23]
  };

  function tone(freq, dur, gain) {
    var t = now();
    var g = ctx.createGain();
    g.connect(bus.music.gain);
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    osc.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.1);
    osc.onended = function () { try { g.disconnect(); } catch (e) {} };
  }

  function scheduleMusic() {
    clearTimeout(musicTimer);
    if (state.mood === 'none' || state.muted) return;
    var scale = SCALES[state.mood] || SCALES.grey;
    var wait = 2600 + Math.random() * 3400;
    musicTimer = setTimeout(function () {
      if (!state.muted && state.mood !== 'none') {
        var f = scale[Math.floor(Math.random() * scale.length)];
        tone(f, 5 + Math.random() * 3, 0.055);
        // 偶尔叠一个低五度，做一点厚度
        if (Math.random() < 0.35) tone(f / 2, 7, 0.04);
      }
      scheduleMusic();
    }, wait);
  }

  /* ---------- 天气预设 ---------- */

  var WEATHER = {
    none:       { rain: 0,    traffic: 0,    amb: 0,    tone: 620,  air: 1400 },
    clear:      { rain: 0,    traffic: 0.20, amb: 0.10, tone: 620,  air: 1400 },
    indoor:     { rain: 0,    traffic: 0.05, amb: 0.14, tone: 620,  air: 1400 },
    street:     { rain: 0,    traffic: 0.30, amb: 0.08, tone: 620,  air: 1400 },
    drizzle:    { rain: 0.20, traffic: 0.18, amb: 0.05, tone: 520,  air: 1900 },
    rain:       { rain: 0.38, traffic: 0.20, amb: 0.04, tone: 600,  air: 1500 },
    storm:      { rain: 0.72, traffic: 0.26, amb: 0.03, tone: 780,  air: 1050 },
    night:      { rain: 0,    traffic: 0.10, amb: 0.12, tone: 620,  air: 1400 },
    nightrain:  { rain: 0.34, traffic: 0.09, amb: 0.05, tone: 480,  air: 1700 },
    nightstorm: { rain: 0.66, traffic: 0.10, amb: 0.03, tone: 700,  air: 1150 }
  };

  /* ---------- 对外接口 ---------- */

  var api = {
    // 必须由用户手势触发（浏览器自动播放限制）
    init: function () {
      if (state.ready) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      bus.rain = buildRain();
      bus.traffic = buildTraffic();
      bus.amb = buildAmbience();
      bus.music = { gain: (function () { var g = ctx.createGain(); g.gain.value = 0.9; g.connect(master); return g; })() };
      state.ready = true;
      return true;
    },

    resume: function () {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    suspend: function () {
      if (ctx && ctx.state === 'running') {
        try { ctx.suspend(); } catch (e) {}
      }
      clearTimeout(thunderTimer);
      clearTimeout(musicTimer);
    },

    setMuted: function (m) {
      state.muted = !!m;
      if (!state.ready) return;
      if (state.muted) {
        ramp(master.gain, 0, 0.5);
        clearTimeout(thunderTimer);
        clearTimeout(musicTimer);
      } else {
        api.resume();
        ramp(master.gain, state.volume, 0.9);
        scheduleThunder();
        scheduleMusic();
      }
    },

    setVolume: function (v) {
      state.volume = Math.max(0, Math.min(1, v));
      if (state.ready && !state.muted) ramp(master.gain, state.volume, 0.3);
    },

    // 场景切换：天气声部渐变，不做突变
    setWeather: function (w) {
      var p = WEATHER[w] || WEATHER.none;
      if (state.weather === w) return;
      var wasStorm = state.weather === 'storm' || state.weather === 'nightstorm';
      state.weather = w;
      if (!state.ready) return;
      ramp(bus.rain.gain.gain, p.rain, 2.0);
      ramp(bus.traffic.gain.gain, p.traffic, 2.4);
      ramp(bus.amb.gain.gain, p.amb, 2.0);
      ramp(bus.rain.tone, p.tone, 2.4);
      ramp(bus.rain.air, p.air, 2.4);
      var isStorm = w === 'storm' || w === 'nightstorm';
      if (isStorm && !wasStorm) scheduleThunder();
      if (!isStorm) clearTimeout(thunderTimer);
    },

    setMood: function (m) {
      if (state.mood === m) return;
      state.mood = m || 'none';
      if (!state.ready) return;
      if (state.mood === 'none') { clearTimeout(musicTimer); ramp(bus.music.gain.gain, 0, 2.0); }
      else { ramp(bus.music.gain.gain, 0.9, 2.0); scheduleMusic(); }
    },

    // 剧情里明确写到雷的那几处，由 app.js 主动触发一声
    thunder: function (distant) { if (state.ready) thunder(distant); },

    // 翻页音：一点纸感，不刺耳
    blip: function () {
      if (!state.ready || state.muted) return;
      var t = now();
      var g = ctx.createGain();
      g.connect(master);
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.08);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 0.9;
      src.connect(bp); bp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.start(t); src.stop(t + 0.1);
      src.onended = function () { try { g.disconnect(); } catch (e) {} };
    },

    isMuted: function () { return state.muted; },
    getVolume: function () { return state.volume; }
  };

  /* ---------- 切页 / 锁屏自动挂起与恢复 ---------- */
  document.addEventListener('visibilitychange', function () {
    if (!state.ready) return;
    if (document.hidden) {
      api.suspend();
    } else if (!state.muted) {
      api.resume();
      scheduleThunder();
      scheduleMusic();
    }
  });

  window.GameAudio = api;
})();

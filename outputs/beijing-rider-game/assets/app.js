/* 我在北京挺好的：三日骑手 —— 引擎
 * 剧情推进、逐字机、状态条、章节/历史/设置、版本化存档、天气与分支。
 * 纯前端，无框架，无外部请求；所有素材本地加载，断网可玩。 */
(function () {
  'use strict';

  var S = window.StoryData;
  var A = window.GameAudio;
  var SAVE_KEY = 'brg.save.v3';   // 版本化存档键；结构变化时递增
  var HISTORY_CAP = 400;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 运行时状态 ---------- */

  var state = null;               // 见 freshState()
  var typing = null;              // 当前逐字机计时器
  var lastNode = null;            // 当前展示的节点
  var lastBg = null, lastWeather = null, lastMood = null;

  function freshState() {
    return {
      v: 3,
      stack: [{ seq: 'c0', idx: 0 }],
      stats: { energy: 100, hunger: 100, will: 85, money: 0 },
      snapshots: {},              // 每章进入时的 stats 快照，供章节选择还原
      reached: 0,                 // 已到达的最大主线章节下标
      history: [],
      settings: { muted: true, volume: 0.6, speed: 'normal', typewriter: true },
      finished: false,
      onWhatif: false
    };
  }

  /* ---------- DOM ---------- */

  var el = {};
  function grab() {
    [
      'title-screen', 'warning-screen', 'game-screen', 'ending-screen',
      'start-sound', 'start-muted', 'continue-btn', 'open-warning', 'warning-back',
      'scene-bg', 'weather-canvas', 'whatif-banner',
      'chapter-number', 'chapter-kicker', 'chapter-title',
      'history-btn', 'chapters-btn', 'settings-btn',
      'energy-meter', 'energy-value', 'hunger-meter', 'hunger-value',
      'will-meter', 'will-value', 'money-value',
      'meta-time', 'meta-weather', 'meta-place', 'meta-order',
      'speaker', 'fact-tag', 'dialogue', 'choices', 'progress-label', 'next-btn',
      'ending-title', 'timeline-btn', 'afterword-btn', 'restart-btn',
      'modal', 'modal-title', 'modal-content', 'live-region'
    ].forEach(function (id) { el[camel(id)] = document.getElementById(id); });
  }
  function camel(id) { return id.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); }); }

  /* ---------- 屏幕切换 ---------- */

  function show(screenId) {
    ['titleScreen', 'warningScreen', 'gameScreen', 'endingScreen'].forEach(function (k) {
      el[k].classList.remove('active');
    });
    el[screenId].classList.add('active');
  }

  /* ---------- 存档 ---------- */

  function saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function loadGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.v !== 3 || !d.stack) return null;   // 旧版本存档：忽略，从头开始
      return d;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  /* ---------- 游标 ---------- */

  function top() { return state.stack[state.stack.length - 1]; }
  function curSeq() { return S.seqs[top().seq]; }
  function curNode() { return curSeq()[top().idx]; }

  function chapterIndexBySeq(seq) {
    for (var i = 0; i < S.chapters.length; i++) if (S.chapters[i].seq === seq) return i;
    return -1;
  }

  /* 进入某一主线章节（idx 0） */
  function enterChapter(ci, restoreStats) {
    var ch = S.chapters[ci];
    state.stack = [{ seq: ch.seq, idx: 0 }];
    state.onWhatif = false;
    if (ci > state.reached) state.reached = ci;
    if (restoreStats && state.snapshots[ch.seq]) {
      state.stats = clone(state.snapshots[ch.seq]);
    } else {
      state.snapshots[ch.seq] = clone(state.stats);
    }
    renderNode(false);
  }

  /* 前进一步 */
  function advance() {
    var f = top();
    if (f.idx + 1 < S.seqs[f.seq].length) {
      f.idx++;
      renderNode(true);
      return;
    }
    // 当前序列走完
    if (state.stack.length > 1) {
      state.stack.pop();                 // 从假设支线返回
      state.onWhatif = state.stack.length > 1;
      var p = top();
      p.idx++;                           // 跨过当初的选择节点
      if (p.idx < S.seqs[p.seq].length) renderNode(true);
      else advance();
      return;
    }
    // 主线章节走完 → 下一章
    var ci = chapterIndexBySeq(f.seq);
    if (ci >= 0 && ci < S.chapters.length - 1) enterChapter(ci + 1, false);
    else showEnding();
  }

  /* 选择分支 */
  function choose(opt) {
    if (opt.go) {
      state.stack.push({ seq: opt.go, idx: 0 });   // 父帧停在选择节点，返回时 +1 跨过
      state.onWhatif = true;
    } else {
      var f = top();
      f.idx++;
    }
    renderNode(true);
  }

  /* ---------- 状态数值 ---------- */

  function applyStats(st) {
    if (!st) return;
    ['energy', 'hunger', 'will'].forEach(function (k) {
      if (typeof st[k] === 'number') {
        state.stats[k] = Math.max(0, Math.min(100, state.stats[k] + st[k]));
      }
    });
    if (typeof st.money === 'number') state.stats.money += st.money;
  }

  function paintStats() {
    var s = state.stats;
    el.energyMeter.style.width = s.energy + '%';
    el.energyValue.textContent = s.energy;
    el.hungerMeter.style.width = s.hunger + '%';
    el.hungerValue.textContent = s.hunger;
    el.willMeter.style.width = s.will + '%';
    el.willValue.textContent = s.will;
    el.energyMeter.style.background = meterColor(s.energy);
    el.hungerMeter.style.background = meterColor(s.hunger);
    el.willMeter.style.background = meterColor(s.will);
    var m = s.money;
    el.moneyValue.textContent = (m < 0 ? '−¥' : '¥') + Math.abs(m).toLocaleString('en-US');
    el.moneyValue.style.color = m < 0 ? '#e0796d' : '';
  }
  function meterColor(v) {
    if (v <= 25) return '#d76a5c';
    if (v <= 55) return '#d9b26a';
    return '#cfd5d4';
  }

  /* ---------- 章节头 ---------- */

  function paintChapterHead() {
    var ci = chapterIndexBySeq(state.onWhatif ? mainSeqOfStack() : top().seq);
    if (ci < 0) ci = chapterIndexBySeq(mainSeqOfStack());
    if (ci < 0) return;
    var ch = S.chapters[ci];
    el.chapterNumber.textContent = ch.num;
    el.chapterKicker.textContent = ch.kicker;
    el.chapterTitle.textContent = ch.title;
  }
  function mainSeqOfStack() { return state.stack[0].seq; }

  /* ---------- 背景 / 天气 / 声音 ---------- */

  // 没有场景图时，用天气/情绪对应的渐变兜底，保证画面成立；
  // 图片存在时叠在渐变之上。二者都不依赖网络。
  var GRAD = {
    none:       'linear-gradient(160deg,#1a2026,#0e1216)',
    clear:      'linear-gradient(160deg,#2b3a45,#141b20 70%)',
    indoor:     'linear-gradient(160deg,#2a2622,#14110e 72%)',
    street:     'linear-gradient(160deg,#243039,#12181d 72%)',
    night:      'linear-gradient(160deg,#141c26,#080b10 74%)',
    drizzle:    'linear-gradient(160deg,#28323a,#111318 74%)',
    rain:       'linear-gradient(160deg,#222c33,#0d1013 76%)',
    storm:      'linear-gradient(165deg,#1b242c,#070a0d 78%)',
    nightrain:  'linear-gradient(160deg,#111a24,#05080c 78%)',
    nightstorm: 'linear-gradient(165deg,#0e161f,#04060a 80%)'
  };
  var loadedBg = {};   // 成功加载过的场景图 key

  function paintScene() {
    var grad = GRAD[lastWeather] || GRAD.none;
    if (lastBg && loadedBg[lastBg]) {
      el.sceneBg.style.backgroundImage =
        'url("assets/images/' + lastBg + '.webp"), ' + grad;
    } else {
      el.sceneBg.style.backgroundImage = grad;
    }
  }

  function setBackground(bg) {
    if (bg) lastBg = bg;
    paintScene();
    if (!bg || loadedBg[bg]) return;
    // 尝试加载场景图；成功后淡入，失败则保留渐变
    el.sceneBg.classList.add('changing');
    var img = new Image();
    img.onload = function () {
      loadedBg[bg] = true;
      if (lastBg === bg) paintScene();
      requestAnimationFrame(function () { el.sceneBg.classList.remove('changing'); });
    };
    img.onerror = function () {
      el.sceneBg.classList.remove('changing');
    };
    img.src = 'assets/images/' + bg + '.webp';
  }

  function setWeather(w) {
    if (w && w !== lastWeather) {
      lastWeather = w;
      if (A) A.setWeather(w);
      Weather.set(w);
      paintScene();
    }
  }
  function setMood(m) {
    if (m && m !== lastMood) { lastMood = m; if (A) A.setMood(m); }
  }

  /* ---------- 逐字机 ---------- */

  var SPEED = { slow: 46, normal: 26, fast: 14, instant: 0 };

  function typeText(text) {
    clearTyping();
    var d = el.dialogue;
    d.classList.remove('complete');
    var speed = state.settings.typewriter ? SPEED[state.settings.speed] : 0;
    if (reduceMotion || speed === 0) {
      d.textContent = text;
      d.classList.add('complete');
      announceDialogue(text);
      return;
    }
    d.textContent = '';
    var i = 0;
    typing = setInterval(function () {
      // 逐字，遇到换行与标点稍作停顿由 CSS/节奏体现；这里保持匀速简洁
      d.textContent += text.charAt(i);
      i++;
      if (i >= text.length) {
        clearTyping();
        d.classList.add('complete');
        announceDialogue(text);
      }
    }, speed);
  }
  function clearTyping() { if (typing) { clearInterval(typing); typing = null; } }
  function isTyping() { return typing !== null; }
  function announceDialogue(text) {
    if (!el.liveRegion) return;
    var speaker = lastNode && lastNode.s ? lastNode.s + '：' : '旁白：';
    el.liveRegion.textContent = speaker + (text || '');
  }
  function finishTyping() {
    if (!lastNode) return;
    clearTyping();
    el.dialogue.textContent = lastNode.t || '';
    el.dialogue.classList.add('complete');
    announceDialogue(lastNode.t || '');
  }

  /* ---------- 渲染节点 ---------- */

  var FACT_LABEL = {
    real: '真实记录', quote: '日记原文', whatif: '未发生的可能', note: '说明'
  };

  function renderNode(applyDelta) {
    var node = curNode();
    lastNode = node;

    if (applyDelta) applyStats(node.st);

    // 假设支线标记
    var whatif = node.fact === 'whatif' || state.onWhatif;
    el.whatifBanner.hidden = !whatif;
    document.getElementById('dialogue-wrap').classList.toggle('is-whatif', !!whatif);

    // 场景
    setWeather(node.w);
    setBackground(node.bg);
    setMood(node.mood);
    if (node.thunder && A && !state.settings.muted) {
      A.thunder(node.thunder === 'far');
    }

    // meta 状态条
    if (node.meta) {
      el.metaTime.textContent = node.meta[0] || '';
      el.metaWeather.textContent = node.meta[1] || '';
      el.metaPlace.textContent = node.meta[2] || '';
      el.metaOrder.textContent = node.meta[3] || '';
    }

    // 说话人 / 事实标签
    el.speaker.textContent = node.s || '旁白';
    el.speaker.style.color = node.s === '我' ? '' : (node.s ? '#8a5a54' : '#6f7a7c');
    var fact = node.fact || (node.s ? 'real' : 'real');
    el.factTag.textContent = FACT_LABEL[fact] || FACT_LABEL.real;
    el.factTag.className = 'fact-tag fact-' + fact;

    paintStats();
    paintChapterHead();
    paintProgress();

    // 文本
    typeText(node.t || '');
    pushHistory(node, whatif);

    // 选项 / 继续
    renderChoices(node);

    saveGame();
    if (A) A.blip();
  }

  function renderChoices(node) {
    var box = el.choices;
    box.innerHTML = '';
    if (node.choices && node.choices.length) {
      box.hidden = false;
      el.nextBtn.style.visibility = 'hidden';
      node.choices.forEach(function (opt) {
        var b = document.createElement('button');
        b.className = 'choice-btn' + (opt.whatif ? ' whatif' : '');
        b.innerHTML = '<span>' + esc(opt.label) + '</span>' +
          (opt.hint ? '<small>' + esc(opt.hint) + '</small>' : '');
        b.addEventListener('click', function () {
          if (isTyping()) { finishTyping(); return; }
          choose(opt);
        });
        box.appendChild(b);
      });
    } else {
      box.hidden = true;
      el.nextBtn.style.visibility = 'visible';
      el.nextBtn.firstChild.nodeValue = node.endGame ? '看到这里 ' : '继续 ';
    }
  }

  function paintProgress() {
    // 以主线章节为单位显示进度，支线时标注
    var f = top();
    var seq = S.seqs[f.seq];
    var n = String(f.idx + 1).padStart(3, '0');
    var total = String(seq.length).padStart(3, '0');
    var ci = chapterIndexBySeq(mainSeqOfStack());
    var label = (ci >= 0 ? '第 ' + S.chapters[ci].num + ' 章 · ' : '') + n + ' / ' + total;
    if (state.onWhatif) label = '未发生的可能 · ' + n + ' / ' + total;
    el.progressLabel.textContent = label;
  }

  /* ---------- 继续/推进事件 ---------- */

  function onNext() {
    if (isTyping()) { finishTyping(); return; }
    if (lastNode && lastNode.choices) return;      // 选择节点不由“继续”推进
    if (lastNode && lastNode.endGame) { showEnding(); return; }
    advance();
  }

  /* ---------- 历史 ---------- */

  function pushHistory(node, whatif) {
    if (!node.t) return;
    state.history.push({ s: node.s || '', t: node.t, w: !!whatif, f: node.fact || '' });
    if (state.history.length > HISTORY_CAP) state.history.shift();
  }

  /* ---------- 结局 ---------- */

  function showEnding() {
    state.finished = true;
    if (state.reached < S.chapters.length - 1) state.reached = S.chapters.length - 1;
    saveGame();
    clearTyping();
    setMood('warm');
    show('endingScreen');
  }

  /* ================= 天气 canvas ================= */

  var Weather = (function () {
    var canvas, ctx, raf = null, drops = [], w = 0, h = 0, dpr = 1;
    var intensity = 0, storm = false, night = false;
    var flash = 0, nextFlash = 0, tick = 0;

    function resize() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    function seed() {
      var count = Math.floor(w * h / 9000 * intensity);
      drops = [];
      for (var i = 0; i < count; i++) drops.push(newDrop(true));
    }
    function newDrop(spread) {
      return {
        x: Math.random() * (w + 120) - 60,
        y: spread ? Math.random() * h : -20,
        len: 8 + Math.random() * (10 + 22 * intensity),
        spd: 5 + Math.random() * (6 + 12 * intensity),
        slant: 0.9 + intensity * 1.6,
        a: 0.12 + Math.random() * 0.3
      };
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      if (intensity > 0) {
        ctx.strokeStyle = 'rgba(200,214,222,0.5)';
        ctx.lineWidth = 1;
        for (var i = 0; i < drops.length; i++) {
          var d = drops[i];
          ctx.globalAlpha = d.a;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.slant * d.len * 0.4, d.y + d.len);
          ctx.stroke();
          d.x -= d.slant * d.spd * 0.4;
          d.y += d.spd;
          if (d.y > h + 20 || d.x < -80) drops[i] = newDrop(false);
        }
        ctx.globalAlpha = 1;
      }
      // 闪电：低频、柔和，不做高频闪烁
      if (storm) {
        tick++;
        if (flash > 0) {
          ctx.fillStyle = 'rgba(226,232,240,' + (flash * 0.18) + ')';
          ctx.fillRect(0, 0, w, h);
          flash -= 0.035;                      // 缓慢衰减，约 0.5s 淡出
          if (flash < 0) flash = 0;
        } else if (tick >= nextFlash) {
          flash = 1;
          nextFlash = tick + 360 + Math.floor(Math.random() * 540); // ~6–15s
        }
      }
      raf = requestAnimationFrame(frame);
    }

    return {
      init: function () {
        canvas = el.weatherCanvas;
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        window.addEventListener('resize', resize);
      },
      set: function (wkey) {
        var map = {
          none: 0, clear: 0, indoor: 0, night: 0, street: 0,
          drizzle: 0.35, rain: 0.6, nightrain: 0.55, storm: 1, nightstorm: 0.95
        };
        intensity = map[wkey] != null ? map[wkey] : 0;
        storm = wkey === 'storm' || wkey === 'nightstorm';
        night = wkey.indexOf('night') === 0;
        nextFlash = tick + 120;
        if (!canvas) return;
        resize();
        if (reduceMotion) {                    // 降低动态：静态薄雨，无闪电
          cancelAnimationFrame(raf); raf = null;
          ctx.clearRect(0, 0, w, h);
          storm = false;
          return;
        }
        if (intensity === 0 && !storm) {
          cancelAnimationFrame(raf); raf = null;
          if (ctx) ctx.clearRect(0, 0, w, h);
        } else if (!raf) {
          frame();
        }
      }
    };
  })();

  /* ================= 弹窗 ================= */

  var modalReturnFocus = null;

  function modalFocusables() {
    if (!el.modal) return [];
    return Array.prototype.filter.call(el.modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ), function (node) { return node.offsetParent !== null; });
  }

  function openModal(title, node) {
    modalReturnFocus = document.activeElement;
    el.modalTitle.textContent = title;
    el.modalContent.innerHTML = '';
    el.modalContent.appendChild(node);
    el.modal.hidden = false;
    requestAnimationFrame(function () {
      var focusables = modalFocusables();
      (focusables[0] || el.modal).focus();
    });
  }
  function closeModal() {
    el.modal.hidden = true;
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function buildSettings() {
    var wrap = document.createElement('div');
    var s = state.settings;

    wrap.appendChild(toggleRow('声音', '雨声、雷声、车流与配乐', !s.muted, function (on) {
      s.muted = !on;
      if (A) { A.init(); A.setMuted(s.muted); }
      saveGame();
    }));

    var volRow = document.createElement('div');
    volRow.className = 'setting-row';
    volRow.innerHTML = '<label>音量<span>环境音与配乐的总音量</span></label>';
    var vol = document.createElement('input');
    vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round(s.volume * 100);
    vol.addEventListener('input', function () {
      s.volume = vol.value / 100;
      if (A) A.setVolume(s.volume);
      saveGame();
    });
    volRow.appendChild(vol);
    wrap.appendChild(volRow);

    wrap.appendChild(toggleRow('逐字显示', '关闭后整段文字直接出现', s.typewriter, function (on) {
      s.typewriter = on; saveGame();
    }));

    var speedRow = document.createElement('div');
    speedRow.className = 'setting-row';
    speedRow.innerHTML = '<label>文字速度<span>逐字显示的快慢</span></label>';
    var seg = document.createElement('div');
    seg.style.display = 'flex'; seg.style.gap = '6px';
    [['slow', '慢'], ['normal', '中'], ['fast', '快'], ['instant', '即时']].forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'toggle' + (s.speed === p[0] ? ' on' : '');
      b.textContent = p[1];
      b.addEventListener('click', function () {
        s.speed = p[0];
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        saveGame();
      });
      seg.appendChild(b);
    });
    speedRow.appendChild(seg);
    wrap.appendChild(speedRow);

    var reset = document.createElement('div');
    reset.className = 'setting-row';
    reset.innerHTML = '<label>重新开始<span>清除存档，从序章重来</span></label>';
    var rb = document.createElement('button');
    rb.className = 'toggle'; rb.textContent = '清除存档';
    rb.addEventListener('click', function () {
      if (confirm('确定清除存档、从头开始吗？')) { clearSave(); location.reload(); }
    });
    reset.appendChild(rb);
    wrap.appendChild(reset);

    return wrap;
  }

  function toggleRow(title, desc, on, cb) {
    var row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = '<label>' + esc(title) + '<span>' + esc(desc) + '</span></label>';
    var b = document.createElement('button');
    b.className = 'toggle' + (on ? ' on' : '');
    b.textContent = on ? '开' : '关';
    b.addEventListener('click', function () {
      on = !on;
      b.classList.toggle('on', on);
      b.textContent = on ? '开' : '关';
      cb(on);
    });
    row.appendChild(b);
    return row;
  }

  function buildHistory() {
    var wrap = document.createElement('div');
    if (!state.history.length) {
      wrap.textContent = '还没有可回顾的文本。';
      return wrap;
    }
    state.history.slice().reverse().forEach(function (h) {
      var item = document.createElement('div');
      item.className = 'history-item' + (h.w ? ' whatif' : '');
      if (h.s) { var st = document.createElement('strong'); st.textContent = h.s; item.appendChild(st); }
      var p = document.createElement('p');
      p.textContent = h.t;
      item.appendChild(p);
      wrap.appendChild(item);
    });
    return wrap;
  }

  function buildChapters() {
    var wrap = document.createElement('div');
    wrap.className = 'chapter-list';
    S.chapters.forEach(function (ch, i) {
      var b = document.createElement('button');
      b.className = 'chapter-btn';
      var locked = i > state.reached;
      b.disabled = locked;
      b.innerHTML = '<b>' + ch.num + '</b>' +
        '<span><b>' + esc(ch.title) + '</b><small>' + esc(ch.note) + '</small></span>' +
        '<small>' + (locked ? '未解锁' : esc(ch.kicker)) + '</small>';
      if (!locked) b.addEventListener('click', function () {
        closeModal();
        enterChapter(i, true);
        show('gameScreen');
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function buildTimeline() {
    var wrap = document.createElement('div');
    wrap.className = 'timeline';
    S.timeline.forEach(function (t) {
      var it = document.createElement('div');
      it.className = 'timeline-item';
      it.innerHTML = '<time>' + esc(t.time) + '</time><h3>' + esc(t.title) + '</h3><p>' + esc(t.text) + '</p>';
      wrap.appendChild(it);
    });
    return wrap;
  }

  function buildAfterword() {
    var wrap = document.createElement('div');
    wrap.className = 'afterword';
    wrap.textContent = S.afterword;
    return wrap;
  }

  /* ---------- 开始 / 继续 ---------- */

  function beginGame(muted) {
    state = freshState();
    state.settings.muted = muted;
    if (A) { A.init(); A.setVolume(state.settings.volume); A.setMuted(muted); }
    show('gameScreen');
    // 序章第一节点：手动铺一次天气声画
    lastBg = lastWeather = lastMood = null;
    renderNode(false);
  }

  function continueGame() {
    if (A) {
      A.init();
      A.setVolume(state.settings.volume);
      A.setMuted(state.settings.muted);
    }
    lastBg = lastWeather = lastMood = null;
    if (state.finished) { show('endingScreen'); return; }
    show('gameScreen');
    renderNode(false);   // 不重复结算，直接重绘当前节点
  }

  /* ---------- 工具 ---------- */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    el.startSound.addEventListener('click', function () { beginGame(false); });
    el.startMuted.addEventListener('click', function () { beginGame(true); });
    el.continueBtn.addEventListener('click', continueGame);
    el.openWarning.addEventListener('click', function () { show('warningScreen'); });
    el.warningBack.addEventListener('click', function () { show('titleScreen'); });

    el.nextBtn.addEventListener('click', onNext);
    // 点击对话纸面 / 空格 / 回车 推进
    document.getElementById('dialogue-wrap').addEventListener('click', function (e) {
      if (e.target.closest('.choice-btn') || e.target.closest('.next-btn')) return;
      if (el.gameScreen.classList.contains('active')) onNext();
    });
    document.addEventListener('keydown', function (e) {
      if (!el.gameScreen.classList.contains('active')) return;
      if (!el.modal.hidden) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
        e.preventDefault(); onNext();
      }
    });

    el.historyBtn.addEventListener('click', function () { openModal('历史文本', buildHistory()); });
    el.chaptersBtn.addEventListener('click', function () { openModal('章节选择', buildChapters()); });
    el.settingsBtn.addEventListener('click', function () { openModal('设置', buildSettings()); });

    el.timelineBtn.addEventListener('click', function () { openModal('事实年表', buildTimeline()); });
    el.afterwordBtn.addEventListener('click', function () { openModal('原文后记', buildAfterword()); });
    el.restartBtn.addEventListener('click', function () {
      if (confirm('从头再看一遍吗？当前存档会被覆盖。')) { clearSave(); beginGame(state.settings.muted); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close-modal]'), function (n) {
      n.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', function (e) {
      if (el.modal.hidden) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      var focusables = modalFocusables();
      if (!focusables.length) { e.preventDefault(); return; }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // 预加载序章与第一幕关键图，减少首次切换的空窗
    ['16-writing', '01-arrival', '03-newbike', '02-renmin'].forEach(function (k) {
      var i = new Image(); i.src = 'assets/images/' + k + '.webp';
    });
  }

  /* ---------- 启动 ---------- */

  function boot() {
    grab();
    Weather.init();
    bind();
    var saved = loadGame();
    if (saved) {
      state = saved;
      el.continueBtn.hidden = false;
    } else {
      state = freshState();
    }
    show('titleScreen');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();

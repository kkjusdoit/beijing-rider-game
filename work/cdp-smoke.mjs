// 通过 Chrome DevTools Protocol 冒烟测试：加载页面→无异常→静音进入→
// 自动推进（每个选择都走假设支线）→到达结局。仅用 Node 内置能力。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file://' + process.argv[2];
const PORT = 9223;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/brg-cdp-' + Date.now(),
  '--window-size=1280,800', URL
], { stdio: 'ignore' });

let ws, msgId = 0; const pending = new Map(); const errors = [];
function send(method, params) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((res) => pending.set(id, res));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

async function main() {
  // 等 DevTools 端点就绪
  let target = null;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(200);
  }
  if (!target) throw new Error('no CDP page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value).join(' '));
    }
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  // 载入后已经 navigate（URL 作为启动参数）。给它一点时间。
  await sleep(800);

  const checks = {};
  checks.storyLoaded = await evaluate('!!(window.StoryData && window.GameAudio)');
  checks.titleActive = await evaluate("document.getElementById('title-screen').classList.contains('active')");
  checks.nodeCount = await evaluate('Object.keys(window.StoryData.seqs).length');

  // 静音进入
  await evaluate("document.getElementById('start-muted').click()");
  await sleep(200);
  checks.gameActive = await evaluate("document.getElementById('game-screen').classList.contains('active')");
  checks.firstText = await evaluate("document.getElementById('dialogue').textContent.length > 0");

  // 自动推进：每个选择都走第一个（假设支线），直到结局
  let reachedEnd = false, whatifSeen = 0, lastLabel = '', stale = 0;
  for (let i = 0; i < 2000; i++) {
    const step = await evaluate(`(function(){
      if (document.getElementById('ending-screen').classList.contains('active')) return 'END';
      var cbox = document.getElementById('choices');
      var vis = !cbox.hidden && getComputedStyle(cbox).display !== 'none';
      var btns = cbox.querySelectorAll('.choice-btn');
      if (vis && btns.length) { var wi = cbox.querySelector('.choice-btn.whatif') || btns[0]; wi.click(); return 'CHOICE'; }
      document.getElementById('next-btn').click();
      return document.getElementById('progress-label').textContent;
    })()`);
    if (step === 'END') { reachedEnd = true; break; }
    if (step === 'CHOICE') { whatifSeen++; stale = 0; }
    else { if (step === lastLabel) stale++; else { stale = 0; lastLabel = step; } }
    if (stale > 40) { errors.push('stuck at ' + step); break; }
    await sleep(6);
  }
  checks.reachedEnd = reachedEnd;
  checks.whatifSeen = whatifSeen;
  checks.endingTitle = await evaluate("document.getElementById('ending-title').textContent");

  // 结局面板：年表 / 后记 能打开
  await evaluate("document.getElementById('timeline-btn').click()");
  await sleep(120);
  checks.timelineOpens = await evaluate("!document.getElementById('modal').hidden && document.querySelectorAll('.timeline-item').length");
  await evaluate("document.querySelector('[data-close-modal]').click()");

  // 存档：结局态应已写入 localStorage
  checks.saved = await evaluate("!!localStorage.getItem('brg.save.v3')");

  console.log(JSON.stringify({ checks, errors }, null, 2));
  const pass = checks.storyLoaded && checks.titleActive && checks.gameActive &&
    checks.firstText && checks.reachedEnd && checks.whatifSeen >= 4 &&
    checks.timelineOpens && checks.saved && errors.length === 0;
  console.log(pass ? '\nSMOKE TEST: PASS' : '\nSMOKE TEST: FAIL');
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => { console.error('TEST ERROR:', e.message); process.exitCode = 2; })
  .finally(() => { try { ws && ws.close(); } catch {} chrome.kill(); });

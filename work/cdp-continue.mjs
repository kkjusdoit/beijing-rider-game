import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL='file://'+process.argv[2]; const PORT=9224;
const dir='/tmp/brg-cont-'+Date.now();
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,URL],{stdio:'ignore'});
let ws,id=0;const pend=new Map();
const send=(m,p)=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));return new Promise(r=>pend.set(i,r));};
const evl=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,200));return r.result.value;};
async function target(){for(let i=0;i<50;i++){try{const l=await (await fetch(`http://localhost:${PORT}/json`)).json();const t=l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);if(t)return t;}catch{}await sleep(200);}throw new Error('no target');}
async function connect(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result||{});pend.delete(m.id);}};await send('Runtime.enable');await send('Page.enable');}
async function nav(u){await send('Page.navigate',{url:u});await sleep(700);}
(async()=>{
  await connect(await target()); await sleep(600);
  await evl("document.getElementById('start-muted').click()");
  await sleep(150);
  // 推进 20 步
  for(let i=0;i<20;i++){await evl("(function(){var c=document.getElementById('choices');if(!c.hidden&&c.querySelector('.choice-btn')){c.querySelector('.choice-btn:not(.whatif)')?.click();return;}document.getElementById('next-btn').click();})()");await sleep(20);}
  const before=await evl("document.getElementById('progress-label').textContent");
  // 重新加载页面
  await nav(URL); await sleep(500);
  const contShown=await evl("!document.getElementById('continue-btn').hidden");
  await evl("document.getElementById('continue-btn').click()"); await sleep(200);
  const gameActive=await evl("document.getElementById('game-screen').classList.contains('active')");
  const after=await evl("document.getElementById('progress-label').textContent");
  const text=await evl("document.getElementById('dialogue').textContent.length>0");
  const pass = contShown && gameActive && text && after===before;
  console.log(JSON.stringify({before,after,contShown,gameActive,text},null,2));
  console.log(pass?'CONTINUE TEST: PASS':'CONTINUE TEST: FAIL');
  process.exitCode=pass?0:1;
})().catch(e=>{console.error('ERR',e.message);process.exitCode=2;}).finally(()=>{try{ws&&ws.close();}catch{}chrome.kill();});

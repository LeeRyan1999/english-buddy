'use strict';
const $=s=>document.querySelector(s), LS=localStorage;
const cfg=()=>({url:(LS.eb_url||'').replace(/\/+$/,''),code:LS.eb_code||'',mock:LS.eb_mock==='1'||!LS.eb_url});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let DICT=null; const loadDict=async()=>DICT||(DICT=await (await fetch('dict.json')).json());
const vocab=()=>JSON.parse(LS.eb_vocab||'[]'), setVocab=v=>{LS.eb_vocab=JSON.stringify(v);renderCount()};
const queue=()=>JSON.parse(LS.eb_queue||'[]'), setQueue=q=>{LS.eb_queue=JSON.stringify(q);renderCount()};

// ---------- status ----------
function renderStatus(){const s=$('#status'),c=cfg();
  if(!navigator.onLine){s.className='pill off';s.textContent='● 離線';}
  else if(c.mock){s.className='pill mock';s.textContent='● 示範模式';}
  else{s.className='pill';s.textContent='● 已連線';}
  document.querySelectorAll('#tGo,#cGo').forEach(b=>b.disabled=!navigator.onLine&&!c.mock);}
addEventListener('online',()=>{renderStatus();flushQueue()});addEventListener('offline',renderStatus);

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs button,.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.tab).classList.add('on');});
const showTab=t=>document.querySelector(`#tabs [data-tab=${t}]`).click();

// ---------- API ----------
async function api(path,body,method){const c=cfg();
  if(c.mock)return mock(path,body,method);
  if(!navigator.onLine)throw new Error('目前離線，這個功能需要網路');
  if(!c.url)throw new Error('請先到「設定」填後台網址');
  const r=await fetch(c.url+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','X-Access-Code':c.code},body:body&&JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'後台回應錯誤 '+r.status}));if(!r.ok)throw new Error(j.error||r.status);return j;}
async function mock(path,b,method){await new Promise(r=>setTimeout(r,250));
  if(path==='/api/translate'){const m={'我明天想去看電影':'I want to go to the movies tomorrow.','你好':'Hello.','謝謝':'Thank you.'};
    return{english:m[b.text.trim()]||`[示範] English for: ${b.text}`,alt:'(casual) I wanna catch a movie tomorrow.',note:'示範模式回應，接上後台後會用 AI 翻譯。'};}
  if(path==='/api/correct'){let s=b.text;const fx=[[/\bI go\b/g,'I went'],[/\beat apple\b/g,'ate an apple'],[/\bhe go\b/gi,'he goes'],[/\bi\b/g,'I']];
    fx.forEach(([a,c])=>s=s.replace(a,c));return{corrected:s,isCorrect:s===b.text,explanation:s===b.text?'這句沒有問題！':'Yesterday 是過去時間，動詞要用過去式（go→went, eat→ate）；可數名詞 apple 單數前要加 an。（示範模式）'};}
  if(path==='/api/explain'){await loadDict();const d=DICT[b.word.toLowerCase()];return{word:b.word,ipa:d?.[0]||'',pos:(d?.[1]||'').split(' ')[0],definition:d?.[2]||'(mock)',zh:d?.[1]||'（示範）',example:`This is an example with "${b.word}".`,exampleZh:'這是示範例句。'};}
  if(path==='/api/quizcheck'){const ok=b.answer&&(b.meaning||'').split(/[,，；;\/ ]+/).some(x=>x.length>0&&(b.answer.includes(x.replace(/^[a-z]+\.\s*/,''))||x.includes(b.answer)));return{correct:!!ok,feedback:ok?'答對了！👏':`再想想～參考答案：${b.meaning}`};}
  if(path==='/api/vocab'&&method!=='POST'&&!b){const mv=JSON.parse(LS.eb_mockdb||'null')||[{word:'apple',meaning:'蘋果',example:'I eat an apple every day.'},{word:'brave',meaning:'勇敢的',example:'She is very brave.'},{word:'schedule',meaning:'行程；時間表',example:'My schedule is full today.'},{word:'improve',meaning:'改善；進步',example:'I want to improve my English.'}];return{words:mv};}
  if(path==='/api/vocab'){await loadDict();const d=DICT[b.word.toLowerCase()];const w={word:b.word,meaning:b.meaning||d?.[1]||'（待補）',example:b.example||'',added:b.added};
    const mv=(await mock('/api/vocab')).words;mv.push(w);LS.eb_mockdb=JSON.stringify(mv);return{ok:true,...w};}
  throw new Error('mock: unknown');}

// ---------- speech ----------
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
document.querySelectorAll('.mic').forEach(b=>{if(!SR){b.title='這個瀏覽器不支援語音輸入，請用打字';b.disabled=true;return;}
  b.onclick=()=>{const r=new SR();r.lang=b.dataset.lang;r.interimResults=true;const t=$('#'+b.dataset.target);b.classList.add('rec');
    r.onresult=e=>{t.value=[...e.results].map(x=>x[0].transcript).join('');};
    r.onerror=e=>{b.classList.remove('rec');if(e.error==='network')alert('語音辨識需要網路，請改用打字');};
    r.onend=()=>{b.classList.remove('rec');const id=b.dataset.target;if(id==='tIn')$('#tGo').click();if(id==='cIn')$('#cGo').click();};r.start();};});
function say(text,lang='en-US'){if(!window.speechSynthesis)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang;u.rate=.95;
  const v=speechSynthesis.getVoices().find(v=>v.lang===lang);if(v)u.voice=v;speechSynthesis.speak(u);}
const clickable=s=>esc(s).replace(/[A-Za-z][A-Za-z'-]*/g,w=>`<span class="w" data-w="${w}">${w}</span>`);
document.addEventListener('click',e=>{const w=e.target.closest('.w');if(w){$('#dIn').value=w.dataset.w;showTab('dict');lookup();}});
const busy=(el,msg='處理中…')=>{el.classList.remove('hidden');el.innerHTML=`<span class="small">${msg}</span>`};
const fail=(el,e)=>{el.classList.remove('hidden');el.innerHTML=`<span class="err">⚠️ ${esc(e.message)}</span>`};

// ---------- translate (+ Notion command) ----------
const CMD=/加入?(?:到|至)?\s*notion\s*(?:的)?\s*(?:英文)?\s*(?:單字|單詞)?\s*(?:頁面|頁|庫)?\s*[:：]?\s*([A-Za-z][A-Za-z' -]*)$/i;
$('#tGo').onclick=async()=>{const v=$('#tIn').value.trim(),o=$('#tOut');if(!v)return;
  const m=v.match(CMD);if(m){$('#addIn').value=m[1].trim();showTab('quiz');return addWord();}
  busy(o);try{const r=await api('/api/translate',{text:v});
    o.innerHTML=`<div class="en">${clickable(r.english)}</div>${r.alt?`<div class="small">其他說法：${clickable(r.alt)}</div>`:''}${r.note?`<p class="small">${esc(r.note)}</p>`:''}
    <div class="row"><button id="tSay">🔊 朗讀</button></div><div class="small">點英文單字可查意思</div>`;
    $('#tSay').onclick=()=>say(r.english);say(r.english);}catch(e){fail(o,e)}};

// ---------- correct ----------
function diff(a,b){const A=a.split(/\s+/),B=b.split(/\s+/),n=A.length,m=B.length,L=[...Array(n+1)].map(()=>Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  let i=0,j=0,out=[];while(i<n&&j<m){if(A[i]===B[j]){out.push(esc(A[i]));i++;j++}else if(L[i+1][j]>=L[i][j+1])out.push(`<del>${esc(A[i++])}</del>`);else out.push(`<ins>${esc(B[j++])}</ins>`);}
  while(i<n)out.push(`<del>${esc(A[i++])}</del>`);while(j<m)out.push(`<ins>${esc(B[j++])}</ins>`);return out.join(' ');}
$('#cGo').onclick=async()=>{const v=$('#cIn').value.trim(),o=$('#cOut');if(!v)return;busy(o);
  try{const r=await api('/api/correct',{text:v});
    o.innerHTML=r.isCorrect?`<div class="good">✅ 文法正確！</div><div class="en">${clickable(r.corrected)}</div>`:
      `<div class="small">修改標示：</div><div>${diff(v,r.corrected)}</div><div class="small" style="margin-top:8px">正確句子：</div><div class="en">${clickable(r.corrected)}</div>`;
    o.innerHTML+=`<p>${esc(r.explanation)}</p><button id="cSay">🔊 朗讀正確句子</button>`;$('#cSay').onclick=()=>say(r.corrected);}catch(e){fail(o,e)}};

// ---------- dictionary ----------
async function lookup(){const w=$('#dIn').value.trim().toLowerCase(),o=$('#dOut');if(!w)return;busy(o,'查詢中…');await loadDict();
  const d=DICT[w];let html=d?`<div class="big">${esc(w)} <button id="dSay">🔊</button></div><div class="small">/${esc(d[0])}/ · 內建字典</div><p>${esc(d[1])}</p><p class="small">${esc(d[2])}</p>`:`<div class="big">${esc(w)}</div><p class="small">內建字典沒有這個字。</p>`;
  o.innerHTML=html+`<div id="dMore"></div><div class="row"><button id="dAdd">＋加入 Notion 單字庫</button></div>`;
  $('#dAdd').onclick=()=>{$('#addIn').value=w;showTab('quiz');addWord(d?.[1]);};
  const ds=$('#dSay');if(ds)ds.onclick=()=>say(w);
  if(navigator.onLine&&(cfg().url||cfg().mock)){try{const r=await api('/api/explain',{word:w});
    $('#dMore').innerHTML=`<div class="card"><b>${esc(r.word)}</b> ${r.ipa?`<span class="small">${esc(r.ipa)}</span>`:''} <i class="small">${esc(r.pos)}</i>${d?'':' <button id="dSay2">🔊</button>'}
      <p>${esc(r.zh)}</p><p class="small">${esc(r.definition)}</p><p>💬 ${esc(r.example)}<br><span class="small">${esc(r.exampleZh)}</span></p></div>`;
    const s2=$('#dSay2');if(s2)s2.onclick=()=>say(w);}catch(e){$('#dMore').innerHTML=`<p class="small">詳細解釋需連網：${esc(e.message)}</p>`}}
  else $('#dMore').innerHTML='<p class="small">離線中：只顯示內建字典。</p>';}
$('#dGo').onclick=lookup;$('#dIn').onkeydown=e=>{if(e.key==='Enter')lookup()};

// ---------- vocab / quiz ----------
function renderCount(){$('#qCount').textContent=`已快取 ${vocab().length} 個單字`;const q=queue();$('#queueInfo').textContent=q.length?`⏳ ${q.length} 個單字等待上傳到 Notion（連網後自動同步）：${q.map(x=>x.word).join(', ')}`:'';}
async function sync(){const b=$('#qSync');b.disabled=true;try{await flushQueue();const r=await api('/api/vocab');setVocab(r.words);$('#qFb').innerHTML=`<span class="good">已同步 ${r.words.length} 個單字</span>`}catch(e){$('#qFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}（使用快取單字）</span>`}b.disabled=false;}
async function flushQueue(){const q=queue();if(!q.length||!navigator.onLine)return;const left=[];
  for(const it of q){try{await api('/api/vocab',it,'POST')}catch{left.push(it)}}setQueue(left);}
async function addWord(meaning){const w=$('#addIn').value.trim();if(!w)return;const it={word:w,meaning:meaning||'',added:new Date().toISOString().slice(0,10)};
  if(!navigator.onLine){setQueue([...queue(),it]);setVocab([...vocab(),{...it}]);$('#qFb').innerHTML=`<span class="good">離線中，「${esc(w)}」已排隊，連網後上傳</span>`;$('#addIn').value='';return;}
  $('#qFb').textContent='加入中…';try{const r=await api('/api/vocab',it,'POST');setVocab([...vocab(),{word:r.word,meaning:r.meaning,example:r.example,added:it.added}]);
    $('#qFb').innerHTML=`<span class="good">✅ 已加入 Notion：${esc(r.word)}${r.meaning?' — '+esc(r.meaning):''}</span>`;$('#addIn').value='';}
  catch(e){setQueue([...queue(),it]);$('#qFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}，已先排隊稍後重試</span>`}}
$('#qSync').onclick=sync;$('#addGo').onclick=()=>addWord();
let cur=null;
$('#qNext').onclick=()=>{const v=vocab();if(!v.length){$('#qFb').textContent='還沒有單字，先按「同步單字」或新增';return;}
  cur=v[Math.floor(Math.random()*v.length)];$('#qWord').textContent=cur.word;$('#qAns').value='';$('#qFb').textContent='What does it mean? 用中文或英文回答';say(cur.word);};
$('#qSay').onclick=()=>cur&&say(cur.word);
$('#qCheck').onclick=async()=>{if(!cur)return $('#qNext').click();const a=$('#qAns').value.trim();if(!a)return;
  const local=()=>{const keys=(cur.meaning||'').replace(/[a-z]+\.\s*/g,'').split(/[,，；;、\/\s]+/).filter(x=>x.length);const ok=keys.some(k=>a.includes(k)||k.includes(a));
    return{correct:ok,feedback:ok?'答對了！👏':'不太對喔'}};
  let r;if(navigator.onLine&&(cfg().url||cfg().mock)){try{r=await api('/api/quizcheck',{word:cur.word,meaning:cur.meaning,answer:a})}catch{r=local()}}else r=local();
  $('#qFb').innerHTML=`<div class="${r.correct?'good':'bad'}">${r.correct?'✅':'❌'} ${esc(r.feedback)}</div><p class="small">參考：${esc(cur.meaning)}${cur.example?'<br>💬 '+esc(cur.example):''}</p>`;};
$('#qAns').onkeydown=e=>{if(e.key==='Enter')$('#qCheck').click()};

// ---------- settings ----------
$('#sUrl').value=LS.eb_url||'';$('#sCode').value=LS.eb_code||'';$('#sMock').checked=cfg().mock;
$('#sSave').onclick=()=>{LS.eb_url=$('#sUrl').value.trim();LS.eb_code=$('#sCode').value.trim();LS.eb_mock=$('#sMock').checked?'1':'0';renderStatus();$('#sOut').textContent='已儲存';};
$('#sTest').onclick=async()=>{$('#sSave').click();const c=cfg();if(c.mock)return $('#sOut').textContent='示範模式不需要連線';
  try{const h=await (await fetch(c.url+'/health')).json();await api('/api/vocab');$('#sOut').innerHTML=`<span class="good">✅ 連線成功（AI：${esc(h.ai||'未設定')}，Notion：${h.notion?'已設定':'未設定'}）</span>`}
  catch(e){$('#sOut').innerHTML=`<span class="err">⚠️ ${esc(e.message)}（免費後台閒置後第一次要等約 1 分鐘喚醒）</span>`}};

renderStatus();renderCount();if(!LS.eb_vocab&&cfg().mock)sync();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

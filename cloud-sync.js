/* Cloud sync UI: GitHub Pages -> Cloudflare Worker -> Dropbox. No Dropbox secrets in browser. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const els={url:$('cloudUrl'),code:$('cloudCode'),name:$('cloudName'),role:$('cloudRole'),connect:$('cloudConnect'),save:$('cloudSave'),reload:$('cloudReload'),users:$('cloudUsers'),status:$('cloudStatus'),all:$('cloudAll'),peer:$('cloudPeer'),table:$('cloudAllTable'),csv:$('cloudAllCSV'),html:$('cloudAllHTML')};
const KEY_URL='learningMapCloudUrl', KEY_USER='learningMapActiveProfile', KEY_PASS='learningMapCloudCode', KEY_CACHE='learningMapCloudUser_';
let base='',pass='',active=null,rev=null,dirty=false,saving=false,ready=false,peers=[],allRows=[],saveTimer=null;
function message(s,bad=false){els.status.textContent=s;els.status.dataset.error=String(bad)}
function escHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cleanURL(x){try{let u=new URL(x.trim());if(u.protocol!=='https:'||!u.hostname.endsWith('.workers.dev')||u.username||u.password||u.search||u.hash)return null;return u.origin;}catch{return null}}
async function userID(name,role){let raw=new TextEncoder().encode(role+'|'+name.normalize('NFC'));let d=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));return 'u-'+Array.from(d).slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('')}
function cached(id){try{return JSON.parse(localStorage.getItem(KEY_CACHE+id)||'null')}catch{return null}}
function cache(){if(!active)return;localStorage.setItem(KEY_CACHE+active.id,JSON.stringify({rev,dirty,records,updatedAt:new Date().toISOString(),user:active}));}
function setRecords(data){records=data&&typeof data==='object'&&!Array.isArray(data)?structuredClone(data):{};save();renderList();detail();graph();}
async function request(endpoint,method='GET',body){if(!base||!pass)throw Error('API URLとアクセスコードが必要です');const r=await fetch(base+endpoint,{method,headers:{'X-Map-Access-Code':pass,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let obj;try{obj=await r.json()}catch{throw Error('サーバーがJSONを返しませんでした（'+r.status+'）')}if(!r.ok)throw Object.assign(new Error(obj.error||('HTTP '+r.status)),{status:r.status,details:obj.details});return obj;}
function assertLocalStorage(){try{localStorage.setItem('mapStorageTest','1');localStorage.removeItem('mapStorageTest');return true}catch{return false}}
async function connect(){if(!assertLocalStorage()){message('このブラウザーではローカル保存ができません。Safari等の通常モードで開いてください。',true);return;}
 const u=cleanURL(els.url.value);if(!u){message('Cloudflare Workerのhttps://...workers.dev URLを入力してください。',true);return;}const name=els.name.value.trim(),role=els.role.value,code=els.code.value.trim();if(!name||name.length>60){message('利用者名は1～60文字で入力してください。',true);return}if(!code){message('共通アクセスコードを入力してください。',true);return}
 base=u;pass=code;message('Dropbox上の記録を読み込み中…');els.connect.disabled=true;
 try{
  const health=await request('/health');if(!health.configured)throw Error('WorkerのDropbox接続設定が未完了です');
  const id=await userID(name,role),user={id,name,role};const prior=active;
  if(prior&&prior.id!==id&&dirty&&!confirm('現在の利用者の未同期記録が残っています。利用者を切り替えますか？（現在の記録は端末に残ります）'))return;
  if(prior&&prior.id!==id)cache();
  const local=cached(id);let remote=null;try{remote=await request('/records/'+id)}catch(e){if(e.status!==404)throw e}
  // Preserve any old, unscoped data before switching to a cloud profile.
  if(!localStorage.getItem('learningMapOriginalLocalBackup'))localStorage.setItem('learningMapOriginalLocalBackup',JSON.stringify(records));
  active=user;localStorage.setItem(KEY_USER,JSON.stringify(user));localStorage.setItem(KEY_URL,u);sessionStorage.setItem(KEY_PASS,code);
  if(remote){
   if(local?.dirty && local.rev!==remote.rev){rev=local.rev||null;dirty=true;setRecords(local.records);cache();message('⚠ 競合：この端末の未同期記録とDropboxの記録が異なります。JSONを保存してから調整してください。自動上書きは停止しています。',true);}
   else if(local?.dirty){rev=remote.rev;dirty=true;setRecords(local.records);cache();message('未同期記録を確認しました。Dropboxへの保存を試みます。');await upload();}
   else{rev=remote.rev;dirty=false;setRecords(remote.profile.records);cache();message('接続済：'+name+'（'+role+'）の記録をDropboxから読み込みました。');}
  }else{
   rev=null;
   if(local){dirty=!!local.dirty;setRecords(local.records)}else{
    const legacy=prior?null:JSON.parse(localStorage.getItem('learningMapOriginalLocalBackup')||'{}');
    const count=legacy?Object.keys(legacy).length:0;
    let inherit=count>0&&confirm('これまでの端末内の記録（'+count+'件）を「'+name+'」の初回データとして引き継ぎますか？\n「キャンセル」を選ぶと新規の空の記録を作成します。');
    dirty=true;setRecords(inherit?legacy:{});
   }
   cache();await upload();
  }
  ready=true;renderActive();await loadUsers();
 }catch(e){message('接続失敗：'+e.message+(e.status===401?'（アクセスコードを確認）':''),true);ready=false;}
 finally{els.connect.disabled=false}
}
function renderActive(){if(!active)return;els.name.value=active.name;els.role.value=active.role;els.save.disabled=false;els.reload.disabled=false;els.users.disabled=false;els.all.disabled=false;els.csv.disabled=false;els.html.disabled=false;}
function onRecordSave(){if(!ready||!active)return;dirty=true;cache();message('端末に保存済・Dropboxへ送信中…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>upload(),900);}
async function upload(){if(!active||saving||!dirty)return;saving=true;els.save.disabled=true;
 try{let payload={format:'learning-map-profile-v2',user:active,updatedAt:new Date().toISOString(),records};const r=await request('/records/'+active.id,'PUT',{profile:payload,rev});rev=r.rev;dirty=false;cache();message('Dropbox保存完了：'+active.name+'（'+new Date().toLocaleString('ja-JP')+'）。');await loadUsers();}
 catch(e){dirty=true;cache();if(e.status===409)message('⚠ 競合：別の端末が先に更新しました。この端末のJSONをバックアップしてから「Dropboxから読み直す」で確認してください。上書きしていません。',true);else message('⚠ 未同期：端末には保存されていますがDropboxへの送信に失敗しました（'+e.message+'）。後で再保存できます。',true)}
 finally{saving=false;els.save.disabled=false}
}
async function manualSave(){if(!active){message('最初に利用者を接続してください。',true);return;}dirty=true;cache();await upload()}
async function reloadRemote(){if(!active)return;if(dirty&&!confirm('この端末の未同期記録を破棄し、Dropbox上の最新版を読み込みますか？\n必要なら先にJSONを書き出してください。'))return;
 try{let r=await request('/records/'+active.id);rev=r.rev;dirty=false;setRecords(r.profile.records);cache();message('Dropbox最新版を読み込みました。');await loadUsers();}catch(e){message('読み込み失敗：'+e.message,true)}
}
async function loadUsers(){if(!active)return;try{const r=await request('/users');peers=(r.users||[]).filter(x=>!x.invalid);const html=['<option value="">利用者を選択（閲覧用）</option>',...peers.map(x=>`<option value="${escHtml(x.id)}">${escHtml(x.name)}［${escHtml(x.role)}］</option>`)];els.peer.innerHTML=html.join('');els.peer.onchange=()=>showPeer(els.peer.value);return peers;}catch(e){message('利用者一覧の取得に失敗：'+e.message,true);return []}}
async function showPeer(id){if(!id)return;try{let r=await request('/records/'+id),u=r.profile.user;let rows=Object.entries(r.profile.records||{}).filter(([k,v])=>v?.status&&v.status!=='未判定').map(([k,v])=>{let n=BY[k];return n?`<tr><td>${escHtml(u.name)}</td><td>${escHtml(n.subject)} ${escHtml(n.grade)}</td><td>${escHtml(n.title)}</td><td>${escHtml(v.status)}</td><td>${escHtml(v.memo||'')}</td></tr>`:''}).join('');els.table.innerHTML=`<p>${escHtml(u.name)}（${escHtml(u.role)}）・判定記録一覧／${Object.keys(r.profile.records||{}).length}項目</p><div class="cloud-table-scroll"><table><thead><tr><th>氏名</th><th>教科</th><th>単元</th><th>判定</th><th>メモ</th></tr></thead><tbody>${rows||'<tr><td colspan="5">判定済みなし</td></tr>'}</tbody></table></div>`;message('「'+u.name+'」の記録を閲覧中です。ご自身の記録は変更されません。');}catch(e){message('他の利用者の取得に失敗：'+e.message,true)}}
async function showAll(){try{message('全員の記録を集計しています…');const users=await loadUsers();if(!users)return;const items=await Promise.all(users.map(async u=>{try{return (await request('/records/'+u.id)).profile}catch{return null}}));allRows=[];
  for(const profile of items){if(!profile)continue;for(const [id,v] of Object.entries(profile.records||{})){const n=BY[id];if(!n||(!v.status||v.status==='未判定')&&(!v.memo||!v.date))continue;allRows.push({name:profile.user.name,role:profile.user.role,id,subject:n.subject,grade:n.grade,title:n.title,status:v.status||'未判定',one:v.one||'',two:v.two||'',lang:v.lang||'',date:v.date||'',memo:v.memo||''})}}
  allRows.sort((a,b)=>a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));let t=allRows.map(x=>`<tr><td>${escHtml(x.name)}</td><td>${escHtml(x.subject)} ${escHtml(x.grade)}</td><td>${escHtml(x.title)}</td><td>${escHtml(x.status)}</td><td>${escHtml(x.memo)}</td></tr>`).join('');els.table.innerHTML=`<p>全員の記録：${users.length}人／${allRows.length}件（未判定・未記入は省略）</p><div class="cloud-table-scroll"><table><thead><tr><th>氏名</th><th>教科</th><th>単元</th><th>判定</th><th>メモ</th></tr></thead><tbody>${t||'<tr><td colspan="5">記録なし</td></tr>'}</tbody></table></div>`;message('全員の記録を取得しました。CSV・HTMLから保存できます。');
 }catch(e){message('全員の記録取得失敗：'+e.message,true)}}
function exportAll(type){if(!allRows.length){message('先に「全員の記録一覧」を表示してください。',true);return;}const cols=['name','role','id','subject','grade','title','status','one','two','lang','date','memo'];let text,contentType;
 if(type==='csv'){text='\ufeff'+[cols, ...allRows.map(x=>cols.map(k=>x[k]||''))].map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');contentType='text/csv;charset=utf-8';}
 else {const body=allRows.map(x=>'<tr>'+cols.map(c=>'<td>'+escHtml(x[c])+'</td>').join('')+'</tr>').join('');text='<!doctype html><html lang="ja"><meta charset="utf-8"><title>学力診断：利用者別結果</title><style>body{font:14px sans-serif;margin:22px}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:6px;vertical-align:top}th{background:#eef}</style><h1>利用者別・学力診断記録</h1><table><thead><tr>'+cols.map(x=>'<th>'+escHtml(x)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></html>';contentType='text/html;charset=utf-8';}
 const url=URL.createObjectURL(new Blob([text],{type:contentType}));const a=document.createElement('a');a.href=url;a.download='学力診断_全利用者記録.'+type;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)
}
els.url.value=localStorage.getItem(KEY_URL)||'';try{const u=JSON.parse(localStorage.getItem(KEY_USER)||'null');if(u){els.name.value=u.name;els.role.value=u.role;}}catch{}els.code.value=sessionStorage.getItem(KEY_PASS)||'';
els.connect.onclick=connect;els.save.onclick=manualSave;els.reload.onclick=reloadRemote;els.users.onclick=loadUsers;els.all.onclick=showAll;els.csv.onclick=()=>exportAll('csv');els.html.onclick=()=>exportAll('html');
window.CloudSync={onRecordSave,renderPeers:()=>{}};
if(els.url.value&&els.code.value&&els.name.value) {connect();}
})();

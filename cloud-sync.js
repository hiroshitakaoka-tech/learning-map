/* Public UI contains no Dropbox credential. The shared code is not individual authentication. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const els={url:$('cloudUrl'),code:$('cloudCode'),name:$('cloudName'),role:$('cloudRole'),id:$('cloudId'),own:$('cloudOwn'),fresh:$('cloudNew'),connect:$('cloudConnect'),save:$('cloudSave'),reload:$('cloudReload'),users:$('cloudUsers'),status:$('cloudStatus'),all:$('cloudAll'),peer:$('cloudPeer'),table:$('cloudAllTable'),csv:$('cloudAllCSV'),html:$('cloudAllHTML'),json:$('cloudAllJSON')};
const KEY_URL='learningMapCloudUrl',KEY_USER='learningMapActiveProfile',KEY_PASS='learningMapCloudCode',KEY_CACHE='learningMapCloudUser_';
let base='',pass='',active=null,rev=null,dirty=false,saving=false,connecting=false,ready=false,conflict=false,version=0,peers=[],allRows=[],allProfiles=[],saveTimer;
function message(s,bad=false){els.status.textContent=s;els.status.dataset.error=String(bad)}
function escape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cleanURL(x){try{const u=new URL(x.trim());return u.protocol==='https:'&&u.hostname.endsWith('.workers.dev')&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:null}catch{return null}}
function randomID(){return 'u-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),x=>x.toString(16).padStart(2,'0')).join('')}
function cached(id){try{return JSON.parse(localStorage.getItem(KEY_CACHE+id)||'null')}catch{return null}}
function cache(){if(!active)return;try{localStorage.setItem(KEY_CACHE+active.id,JSON.stringify({rev,dirty,records,user:active}));return true}catch{message('⚠ 端末保存に失敗しました。今すぐJSONを書き出してください。',true);return false}}
function setRecords(data){records=structuredClone(data);save();renderList();detail();graph()}
function renderActive(){const busy=saving||connecting;els.connect.disabled=busy;els.fresh.disabled=busy;els.own.disabled=busy;els.id.disabled=busy;els.save.disabled=!active||busy;els.reload.disabled=!ready||busy;els.all.disabled=!ready;els.csv.disabled=!ready;els.html.disabled=!ready;els.json.disabled=!ready}
function connection(){const u=cleanURL(els.url.value),p=els.code.value.trim();if(!u)throw Error('接続API URLを確認してください');if(!p)throw Error('共通アクセスコードを入力してください');return {base:u,pass:p}}
async function request(endpoint,method='GET',body,credentials={base,pass}){
 if(!credentials.base||!credentials.pass)throw Error('先にDropboxに接続してください');
 const r=await fetch(credentials.base+endpoint,{method,headers:{'X-Map-Access-Code':credentials.pass,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 let obj;try{obj=await r.json()}catch{throw Error('サーバー応答を確認できません（'+r.status+'）')}
 if(!r.ok)throw Object.assign(Error(obj.error||('HTTP '+r.status)),{status:r.status});return obj;
}
function validRemote(r,id){return r?.profile?.format==='learning-map-profile-v2'&&r.profile.user?.id===id&&r.profile.records&&typeof r.profile.records==='object'&&!Array.isArray(r.profile.records)&&typeof r.rev==='string'}
async function connect(){
 if(saving||connecting)return;
 let credentials,name,role,id;
 try{credentials=connection();name=els.name.value.trim().normalize('NFC');role=els.role.value;id=els.id.value.trim();
  if(!name||name.length>60)throw Error('氏名は1～60文字で入力してください');
  if(id&&!/^u-[0-9a-f]{24}$/.test(id))throw Error('利用者IDを確認してください');
  localStorage.setItem('mapStorageTest','1');localStorage.removeItem('mapStorageTest');
 }catch(e){message(e.message,true);return}
 id=id||randomID();const prior=active;
 if(prior&&prior.id!==id&&dirty&&!confirm('未同期記録はこの端末に保管したまま、利用者を切り替えますか？'))return;
 if(prior&&!cache())return;
 const startVersion=version;connecting=true;clearTimeout(saveTimer);renderActive();message('Dropboxの記録を確認中…');
 try{
  const health=await request('/health','GET',undefined,credentials);if(!health.configured)throw Error('管理者のDropbox接続設定が未完了です');
  let remote=null;try{remote=await request('/records/'+id,'GET',undefined,credentials)}catch(e){if(e.status!==404)throw e}
  if(remote&&!validRemote(remote,id))throw Error('保存データの形式を確認できません');
  if(version!==startVersion)throw Error('読み込み中に編集されました。保存後に再接続してください');
  if(!localStorage.getItem('learningMapOriginalLocalBackup'))localStorage.setItem('learningMapOriginalLocalBackup',JSON.stringify(records));
  const local=cached(id);let nextRecords,nextDirty,nextRev;
  if(remote){
   // Existing profile identity comes from Dropbox, never from a newly typed name.
   active=remote.profile.user;nextRev=local?.dirty?local.rev:remote.rev;
   nextRecords=local?.dirty?local.records:remote.profile.records;nextDirty=!!local?.dirty;
   conflict=nextDirty&&local.rev!==remote.rev;
  }else{
   active={id,name,role};nextRev=local?.rev||null;conflict=!!nextRev;
   const legacy=!prior?JSON.parse(localStorage.getItem('learningMapOriginalLocalBackup')||'{}'):{};
   const count=Object.keys(legacy).length;
   nextRecords=local?.records||(count&&confirm('従来の端末内記録'+count+'件をこの新しい利用者へ引き継ぎますか？')?legacy:{});nextDirty=true;
  }
  base=credentials.base;pass=credentials.pass;rev=nextRev;dirty=nextDirty;version++;
  localStorage.setItem(KEY_USER,JSON.stringify(active));localStorage.setItem(KEY_URL,base);sessionStorage.setItem(KEY_PASS,pass);
  setRecords(nextRecords);cache();ready=true;els.id.value=id;els.name.value=active.name;els.role.value=active.role;
  if(conflict)message('⚠ 競合：端末の未同期JSONを保存してからDropboxを読み直してください。上書きは停止中です。',true);
  else if(dirty)await upload();else message('接続済：'+active.name+'のDropbox記録を読み込みました。');
  await loadUsers(false).catch(()=>{});
 }catch(e){message('接続失敗：'+e.message+'。端末内の記録は保持しています。',true)}
 finally{connecting=false;renderActive()}
}
function onRecordSave(){
 version++;if(!active)return;dirty=true;cache();clearTimeout(saveTimer);
 if(!ready){message('⚠ 未同期：端末保存済みです。Dropboxに接続すると再送できます。',true);return}
 if(conflict){message('⚠ 競合中：JSONを保存してからDropboxを読み直してください。',true);return}
 message('端末保存済み・Dropboxへの送信待ち…');saveTimer=setTimeout(upload,900);
}
async function upload(){
 if(!active||saving||!dirty||conflict||!ready)return;
 saving=true;renderActive();const sentVersion=version,sentUser={...active},sentRecords=structuredClone(records),sentRev=rev;
 try{
  const profile={format:'learning-map-profile-v2',user:sentUser,updatedAt:new Date().toISOString(),records:sentRecords};
  const r=await request('/records/'+sentUser.id,'PUT',{profile,rev:sentRev});rev=r.rev;
  dirty=version!==sentVersion;cache();
  message(dirty?'端末の追加編集を送信待ち…':'Dropbox保存完了：'+active.name+'（'+new Date().toLocaleString('ja-JP')+'）。');
  if(!dirty)await loadUsers(false).catch(()=>{});
 }catch(e){dirty=true;conflict=e.status===409;cache();message(conflict?'⚠ 競合：別端末が更新しました。未同期JSONを保存してから「Dropboxから読み直す」を選んでください。上書きしていません。':'⚠ 未同期：送信に失敗しました（'+e.message+'）。端末の記録を保持しています。オンライン復帰時に再送します。',true)}
 finally{saving=false;renderActive();if(dirty&&!conflict&&version!==sentVersion){clearTimeout(saveTimer);saveTimer=setTimeout(upload,300)}}
}
async function manualSave(){if(!ready){await connect();return}if(saving)return;dirty=true;cache();await upload()}
async function reloadRemote(){
 if(!active||saving||connecting)return;
 if(dirty&&!confirm('未同期の内容をDropboxの最新版で置き換えますか？必要ならキャンセルしてJSONを書き出してください。'))return;
 const startVersion=version;connecting=true;renderActive();
 try{const r=await request('/records/'+active.id);if(!validRemote(r,active.id))throw Error('保存形式が不正です');if(version!==startVersion)throw Error('読み込み中に編集されました。再度読み込んでください');
  // Preserve a recovery snapshot even when the user elects to discard local edits.
  if(dirty)localStorage.setItem(KEY_CACHE+active.id+'_beforeReload',JSON.stringify({user:active,rev,records}));
  active=r.profile.user;rev=r.rev;dirty=false;conflict=false;version++;setRecords(r.profile.records);cache();message('Dropbox最新版を読み込みました。');await loadUsers(false).catch(()=>{})
 }catch(e){message('読み込み失敗：'+e.message,true)}finally{connecting=false;renderActive()}
}
function options(first){return '<option value="">'+first+'</option>'+peers.map(u=>`<option value="${escape(u.id)}">${escape(u.name)}［${escape(u.role)}］ ${escape(u.id.slice(-6))}</option>`).join('')}
async function loadUsers(notify=true){
 try{const credentials=ready?{base,pass}:connection(),found=[];let offset=null;
  do{const r=await request('/users'+(offset===null?'':'?offset='+offset),'GET',undefined,credentials);found.push(...(r.users||[]));offset=r.nextOffset??null}while(offset!==null);peers=found;
  els.own.innerHTML=options('別端末の利用者を選択');els.own.value=active?.id||'';els.peer.innerHTML=options('利用者を選択（閲覧用）');if(notify)message('利用者一覧を更新しました。');return peers
 }catch(e){if(notify)message('一覧を取得できません：'+e.message,true);throw e}
}
els.own.onchange=()=>{const u=peers.find(x=>x.id===els.own.value);if(u){els.id.value=u.id;els.name.value=u.name;els.role.value=u.role;message('「'+u.name+'」を選択しました。接続ボタンで読み込みます。')}};
els.fresh.onclick=()=>{els.id.value='';els.name.value='';els.own.value='';message('新しい利用者の氏名・立場を入力して接続してください。同姓同名でも別IDを作成します。')};
function profileRows(profile){return Object.entries(profile.records).flatMap(([id,v])=>{const n=BY[id];return n&&(v.status&&v.status!=='未判定'||v.memo||v.date)?[{name:profile.user.name,role:profile.user.role,userId:profile.user.id,id,subject:n.subject,grade:n.grade,title:n.title,status:v.status||'未判定',one:v.one||'',two:v.two||'',lang:v.lang||'',date:v.date||'',memo:v.memo||''}]:[]})}
function table(rows,label){els.table.innerHTML='<p>'+escape(label)+'</p><div class="cloud-table-scroll"><table><thead><tr><th>氏名</th><th>教科・学年</th><th>単元</th><th>判定</th><th>メモ</th></tr></thead><tbody>'+(rows.map(x=>'<tr>'+[x.name,x.subject+' '+x.grade,x.title,x.status,x.memo].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="5">記録なし</td></tr>')+'</tbody></table></div>'}
async function showPeer(id){if(!id)return;try{const r=await request('/records/'+id);table(profileRows(r.profile),r.profile.user.name+'の記録（閲覧）');message('閲覧中です。編集中の記録は変更しません。')}catch(e){message('閲覧失敗：'+e.message,true)}}
async function showAll(){
 try{message('全員の記録を取得中…');const users=await loadUsers(false);const profiles=[];
  for(let i=0;i<users.length;i+=4){const batch=await Promise.all(users.slice(i,i+4).map(async u=>(await request('/records/'+u.id)).profile));profiles.push(...batch)}
  allProfiles=profiles;allRows=profiles.flatMap(profileRows).sort((a,b)=>a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));
  table(allRows,'全員の記録：'+users.length+'人／'+allRows.length+'件');message('全員の記録を取得しました。CSV・HTML・JSONを保存できます。')
 }catch(e){allRows=[];allProfiles=[];message('一覧取得失敗：'+e.message+'。不完全な一覧は出力しません。',true)}
}
function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function exportAll(type){
 if(!allProfiles.length){message('先に「全員の記録一覧」を表示してください。',true);return}
 const cols=['name','role','userId','id','subject','grade','title','status','one','two','lang','date','memo'];let text,mime;
 if(type==='json'){text=JSON.stringify({format:'learning-map-profiles-v2',created:new Date().toISOString(),profiles:allProfiles},null,2);mime='application/json'}
 else if(type==='csv'){const safe=x=>/^[=+\-@\t\r\n]/.test(String(x))?"'"+x:String(x);text='\ufeff'+[cols,...allRows.map(x=>cols.map(k=>safe(x[k]||'')))].map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');mime='text/csv;charset=utf-8'}
 else{text='<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>学力診断記録一覧</title><style>body{font:14px sans-serif;margin:20px}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:6px;white-space:pre-wrap}</style><h1>利用者別・学力診断記録</h1><table><thead><tr>'+cols.map(c=>'<th>'+escape(c)+'</th>').join('')+'</tr></thead><tbody>'+allRows.map(x=>'<tr>'+cols.map(c=>'<td>'+escape(x[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table></html>';mime='text/html;charset=utf-8'}
 download(text,mime,'学力診断_全利用者記録.'+type);
}
els.url.value=localStorage.getItem(KEY_URL)||window.LEARNING_MAP_API_URL||'';
try{const u=JSON.parse(localStorage.getItem(KEY_USER)||'null');if(u){active=u;els.id.value=u.id;els.name.value=u.name;els.role.value=u.role;const local=cached(u.id);rev=local?.rev||null;dirty=!!local?.dirty;if(local&&JSON.stringify(local.records)!==JSON.stringify(records))dirty=true;if(dirty)cache()}}catch{}
els.code.value=sessionStorage.getItem(KEY_PASS)||'';
els.connect.onclick=connect;els.save.onclick=manualSave;els.reload.onclick=reloadRemote;els.users.onclick=()=>loadUsers().catch(()=>{});els.all.onclick=showAll;els.peer.onchange=()=>showPeer(els.peer.value);els.csv.onclick=()=>exportAll('csv');els.html.onclick=()=>exportAll('html');els.json.onclick=()=>exportAll('json');
window.CloudSync={onRecordSave};
window.addEventListener('online',()=>{if(ready&&!conflict)upload()});
window.addEventListener('offline',()=>{if(active)message('オフラインです。変更は端末に保存し、接続復帰時に再送します。',true)});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
renderActive();if(els.url.value&&els.code.value&&els.name.value&&els.id.value)connect();
})();

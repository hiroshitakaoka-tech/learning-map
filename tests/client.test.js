import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../cloud-sync.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function harness(){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',dataset:{},disabled:false,innerHTML:''}]));
 const storage=new Map(),session=new Map(),events={},timers=[],files=[];let remote=null,revision=0,hold=null,failed=false,forceConflict=false;
 const c={console,crypto,TextEncoder,URL:Object.assign(class extends URL {},{createObjectURL:b=>{files.push(b);return 'blob:test'},revokeObjectURL:()=>{}}),Blob,AbortSignal,structuredClone,confirm:()=>true,records:{},BY:{M611:{subject:'算数',grade:'小6',title:'割合'}},save(){},renderList(){},detail(){},graph(){},setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)},document:{getElementById:id=>elements.get(id),createElement:()=>({click(){}})},fetch:async(url,options)=>{
  if(failed)throw Error('offline');const path=new URL(url).pathname;
  if(path==='/health')return Response.json({configured:true});
  if(path==='/users')return Response.json({users:remote?[remote.user]:[]});
  if(options.method==='PUT'){
   const p=JSON.parse(options.body);if(hold)await hold;
   if(forceConflict||remote&&p.rev!==String(revision).padStart(16,'0'))return Response.json({error:'VERSION_CONFLICT'},{status:409});
   remote=p.profile;return Response.json({rev:String(++revision).padStart(16,'0')});
  }
  return remote?Response.json({profile:remote,rev:String(revision).padStart(16,'0')}):Response.json({error:'NOT_FOUND'},{status:404});
 }};
 c.window={addEventListener:(name,f)=>events[name]=f};vm.createContext(c);vm.runInContext(source,c);
 const el=id=>elements.get(id);
 el('cloudUrl').value='https://example.workers.dev';el('cloudCode').value='fixture-code';el('cloudName').value='同姓同名';el('cloudRole').value='保護者';
 return {c,el,files,storage,events,timers,get remote(){return remote},set hold(x){hold=x},set failed(x){failed=x},set conflict(x){forceConflict=x},connect:()=>el('cloudConnect').onclick(),edit:m=>{c.records.M611={status:'要補習',memo:m};c.window.CloudSync.onRecordSave()},save:()=>el('cloudSave').onclick(),tick:async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))}};
}
test('same display name creates separate IDs and preserves legacy records',async()=>{
 const a=harness(),b=harness();a.c.records={M611:{memo:'既存の端末内記録'}};await a.connect();await b.connect();assert.notEqual(a.remote.user.id,b.remote.user.id);assert.equal(a.remote.records.M611.memo,'既存の端末内記録');assert.equal(JSON.parse(a.storage.get('learningMapOriginalLocalBackup')).M611.memo,'既存の端末内記録');
});
test('edits made during a pending save remain dirty and are resent',async()=>{
 const h=harness();await h.connect();h.edit('最初の編集');let release;h.hold=new Promise(r=>release=r);const pending=h.save();await h.tick();h.edit('保存中の追加編集');release();await pending;
 assert.match(h.el('cloudStatus').textContent,/送信待ち/);const cache=JSON.parse(h.storage.get('learningMapCloudUser_'+h.remote.user.id));assert.equal(cache.dirty,true);assert.equal(cache.records.M611.memo,'保存中の追加編集');
 h.hold=null;await h.save();assert.equal(h.remote.records.M611.memo,'保存中の追加編集');assert.match(h.el('cloudStatus').textContent,/保存完了/);
});
test('offline edits retain local JSON and retry when online',async()=>{
 const h=harness();await h.connect();h.failed=true;h.edit('オフライン変更');await h.save();assert.match(h.el('cloudStatus').textContent,/未同期/);h.failed=false;h.events.online();await h.tick();assert.equal(h.remote.records.M611.memo,'オフライン変更');
});
test('409 preserves pending edits and does not overwrite remote',async()=>{
 const h=harness();await h.connect();h.conflict=true;h.edit('未同期データ');await h.save();assert.match(h.el('cloudStatus').textContent,/競合/);assert.equal(h.c.records.M611.memo,'未同期データ');assert.equal(h.remote.records.M611,undefined);assert.equal(JSON.parse(h.storage.get('learningMapCloudUser_'+h.remote.user.id)).dirty,true);
});
test('exports contain all profiles, neutralize spreadsheet formulas and escape HTML',async()=>{
 const h=harness();await h.connect();h.edit('=1+1<script>');await h.save();await h.el('cloudAll').onclick();h.el('cloudAllCSV').onclick();h.el('cloudAllHTML').onclick();h.el('cloudAllJSON').onclick();assert.match(await h.files[0].text(),/\x27=1\+1/);assert.match(await h.files[1].text(),/&lt;script&gt;/);const json=JSON.parse(await h.files[2].text());assert.equal(json.profiles[0].records.M611.memo,'=1+1<script>');
});
test('all 274 bilingual nodes, graph edges and legacy JSON import are present',()=>{
 const model=JSON.parse(html.match(/const MODEL=(.*);\nconst N=/)[1]);assert.equal(model.nodes.length,274);assert.ok(model.nodes.every(n=>n.question&&n.idn));const ids=new Set(model.nodes.map(n=>n.id));assert.ok(model.edges.every(e=>ids.has(e.from)&&ids.has(e.to)));assert.ok(html.includes("data.format!=='learning-map-results-v1'"));assert.ok(html.includes('records=valid;save();if(window.CloudSync)window.CloudSync.onRecordSave()'));
});

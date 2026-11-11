import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{apiArg,PREFIX} from '../worker/worker.js';
const origin='https://hiroshitakaoka-tech.github.io',id='u-0123456789abcdef01234567';
const env={DROPBOX_APP_KEY:'fixture-key',DROPBOX_REFRESH_TOKEN:'fixture-refresh',MAP_ACCESS_CODE:'fixture-code'};
const profile=()=>({format:'learning-map-profile-v2',user:{id,name:'架空のテスト利用者',role:'保護者'},updatedAt:new Date().toISOString(),records:{M611:{status:'要補習',memo:'日本語・Bahasa Indonesia'}}});
const req=(path,method='GET',body,extra={})=>new Request('https://example.workers.dev'+path,{method,headers:{Origin:origin,'X-Map-Access-Code':env.MAP_ACCESS_CODE,...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const json=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers});
function provider(){
 let file=null,counter=0,calls=[];
 return {calls,fetch:async(url,init)=>{
  calls.push(url);
  if(url.endsWith('/oauth2/token'))return json({access_token:'fixture-access'});
  if(url.endsWith('/files/create_folder_v2')){assert.equal(JSON.parse(init.body).path,'/records');return json({metadata:{}})}
  if(url.endsWith('/files/list_folder'))return json({entries:file?[{'.tag':'file',name:id+'.json'}]:[],has_more:false});
  const arg=init.headers['Dropbox-API-Arg'];assert.ok(/^[\x00-\x7f]*$/.test(arg));new Headers(init.headers);
  assert.equal(JSON.parse(arg).path,'/records/'+id+'.json');
  if(url.endsWith('/files/download'))return file?json(file.profile,200,{'Dropbox-API-Result':JSON.stringify({rev:file.rev})}):json({error:{'.tag':'path',path:{'.tag':'not_found'}}},409);
  if(url.endsWith('/files/upload')){
   const {mode}=JSON.parse(arg);
   if(file&&(mode['.tag']==='add'||mode.update!==file.rev)||!file&&mode['.tag']==='update')return json({error:{'.tag':'path',path:{reason:{'.tag':'conflict'}}}},409);
   file={profile:JSON.parse(init.body),rev:(++counter).toString(16).padStart(16,'0')};return json({rev:file.rev});
  }
  throw Error('Unexpected provider operation');
 }};
}
test('App Folder-relative path never names the shared Dropbox folder',()=>assert.equal(PREFIX,'/records'));
test('Japanese path uses valid ASCII API headers',()=>assert.equal(JSON.parse(apiArg({path:'/日本語'})).path,'/日本語'));
test('health, authentication, Origin and preflight do not call Dropbox',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Should not call provider')};
 try{assert.equal((await worker.fetch(req('/health'),env)).status,200);assert.equal((await worker.fetch(req('/users','GET',undefined,{'X-Map-Access-Code':'wrong'}),env)).status,401);assert.equal((await worker.fetch(req('/users','GET',undefined,{Origin:'https://evil.example'}),env)).status,403);const preflight=await worker.fetch(req('/users','OPTIONS'),env);assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);assert.equal((await worker.fetch(req('/users'),{})).status,503)}finally{globalThis.fetch=original}
});
test('two independent clients: create/read/update and stale revision cannot overwrite',async()=>{
 const db=provider(),original=globalThis.fetch;globalThis.fetch=db.fetch;
 try{
  assert.equal((await worker.fetch(req('/records/'+id),env)).status,404);
  const create=await worker.fetch(req('/records/'+id,'PUT',{profile:profile(),rev:null}),env);assert.equal(create.status,200);const first=await create.json();
  const clientB=await (await worker.fetch(req('/records/'+id),env)).json();assert.deepEqual(clientB.profile.records,profile().records);
  const changed=profile();changed.records.M611.memo='別セッションの更新';
  const b=await worker.fetch(req('/records/'+id,'PUT',{profile:changed,rev:clientB.rev}),env);assert.equal(b.status,200);
  assert.equal((await worker.fetch(req('/records/'+id,'PUT',{profile:profile(),rev:first.rev}),env)).status,409);
  assert.equal((await worker.fetch(req('/records/'+id,'PUT',{profile:profile(),rev:null}),env)).status,409);
  const final=await (await worker.fetch(req('/records/'+id),env)).json();assert.equal(final.profile.records.M611.memo,'別セッションの更新');
  const list=await (await worker.fetch(req('/users'),env)).json();assert.equal(list.users[0].id,id);
 }finally{globalThis.fetch=original}
});
test('invalid JSON, traversal, cross-profile and oversized UTF-8 are rejected before provider call',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Should not call provider')};
 try{
  const bad=profile();bad.user.id='u-ffffffffffffffffffffffff';assert.equal((await worker.fetch(req('/records/'+id,'PUT',{profile:bad,rev:null}),env)).status,400);
  const invalid=profile();invalid.records.M611.status='<script>';assert.equal((await worker.fetch(req('/records/'+id,'PUT',{profile:invalid,rev:null}),env)).status,400);
  assert.equal((await worker.fetch(req('/records/'+id,'PUT',{profile:profile(),rev:'bad'}),env)).status,400);
  const huge=new Request('https://example.workers.dev/records/'+id,{method:'PUT',headers:{'X-Map-Access-Code':env.MAP_ACCESS_CODE},body:'あ'.repeat(140000)});assert.equal((await worker.fetch(huge,env)).status,413);
  assert.equal((await worker.fetch(req('/records/not-an-id'),env)).status,404);
 }finally{globalThis.fetch=original}
});
test('provider errors do not disclose tokens, paths or records',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>json({error_description:'secret fixture-refresh'},401);
 try{const r=await worker.fetch(req('/users'),env);assert.equal(r.status,502);assert.equal(await r.text(),'{"ok":false,"error":"DROPBOX_AUTH_FAILED"}')}finally{globalThis.fetch=original}
});

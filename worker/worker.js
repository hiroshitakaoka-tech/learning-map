/** GitHub Pages -> Worker -> Dropbox. Never log credentials or records. */
const SITE = 'https://hiroshitakaoka-tech.github.io';
const PREFIX = '/原因追跡型学力診断/records';
const MAX_BODY = 400_000;
const ROLES = ['保護者','担任','教科主任','教頭','その他'];
const STATUS = ['未判定','習得確認','部分習得','要補習','言語障壁','保留'];
const RESULTS = ['未実施','正答・説明可','一部正答','誤答・説明困難','体調等で判定保留'];
const LANG = ['未確認','日本語でのみ困難','母語でも困難','言語影響を認めない','保留'];
const cors = () => ({'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Map-Access-Code','Access-Control-Max-Age':'86400','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
const respond = (obj,status=200) => new Response(JSON.stringify(obj),{status,headers:{...cors(),'Content-Type':'application/json; charset=utf-8'}});
const error = (code,status=400) => respond({ok:false,error:code},status);
// Dropbox-API-Arg must be ASCII even when the path contains Japanese.
export const apiArg = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
async function secureEqual(a,b){
 const hash = x => crypto.subtle.digest('SHA-256',new TextEncoder().encode(x));
 const [x,y] = await Promise.all([hash(a),hash(b)]); let diff=0;
 new Uint8Array(x).forEach((v,i)=>{diff|=v^new Uint8Array(y)[i]});return diff===0;
}
export function validateBody(data,id){
 if(!data||data.format!=='learning-map-profile-v2'||data.user?.id!==id||!data.records||typeof data.records!=='object'||Array.isArray(data.records))return false;
 const u=data.user;
 if(typeof u.name!=='string'||!u.name.trim()||u.name.length>60||!ROLES.includes(u.role))return false;
 if(Object.keys(u).some(k=>!['id','name','role'].includes(k)))return false;
 if(typeof data.updatedAt!=='string'||!Number.isFinite(Date.parse(data.updatedAt)))return false;
 if(Object.keys(data).some(k=>!['format','user','updatedAt','records'].includes(k)))return false;
 const entries=Object.entries(data.records);if(entries.length>350)return false;
 return entries.every(([k,v])=>/^[A-Z][0-9]{3,4}$/.test(k)&&v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).every(p=>['status','one','two','lang','date','memo'].includes(p))&&
  Object.values(v).every(x=>typeof x==='string')&&
  (v.status===undefined||STATUS.includes(v.status))&&
  ['one','two'].every(p=>v[p]===undefined||RESULTS.includes(v[p]))&&
  (v.lang===undefined||LANG.includes(v.lang))&&
  (!v.date||/^\d{4}-\d{2}-\d{2}$/.test(v.date))&&(v.memo||'').length<=6000);
}
async function boundedText(body){
 const reader=body?.getReader();if(!reader)return '';
 const chunks=[];let length=0;
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;
  if(length>MAX_BODY){await reader.cancel();throw new Error('PAYLOAD_TOO_LARGE')};chunks.push(value)}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
async function dropboxAccess(env){
 const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:env.DROPBOX_REFRESH_TOKEN,client_id:env.DROPBOX_APP_KEY});
 const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('DROPBOX_AUTH_FAILED');const d=await r.json();if(!d.access_token)throw new Error('DROPBOX_AUTH_FAILED');return d.access_token;
}
async function rpc(token,endpoint,body){
 const r=await fetch('https://api.dropboxapi.com/2/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 let data;try{data=await r.json()}catch{data={}}return {ok:r.ok,status:r.status,data};
}
const missing = x => x.status===409&&x.data.error?.['.tag']==='path'&&x.data.error.path?.['.tag']==='not_found';
async function ensureFolder(token){
 // Only the records child is ever created; no existing file is overwritten.
 const r=await rpc(token,'files/create_folder_v2',{path:PREFIX,autorename:false});
 if(r.ok)return;
 if(r.status===409&&r.data.error?.['.tag']==='path'&&r.data.error.path?.['.tag']==='conflict'&&r.data.error.path.conflict?.['.tag']==='folder')return;
 throw new Error('DROPBOX_FOLDER_FAILED');
}
async function listFiles(token){
 let p=await rpc(token,'files/list_folder',{path:PREFIX,recursive:false,limit:100});
 if(missing(p))return [];
 const ids=[];
 while(true){if(!p.ok)throw new Error('DROPBOX_LIST_FAILED');
  for(const f of p.data.entries||[])if(f['.tag']==='file'&&/^u-[0-9a-f]{24}\.json$/.test(f.name))ids.push(f.name.slice(0,-5));
  // A silent truncation would hide existing people. Fail explicitly instead.
  if(ids.length>200)throw new Error('TOO_MANY_PROFILES');
  if(!p.data.has_more)return ids;
  p=await rpc(token,'files/list_folder/continue',{cursor:p.data.cursor});
 }
}
async function readFile(token,id){
 const r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:'Bearer '+token,'Dropbox-API-Arg':apiArg({path:PREFIX+'/'+id+'.json'})},signal:AbortSignal.timeout(15000)});
 if(r.status===409){let data;try{data=await r.json()}catch{data={}}if(missing({status:409,data}))return null;throw new Error('DROPBOX_READ_FAILED')}
 if(!r.ok)throw new Error('DROPBOX_READ_FAILED');
 const meta=JSON.parse(r.headers.get('Dropbox-API-Result')||'{}');
 const data=JSON.parse(await boundedText(r.body));
 if(!meta.rev||!validateBody(data,id))throw new Error('INVALID_STORED_PROFILE');
 return {rev:meta.rev,data};
}
async function saveFile(token,id,data,rev){
 const mode=rev?{'.tag':'update',update:rev}:{'.tag':'add'};
 const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:'Bearer '+token,'Dropbox-API-Arg':apiArg({path:PREFIX+'/'+id+'.json',mode,autorename:false,strict_conflict:true,mute:true}),'Content-Type':'application/octet-stream'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
 if(r.status===409){let x;try{x=await r.json()}catch{x={}}if(x.error?.['.tag']==='path'&&x.error.path?.reason?.['.tag']==='conflict')return {conflict:true};throw new Error('DROPBOX_WRITE_FAILED')}
 if(!r.ok)throw new Error('DROPBOX_WRITE_FAILED');const meta=await r.json();if(!meta.rev)throw new Error('DROPBOX_WRITE_FAILED');return {rev:meta.rev};
}
export default {async fetch(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 if(origin&&origin!==SITE)return error('ORIGIN_NOT_ALLOWED',403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors()});
 const configured=!!(env.DROPBOX_APP_KEY&&env.DROPBOX_REFRESH_TOKEN&&env.MAP_ACCESS_CODE);
 if(url.pathname==='/health'&&request.method==='GET')return respond({ok:true,service:'learning-map-dropbox',configured});
 if(!configured)return error('SERVER_NOT_CONFIGURED',503);
 if(!(await secureEqual(request.headers.get('X-Map-Access-Code')||'',env.MAP_ACCESS_CODE)))return error('INVALID_ACCESS_CODE',401);
 const match=url.pathname.match(/^\/records\/(u-[0-9a-f]{24})$/);
 if(!(url.pathname==='/users'&&request.method==='GET')&&!(match&&['GET','PUT'].includes(request.method)))return error('NOT_FOUND',404);
 try{
  let pack;
  if(request.method==='PUT'){
   if(Number(request.headers.get('Content-Length')||0)>MAX_BODY)return error('PAYLOAD_TOO_LARGE',413);
   let raw;try{raw=await boundedText(request.body)}catch(e){return error(e.message==='PAYLOAD_TOO_LARGE'?'PAYLOAD_TOO_LARGE':'INVALID_JSON',e.message==='PAYLOAD_TOO_LARGE'?413:400)}
   try{pack=JSON.parse(raw)}catch{return error('INVALID_JSON')}
   if(!validateBody(pack?.profile,match[1]))return error('INVALID_PROFILE');
   if(pack.rev!==null&&(typeof pack.rev!=='string'||!/^[0-9a-f]{9,64}$/.test(pack.rev)))return error('INVALID_REV');
  }
  const token=await dropboxAccess(env);
  if(url.pathname==='/users'){
   const offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isInteger(offset)||offset<0||offset>200)return error('INVALID_OFFSET');
   const ids=(await listFiles(token)).sort(),page=ids.slice(offset,offset+20),users=[];
   // Keep bounded parallel batches within Worker connection limits.
   for(let i=0;i<page.length;i+=4){const batch=await Promise.all(page.slice(i,i+4).map(async id=>{const r=await readFile(token,id);return r?{...r.data.user,updatedAt:r.data.updatedAt,rev:r.rev}:null}));users.push(...batch.filter(Boolean))}
   return respond({ok:true,users,nextOffset:offset+20<ids.length?offset+20:null});
  }
  const id=match[1];
  if(request.method==='GET'){const r=await readFile(token,id);return r?respond({ok:true,rev:r.rev,profile:r.data}):error('NOT_FOUND',404)}
  await ensureFolder(token);
  const result=await saveFile(token,id,{...pack.profile,updatedAt:new Date().toISOString()},pack.rev);
  return result.conflict?error('VERSION_CONFLICT',409):respond({ok:true,rev:result.rev});
 }catch(e){
  // No raw provider error, token response, name or memo reaches logs or clients.
  const allowed=['DROPBOX_AUTH_FAILED','DROPBOX_FOLDER_FAILED','DROPBOX_LIST_FAILED','DROPBOX_READ_FAILED','DROPBOX_WRITE_FAILED','INVALID_STORED_PROFILE','TOO_MANY_PROFILES'];
  return error(allowed.includes(e.message)?e.message:'SERVER_FAILURE',502);
 }
}};

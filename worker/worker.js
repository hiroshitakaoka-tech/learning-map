/**
 * Learning Map Dropbox sync API for Cloudflare Workers.
 * Required Secrets: DROPBOX_APP_KEY, DROPBOX_REFRESH_TOKEN, MAP_ACCESS_CODE.
 * All records remain in /原因追跡型学力診断/records within the connected Dropbox.
 * DO NOT commit secrets or personal records to GitHub.
 */
const SITE = 'https://hiroshitakaoka-tech.github.io';
const PREFIX = '/原因追跡型学力診断/records';
const MAX_BODY = 400_000;
const ALLOWED_ROLES = ['保護者','担任','教科主任','教頭','その他'];

function cors(extra={}) { return {'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Map-Access-Code','Access-Control-Max-Age':'86400','Cache-Control':'no-store','Vary':'Origin',...extra}; }
function respond(obj,status=200,extra={}){return new Response(JSON.stringify(obj),{status,headers:{...cors(extra),'Content-Type':'application/json; charset=utf-8'}})}
function errorMessage(code,status=400,details=''){return respond({ok:false,error:code,details},status)}
function safeID(id){return /^u-[0-9a-f]{24}$/.test(id)}
async function hashHex(txt){const u=new TextEncoder().encode(txt); const digest=await crypto.subtle.digest('SHA-256',u);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function secureEqual(a,b){ // avoid early comparisons of user supplied passcodes
 const [x,y]=await Promise.all([hashHex(a||''),hashHex(b||'')]);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}
async function dropboxAccess(env){const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:env.DROPBOX_REFRESH_TOKEN||'',client_id:env.DROPBOX_APP_KEY||''});const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error('DROPBOX_OAUTH_'+r.status);let d=await r.json();if(!d.access_token)throw new Error('DROPBOX_OAUTH_INVALID');return d.access_token;}
async function dbxRpc(tok,endpoint,body){let r=await fetch('https://api.dropboxapi.com/2/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(body)});let raw=await r.text();let parsed;try{parsed=JSON.parse(raw)}catch{parsed={error_summary:raw.slice(0,200)}}return {ok:r.ok,status:r.status,data:parsed};}
function isMissing(x){return x.status===409 && /(not_found|path\/not_found)/.test(JSON.stringify(x.data));}
async function ensureFolder(tok){let s=await dbxRpc(tok,'files/create_folder_v2',{path:PREFIX,autorename:false});if(s.ok)return; if(s.status===409 && /(conflict|folder)/.test(JSON.stringify(s.data)))return;throw new Error('DROPBOX_CANNOT_CREATE_FOLDER_'+s.status);}
async function listFiles(tok){const out=[];let p=await dbxRpc(tok,'files/list_folder',{path:PREFIX,recursive:false,limit:2000});if(isMissing(p))return [];if(!p.ok)throw new Error('DROPBOX_LIST_'+p.status);while(true){for(const f of p.data.entries||[])if(f['.tag']==='file'&&/^u-[0-9a-f]{24}\.json$/.test(f.name))out.push(f.name.slice(0,-5));if(!p.data.has_more)break;p=await dbxRpc(tok,'files/list_folder/continue',{cursor:p.data.cursor});if(!p.ok)throw new Error('DROPBOX_CURSOR_'+p.status);}return out.slice(0,100);}
async function readFile(tok,id){let r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:'Bearer '+tok,'Dropbox-API-Arg':JSON.stringify({path:PREFIX+'/'+id+'.json'})}});if(r.status===409){const msg=await r.text();if(/not_found/.test(msg))return null;throw new Error('DROPBOX_DOWNLOAD_409');}if(!r.ok)throw new Error('DROPBOX_DOWNLOAD_'+r.status);const meta=JSON.parse(r.headers.get('Dropbox-API-Result')||'{}');const txt=await r.text();if(txt.length>MAX_BODY)throw new Error('FILE_TOO_LARGE');const data=JSON.parse(txt);return {rev:meta.rev,data};}
async function saveFile(tok,id,data,rev){const mode=rev?{'.tag':'update',update:rev}:{'.tag':'add'};const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:'Bearer '+tok,'Dropbox-API-Arg':JSON.stringify({path:PREFIX+'/'+id+'.json',mode,autorename:false,strict_conflict:true,mute:true}),'Content-Type':'application/octet-stream'},body:JSON.stringify(data)});if(r.status===409)return {conflict:true};if(!r.ok){const x=await r.text();throw new Error('DROPBOX_UPLOAD_'+r.status+'_'+x.slice(0,200));}return {rev:(await r.json()).rev};}
function validateBody(data,id){if(!data||data.format!=='learning-map-profile-v2'||!data.user||data.user.id!==id||typeof data.records!=='object'||Array.isArray(data.records)||!data.records)return false;const u=data.user;if(typeof u.name!=='string'||!u.name.trim()||u.name.length>60||!ALLOWED_ROLES.includes(u.role))return false;const entries=Object.entries(data.records);if(entries.length>350)return false;return entries.every(([k,v])=>/^[A-Z][0-9]{3,4}$/.test(k)&&v&&typeof v==='object'&&!Array.isArray(v)&&['status','one','two','lang','date','memo'].every(p=>v[p]==null||typeof v[p]==='string')&&String(v.memo||'').length<6000);}
export default {async fetch(request,env){
 const u=new URL(request.url);const origin=request.headers.get('Origin');if(origin && origin!==SITE)return errorMessage('ORIGIN_NOT_ALLOWED',403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors()});
 if(u.pathname==='/health'&&request.method==='GET')return respond({ok:true,service:'learning-map-dropbox',configured:!!(env.DROPBOX_APP_KEY&&env.DROPBOX_REFRESH_TOKEN&&env.MAP_ACCESS_CODE)});
 if(!env.MAP_ACCESS_CODE||!env.DROPBOX_APP_KEY||!env.DROPBOX_REFRESH_TOKEN)return errorMessage('SERVER_NOT_CONFIGURED',503);
 if(!(await secureEqual(request.headers.get('X-Map-Access-Code')||'',env.MAP_ACCESS_CODE)))return errorMessage('INVALID_ACCESS_CODE',401);
 try{
  const token=await dropboxAccess(env);const path=u.pathname;
  if(path==='/users'&&request.method==='GET'){
   const ids=await listFiles(token);const users=[];
   for(const id of ids){try{const r=await readFile(token,id);if(r?.data?.user?.id===id)users.push({...r.data.user,updatedAt:r.data.updatedAt||'',rev:r.rev});}catch(e){users.push({id,invalid:true});}}
   return respond({ok:true,users});
  }
  const match=path.match(/^\/records\/(u-[0-9a-f]{24})$/);
  if(match&&safeID(match[1])){
   const id=match[1];
   if(request.method==='GET'){const r=await readFile(token,id);return r?respond({ok:true,rev:r.rev,profile:r.data}):errorMessage('NOT_FOUND',404);}
   if(request.method==='PUT'){
    const len=Number(request.headers.get('Content-Length')||'0');if(len>MAX_BODY)return errorMessage('PAYLOAD_TOO_LARGE',413);
    let raw=await request.text();if(raw.length>MAX_BODY)return errorMessage('PAYLOAD_TOO_LARGE',413);
    let pack;try{pack=JSON.parse(raw)}catch{return errorMessage('INVALID_JSON')}
    if(!validateBody(pack?.profile,id))return errorMessage('INVALID_PROFILE');
    const supplied=pack?.rev;if(supplied!==null&&supplied!==undefined&&typeof supplied!=='string')return errorMessage('INVALID_REV');
    await ensureFolder(token);
    let result=await saveFile(token,id,pack.profile,supplied||null);
    if(result.conflict)return errorMessage('VERSION_CONFLICT',409,'Other device updated the JSON. Export your unsaved JSON before reloading.');
    return respond({ok:true,rev:result.rev});
   }
  }
  return errorMessage('NOT_FOUND',404);
 }catch(e){return errorMessage('SERVER_FAILURE',502,String(e.message||e).slice(0,230))}
}};

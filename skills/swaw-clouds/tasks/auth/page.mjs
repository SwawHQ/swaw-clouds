import {list as listWorkspaces,use as useWorkspace} from './workspaces.mjs';
import {credentialStore as edgeoneStore,credentialTarget as edgeoneTarget,tokenInput as edgeoneInput,verifyToken as verifyEdgeone} from '../edgeone/auth/credentials.mjs';
import http from 'node:http';
import fs from 'node:fs';
import {randomBytes,randomInt} from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {credentialStore as cloudflareStore,credentialTarget as cloudflareTarget} from '../cloudflare/_shared/credentials.mjs';
import {tokenInput,verifyToken} from '../cloudflare/auth/token/verify.mjs';
import {credentialStore as tencentStore,credentialTarget as tencentTarget,keyInput} from '../tencent/auth/credentials.mjs';
import {verifyKey} from '../tencent/auth/verify.mjs';
import {login as nativeLogin,prepare as prepareNativeTool} from './login.mjs';
import {check as checkNativeLogin} from './status.mjs';
import {systemLanguage} from '../help/run.mjs';

const stores = {cloudflare:cloudflareStore,tencent:tencentStore,edgeone:edgeoneStore};
const inputs = {cloudflare:tokenInput,tencent:keyInput,edgeone:edgeoneInput};
const verifiers = {cloudflare:verifyToken,tencent:verifyKey,edgeone:verifyEdgeone};
const storeCredential = (platform,action,value)=>stores[platform](action,value);
const verifyCredential = (platform,value)=>verifiers[platform](value);


export async function startAuthPage({platform = 'cloudflare',store = storeCredential,verify = verifyCredential,login = nativeLogin,prepare = prepareNativeTool,check = checkNativeLogin,workspaces = listWorkspaces,switchWorkspace = useWorkspace,environment = process.env,language = systemLanguage()} = {}) {
  if (!Object.hasOwn(stores,platform)) throw new Error('invalid_auth_platform');
  const existing = Object.fromEntries(await Promise.all(Object.keys(stores).map(async name=>[name,!!await store(name,'check')])));
  const document = JSON.parse(fs.readFileSync(new URL('./page.json',import.meta.url),'utf8'));
  const value = name=>Object.entries(environment).find(([key])=>key.toUpperCase() === name)?.[1];
  const accountId = value('CLOUDFLARE_ACCOUNT_ID') ?? value('CF_ACCOUNT_ID');
  const pageData = {platform,language,text:{en:document.en,zh:document.zh},links:document.links,existing,
    environment:{cloudflare:{token:!!(value('CLOUDFLARE_API_TOKEN') ?? value('CF_API_TOKEN')),accountId:/^[a-f0-9]{32}$/i.test(accountId) ? accountId : null,
      accountSet:!!accountId,legacyKey:!!(value('CLOUDFLARE_API_KEY') ?? value('CF_API_KEY')),email:!!(value('CLOUDFLARE_EMAIL') ?? value('CF_EMAIL'))},
      edgeone:{EDGEONE_PAGES_API_TOKEN:!!value('EDGEONE_PAGES_API_TOKEN'),EDGEONE_PAGES_API_REGION:!!value('EDGEONE_PAGES_API_REGION')},
      tencent:Object.fromEntries(['TENCENTCLOUD_SECRET_ID','TENCENTCLOUD_SECRET_KEY','TENCENTCLOUD_TOKEN','TENCENTCLOUD_REGION','TCCLI_PROFILE',
        'TENCENTCLOUD_ROLE_ARN','TENCENTCLOUD_ROLE_SESSION_NAME','TKE_REGION','TKE_PROVIDER_ID','TKE_WEB_IDENTITY_TOKEN_FILE','TKE_ROLE_ARN'].map(name=>[name,!!value(name)]))}};
  const session = randomBytes(32).toString('hex'), nonce = randomBytes(24).toString('base64');
  const html = fs.readFileSync(new URL('./page.html',import.meta.url),'utf8')
    .replaceAll('__NONCE__',nonce).replaceAll('__CF_TARGET__',cloudflareTarget).replaceAll('__TC_TARGET__',tencentTarget).replaceAll('__EO_TARGET__',edgeoneTarget).replaceAll('__LANG__',language);
  let origin, busy = false, committing = false, pendingClose, settled = false, finish;
  const controller = new AbortController();
  const preparations = new Map();
  const checks = new Map();
  let preparation = Promise.resolve();
  const prepareTool = tool=>{
    if (!preparations.has(tool)) {
      // Installers share the tools directory; prepare one tool at a time.
      const task = preparation.then(()=>{controller.signal.throwIfAborted();return prepare(tool,{signal:controller.signal});});
      preparations.set(tool,task);
      preparation = task.catch(()=>{preparations.delete(tool);});
    }
    return preparations.get(tool);
  };
  const checkTool = async tool=>{
    try {
      controller.signal.throwIfAborted();
      const status = await check(tool,{signal:controller.signal,environment});
      if(tool==='edgeone'&&status?.status==='authorized') {
        const safe=value=>typeof value==='string'?value.slice(0,256):null;
        return {status:'authorized',workspaceId:safe(status.workspaceId),workspaceName:safe(status.workspaceName)};
      }
      return ['authorized','notAuthorized','unavailable'].includes(status) ? status : 'unavailable';
    } catch { return 'unavailable'; }
  };
  const completed = new Promise(resolve=>{ finish = resolve; });
  const close = result => {
    if (settled) return;
    // Once Windows starts a write, report its outcome before closing the session.
    if (committing) { pendingClose = result; return; }
    settled = true; controller.abort(); server.close(); server.closeAllConnections(); finish(result);
  };
  const server = http.createServer(async(request,response)=>{
    const reply = (status,value,type = 'application/json; charset=utf-8') => {
      response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
        'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
      response.end(Buffer.isBuffer(value) || type.startsWith('text/html') ? value : JSON.stringify(value));
    };
    if (request.headers.host !== new URL(origin).host) return reply(403,{error:'forbidden'});
    if (request.method === 'GET' && request.url === '/logo.svg') return reply(200,fs.readFileSync(new URL('./logo.svg',import.meta.url)),'image/svg+xml');
    if (request.method === 'GET' && request.url === '/') return reply(200,html,'text/html; charset=utf-8');
    if (request.method === 'GET' && request.url === '/page.json') return reply(200,pageData);
    if (request.method !== 'POST' || !['/save','/cancel','/login','/prepare','/status','/workspaces','/workspace'].includes(request.url)) return reply(404,{error:'not_found'});
    if (request.headers.origin !== origin || request.headers['x-swcl-session'] !== session ||
        request.headers['content-type'] !== 'application/json') return reply(403,{error:'forbidden'});
    if (settled) return reply(409,{error:'busy'});
    if (request.url === '/cancel') {
      if (committing) return reply(409,{error:'busy'});
      response.once('finish',()=>close('cancelled')); return reply(200,{cancelled:true});
    }
    if (busy) return reply(409,{error:'busy'});
    const preparing = request.url === '/prepare',checking = request.url === '/status';
    if (!preparing && !checking) busy = true;
    try {
      let body = '', size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) { reply(413,{error:'input_too_large'}); return; }
        body += chunk.toString('utf8');
      }
      let input;
      try { input = JSON.parse(body); } catch { return reply(400,{error:'invalid_input'}); }
      if(request.url==='/workspaces'||request.url==='/workspace') {
        const options={signal:controller.signal,environment};
        if(request.url==='/workspace')await switchWorkspace(input?.id,options);
        const rows=await workspaces(options);
        if(!settled)reply(200,{workspaces:rows,status:request.url==='/workspace'?await checkTool('edgeone'):undefined});
        return;
      }
      if (preparing || checking || request.url === '/login') {
        if (!input || !['cf','wrangler','tccli','edgeone'].includes(input.tool)) return reply(400,{error:'invalid_login_tool'});
        if (preparing) {
          await prepareTool(input.tool);
          if (!settled) reply(200,{prepared:input.tool});
          return;
        }
        if (checking) {
          if (!checks.has(input.tool)) {
            const task = prepareTool(input.tool).then(()=>checkTool(input.tool)).catch(()=>'unavailable');
            checks.set(input.tool,task);
            task.finally(()=>checks.delete(input.tool));
          }
          const status = await checks.get(input.tool);
          if (!settled) reply(200,typeof status==='object'?status:{status});
          return;
        }
        await preparations.get(input.tool);
        if (settled) return;
        await login(input.tool,{signal:controller.signal,environment});
        if (settled) return;
        const status = await checkTool(input.tool);
        if (!settled) reply(200,typeof status==='object' ? {...status,authorized:input.tool} : status === 'authorized' ? {authorized:input.tool} : {status});
        return;
      }
      if (!input || !Object.hasOwn(inputs,input.platform)) return reply(400,{error:'invalid_auth_platform'});
      let value;
      try { value = inputs[input.platform](input); }
      catch (error) { return reply(400,{error:['invalid_cloudflare_token','invalid_cloudflare_account_id','invalid_tencent_key','invalid_edgeone_token'].includes(error.message) ? error.message : 'invalid_input'}); }
      await verify(input.platform,value);
      // Closing the page must not write a credential after verification finishes.
      if (settled) return;
      committing = true;
      await store(input.platform,'write',input.platform === 'edgeone' ? {secret:value.token,userName:value.site} : input.platform === 'cloudflare' ? {secret:value.token,userName:value.accountId || 'api-token'} : {secret:value.secretKey,userName:value.secretId});
      committing = false;
      pageData.existing[input.platform] = true;
      if (pendingClose) {
        if (response.destroyed) { close(pendingClose); return; }
        response.once('close',()=>close(pendingClose));
      }
      reply(200,{saved:true});
    } catch (error) {
      if (!preparing && !checking) {
        committing = false;
        if (pendingClose) { close(pendingClose); return; }
      }
      if (!response.headersSent && !settled) {
        if (checking) reply(200,{status:'unavailable'});
        else reply(400,{error:request.url==='/workspace' ? (error.message==='invalid_workspace'?'invalid_workspace':'workspace_switch_failed') : request.url==='/workspaces' ? 'workspace_list_failed' : preparing ? 'tool_preparation_failed' : request.url === '/login' ? 'login_failed' : ['cloudflare_token_verification_failed','tencent_key_verification_failed','edgeone_token_verification_failed','workspace_list_failed','workspace_switch_failed','invalid_workspace'].includes(error.message) ? error.message : 'credential_store_failed'});
      }
    } finally { if (!preparing && !checking) busy = false; }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  // Port 0 can select a port blocked by browsers; stay in the dynamic range.
  for(let attempt=0;attempt<10;attempt++) {
    try {
      const ready=once(server,'listening');
      server.listen(randomInt(49152,65536),'127.0.0.1');
      await ready;break;
    } catch(error) {
      if(!['EADDRINUSE','EACCES'].includes(error.code)||attempt===9)throw error;
    }
  }
  origin = 'http://127.0.0.1:'+server.address().port;
  return {url:origin+'/#'+session,completed,close:()=>close('cancelled')};
}

export function openAuthPage(url) {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise(resolve=>{
    const child = spawn(executable,['-NoProfile','-NonInteractive','-Command',"Start-Process -FilePath '"+url+"' -WindowStyle Normal"],
      {windowsHide:true,stdio:'ignore'});
    child.once('error',()=>resolve(false)); child.once('close',code=>resolve(code === 0));
  });
}

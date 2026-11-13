import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {startAuthPage} from '../page.mjs';
import {credentialTarget} from '../../cloudflare/_shared/credentials.mjs';
import {systemLanguage} from '../../help/run.mjs';
const token='fixture-token-never-a-real-secret',accountId='a'.repeat(32);
async function fixture(run,options = {}) {
  const writes = [];
  const page = await startAuthPage({store:async(platform,action,value)=>{if(action === 'write')writes.push(value);return null;},verify:async()=>{},prepare:async()=>{},check:async()=>'authorized',environment:{},...options});
  const url = new URL(page.url),origin = url.origin,session = url.hash.slice(1);
  const post = (route,value,headers = {})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Swcl-Session':session,...headers},body:JSON.stringify(route === '/save' ? {platform:'cloudflare',...value} : value)});
  try { await run({page,origin,post,writes}); } finally { page.close(); await page.completed; }
}

test('local page rejects cross-origin and oversized requests, then saves without closing setup',()=>fixture(async({page,origin,post,writes})=>{
  const response = await fetch(origin);
  const html = await response.text();
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.ok(html.includes(credentialTarget)); assert.ok(!html.includes(token));
  assert.ok(html.includes('<html lang="'+systemLanguage()+'">'));
  const data = await (await fetch(origin+'/page.json')).json();
  const copy = JSON.parse(fs.readFileSync(new URL('../page.json',import.meta.url),'utf8'));
  assert.equal(data.platform,'cloudflare');assert.equal(data.language,systemLanguage());assert.deepEqual(data.text,{en:copy.en,zh:copy.zh});assert.deepEqual(data.links,copy.links);
  assert.deepEqual(data.existing,{cloudflare:false,tencent:false,edgeone:false});
  assert.deepEqual(data.environment.cloudflare,{token:false,accountId:null,accountSet:false,legacyKey:false,email:false});
  for (const headers of [{Origin:'https://evil.example'},{'X-Swcl-Session':'wrong'},{'Content-Type':'text/plain'}])
    assert.equal((await post('/save',{token},headers)).status,403);
  const rebound = await new Promise((resolve,reject)=>{
    const request = http.get(origin,{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});
    request.once('error',reject);
  });
  assert.equal(rebound,403);
  assert.equal((await post('/save',{token:'x'.repeat(9000)})).status,413);
  assert.equal((await post('/save',{token:'bad\nsecret'})).status,400);
  assert.equal(writes.length,0);
  const saved = await post('/save',{token,accountId});
  assert.deepEqual(await saved.json(),{saved:true});
  assert.deepEqual(writes,[{secret:token,userName:accountId}]);
  assert.equal((await (await fetch(origin+'/page.json')).json()).existing.cloudflare,true);
  await post('/cancel',{}); assert.equal(await page.completed,'cancelled');
  await assert.rejects(fetch(origin));
}));

test('verification or storage failure preserves the old credential and keeps the form available',async()=>{
  for (const failure of ['verify','store']) await fixture(async({page,origin,post,writes})=>{
    const response = await post('/save',{token});
    assert.equal(response.status,400); assert.ok(!(await response.text()).includes(token));
    assert.equal(writes.length,0); assert.equal((await fetch(origin)).status,200);
    assert.deepEqual(await (await post('/cancel',{})).json(),{cancelled:true});
    assert.equal(await page.completed,'cancelled');
  },failure === 'verify' ? {verify:async()=>{throw new Error('cloudflare_token_verification_failed');}} :
    {store:async(platform,action)=>{if(action === 'write')throw new Error(token);return {userName:'old'};}});
});

test('closing setup during verification never commits a late credential',{timeout:5000},async()=>{
  let release,started;
  const verifying = new Promise(resolve=>{started = resolve;});
  const gate = new Promise(resolve=>{release = resolve;});
  await fixture(async({page,origin,post,writes})=>{
    const saving = post('/save',{token}).catch(()=>null);
    await verifying; page.close();
    assert.equal(await page.completed,'cancelled'); release(); await saving;
    assert.equal(writes.length,0); await assert.rejects(fetch(origin));
  },{verify:async()=>{started();await gate;}});
});

test('an in-flight Windows write completes before reporting session closure',{timeout:5000},async()=>{
  let started,release;
  const writing = new Promise(resolve=>{started = resolve;});
  const gate = new Promise(resolve=>{release = resolve;});
  await fixture(async({page,post})=>{
    const saving = post('/save',{token});
    await writing;
    assert.equal((await post('/cancel',{})).status,409);
    assert.equal((await post('/save',{token})).status,409);
    assert.equal((await post('/status',{tool:'cf'})).status,409);
    assert.equal((await post('/prepare',{tool:'cf'})).status,409);
    page.close(); release();
    assert.deepEqual(await (await saving).json(),{saved:true});
    assert.equal(await page.completed,'cancelled');
  },{store:async(platform,action)=>{if(action === 'write'){started();await gate;}return null;}});
});

test('a disconnected save finishes its write before explicit session closure',{timeout:5000},async t=>{
  const started = Promise.withResolvers(),release = Promise.withResolvers(),disconnected = Promise.withResolvers();
  let writes = 0,completed = false,guard;
  const emit = http.ServerResponse.prototype.emit;
  t.mock.method(http.ServerResponse.prototype,'emit',function(event,...args) {
    if (event === 'close' && this.req.url === '/save') disconnected.resolve();
    return emit.call(this,event,...args);
  });
  await fixture(async({page,origin})=>{
    page.completed.then(()=>{completed = true;});
    const request = http.request(origin+'/save',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Swcl-Session':new URL(page.url).hash.slice(1)}},response=>response.resume());
    request.on('error',started.reject);request.end(JSON.stringify({platform:'cloudflare',token}));
    try {
      await started.promise;request.destroy();await disconnected.promise;
      page.close();
      assert.equal(completed,false);assert.equal(writes,0);
      release.resolve();
      const result = await new Promise((resolve,reject)=>{
        guard = setTimeout(()=>reject(new Error('session_did_not_close')),1000);
        page.completed.then(resolve,reject);
      });
      assert.equal(result,'cancelled');assert.equal(writes,1);
      await assert.rejects(fetch(origin));
    } finally {clearTimeout(guard);release.resolve();request.destroy();page.close();}
  },{store:async(platform,action)=>{
    if (action === 'write') {started.resolve();await release.promise;writes++;}return null;
  }});
});

test('setup exposes only environment status and validates native login requests without returning CLI errors',async()=>{
  const calls = [];
  await fixture(async({page,origin,post,writes})=>{
    const response = await fetch(origin+'/page.json');
    const body = await response.text(),data = JSON.parse(body);
    for (const secret of ['fixture-env-token','fixture-api-key','private@example.test']) assert.ok(!body.includes(secret));
    assert.deepEqual(data.environment.cloudflare,{token:true,accountId,accountSet:true,legacyKey:true,email:true});
    assert.equal((await post('/login',{tool:'cf'},{Origin:'https://evil.example'})).status,403);
    for (const tool of ['node','cf --help',null]) assert.equal((await post('/login',{tool})).status,400);
    assert.equal(calls.length,0);
    assert.deepEqual(await (await post('/login',{tool:'cf'})).json(),{authorized:'cf'});
    const failed = await post('/login',{tool:'wrangler'});
    assert.equal(failed.status,400); assert.deepEqual(await failed.json(),{error:'login_failed'});
    assert.deepEqual(calls,['cf','wrangler']); assert.equal(writes.length,0);
    assert.equal((await fetch(origin)).status,200);
    await post('/cancel',{}); assert.equal(await page.completed,'cancelled');
  },{environment:{cloudflare_api_token:'fixture-env-token',CLOUDFLARE_ACCOUNT_ID:accountId,CLOUDFLARE_API_KEY:'fixture-api-key',CLOUDFLARE_EMAIL:'private@example.test'},
    login:async(tool,{signal,environment})=>{calls.push(tool);assert.ok(!signal.aborted);assert.equal(environment.cloudflare_api_token,'fixture-env-token');if(tool==='wrangler')throw new Error('private-cli-output');}});
  await fixture(async({origin})=>{
    const data = await (await fetch(origin+'/page.json')).json();
    assert.equal(data.environment.cloudflare.accountId,null);assert.equal(data.environment.cloudflare.accountSet,true);
    assert.ok(!JSON.stringify(data).includes('invalid-private-value'));
  },{environment:{CLOUDFLARE_ACCOUNT_ID:'invalid-private-value'}});
});

test('authorization page reports native environment aliases without exposing credential contents',async()=>{
  const aliases = {cf_api_token:'private-alias-token',cf_api_key:'private-alias-key',
    cf_email:'private-alias@example.test',cf_account_id:accountId};
  for (const [environment,expected] of [
    [aliases,{token:true,accountId,accountSet:true,legacyKey:true,email:true}],
    [{...aliases,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_API_KEY:'',CLOUDFLARE_EMAIL:'',CLOUDFLARE_ACCOUNT_ID:''},
      {token:false,accountId:null,accountSet:false,legacyKey:false,email:false}],
    [{...aliases,CLOUDFLARE_ACCOUNT_ID:'private-invalid-account'},
      {token:true,accountId:null,accountSet:true,legacyKey:true,email:true}]
  ]) await fixture(async({origin})=>{
    const response = await fetch(origin+'/page.json'),body = await response.text();
    assert.deepEqual(JSON.parse(body).environment.cloudflare,expected);
    for (const secret of ['private-alias-token','private-alias-key','private-alias@example.test','private-invalid-account'])
      assert.ok(!body.includes(secret));
  },{environment});
});

test('closing setup aborts an active login and rejects concurrent mutations',{timeout:5000},async()=>{
  let started,aborted;
  const running = new Promise(resolve=>{started = resolve;});
  await fixture(async({page,post,writes})=>{
    const request = post('/login',{tool:'cf'}).catch(()=>null);
    await running;
    assert.equal((await post('/login',{tool:'wrangler'})).status,409);
    assert.equal((await post('/save',{token})).status,409);
    assert.deepEqual(await (await post('/cancel',{})).json(),{cancelled:true});
    assert.equal(await page.completed,'cancelled'); await request;
    assert.equal(aborted,true);assert.equal(writes.length,0);
  },{login:async(tool,{signal})=>new Promise((resolve,reject)=>{
    started();signal.addEventListener('abort',()=>{aborted = true;reject(new Error('aborted'));},{once:true});
  })});
});

test('Authorization page does not serve site files',async()=>{
  await fixture(async({origin})=>{
    const html=await (await fetch(origin)).text();
    assert.match(html,/<img src="\/logo.svg/);
    const logo=await fetch(origin+'/logo.svg');assert.equal(logo.status,200);assert.equal(logo.headers.get('content-type'),'image/svg+xml');assert.equal(await logo.text(),fs.readFileSync(new URL('../logo.svg',import.meta.url),'utf8'));
    for(const route of ['/favicon.ico','/assets/site/private.txt']) assert.equal((await fetch(origin+route)).status,404);
  });
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edgeoneEnvironment,tokenInput,verifyToken} from '../credentials.mjs';
import {loginEnvironment} from '../../../auth/login.mjs';
import {startAuthPage} from '../../../auth/page.mjs';

test('EdgeOne saved Tokens are isolated and explicit native identities take precedence',async()=>{
  let reads=0;const store=async()=>{reads++;return {secret:'fixture-secret',userName:'global'};};
  const original={HOME:'native-home'};
  assert.deepEqual(await edgeoneEnvironment(['makers','deploy','./out'],original,store),{...original,EDGEONE_PAGES_API_TOKEN:'fixture-secret',EDGEONE_PAGES_API_REGION:'global'});
  assert.deepEqual(original,{HOME:'native-home'});
  for(const args of [['login'],['logout'],['switch'],['workspace','ls'],['whoami','--token','explicit'],['makers','deploy','-t=explicit'],['makers','deploy','-texplicit'],['--help']]) {
    const before=reads;assert.deepEqual(await edgeoneEnvironment(args,original,store),original);assert.equal(reads,before);
  }
  const before=reads;
  assert.equal((await edgeoneEnvironment(['whoami'],{EDGEONE_PAGES_API_TOKEN:'explicit'},store)).EDGEONE_PAGES_API_TOKEN,'explicit');assert.equal(reads,before);
  assert.deepEqual(loginEnvironment('edgeone',{EDGEONE_PAGES_API_TOKEN:'secret',edgeone_pages_api_region:'china',HOME:'native-home'}),{HOME:'native-home'});
  await assert.rejects(edgeoneEnvironment(['whoami'],{},async()=>({secret:'bad\nsecret',userName:'global'})),/invalid_edgeone_credential/);
});

test('EdgeOne Token verification uses fixed site endpoints and never echoes secrets',async()=>{
  for(const site of ['china','global'])await verifyToken({token:'fixture-secret',site},async(url,options)=>{
    assert.equal(url,'https://'+(site==='china'?'pages-api.cloud.tencent.com':'pages-api.edgeone.ai')+'/v1');
    assert.equal(options.headers.Authorization,'Bearer fixture-secret');assert.equal(options.redirect,'error');
    assert.equal(JSON.parse(options.body).Action,'DescribeUserInfo');
    return {ok:true,json:async()=>({Data:{Response:{Uin:'123',ZoneId:'workspace'}}})};
  });
  for(const input of [{token:'',site:'global'},{token:'bad\nsecret',site:'china'},{token:'fixture-secret',site:'https://evil.test'},{token:'x'.repeat(4097),site:'global'}])assert.throws(()=>tokenInput(input),/invalid_edgeone_token/);
  for(const response of [{},{Error:{Message:'fixture-secret'}},{UserName:'valid',Code:'AuthFailure'}])
    await assert.rejects(verifyToken({token:'fixture-secret',site:'global'},async()=>({ok:true,json:async()=>response})),/^Error: edgeone_token_verification_failed$/);
  await assert.rejects(verifyToken({token:'fixture-secret',site:'global'},async()=>{throw new Error('fixture-secret');}),/^Error: edgeone_token_verification_failed$/);
});

test('EdgeOne authorization saves only its own credential and exposes sanitized status',async()=>{
  const writes=[];let fail=false;
  const page=await startAuthPage({platform:'edgeone',environment:{EDGEONE_PAGES_API_TOKEN:'private-env'},prepare:async()=>{},login:async()=>{},
    check:async()=>({status:'authorized',workspaceId:'workspace',workspaceName:'Test',token:'must-not-leak'}),
    store:async(platform,action,value)=>{if(action==='write')writes.push({platform,...value});return null;},
    verify:async(platform,value)=>{assert.equal(platform,'edgeone');if(fail)throw new Error('edgeone_token_verification_failed');assert.deepEqual(value,{token:'fixture-secret',site:'global'});}});
  const url=new URL(page.url),post=(route,value)=>fetch(url.origin+route,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json','X-Swcl-Session':url.hash.slice(1)},body:JSON.stringify(value)});
  try {
    const raw=await (await fetch(url.origin+'/page.json')).text();assert.ok(!raw.includes('private-env'));assert.equal(JSON.parse(raw).environment.edgeone.EDGEONE_PAGES_API_TOKEN,true);
    assert.deepEqual(await (await post('/status',{tool:'edgeone'})).json(),{status:'authorized',workspaceId:'workspace',workspaceName:'Test'});
    assert.equal((await post('/save',{platform:'edgeone',token:'fixture-secret',site:'global'})).status,200);
    assert.deepEqual(writes,[{platform:'edgeone',secret:'fixture-secret',userName:'global'}]);
    fail=true;assert.equal((await post('/save',{platform:'edgeone',token:'fixture-secret',site:'global'})).status,400);assert.equal(writes.length,1);
    assert.equal((await post('/save',{platform:'edgeone',token:'fixture-secret',site:'invalid'})).status,400);
  }finally{page.close();await page.completed;}
});

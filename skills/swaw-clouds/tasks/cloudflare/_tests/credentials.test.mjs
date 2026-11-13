import {test} from 'node:test';
import assert from 'node:assert/strict';
import {credentialTarget,inspectCredential,cloudflareEnvironment} from '../_shared/credentials.mjs';
import {tokenInput,verifyToken} from '../auth/token/verify.mjs';

const token = 'fixture-token-never-a-real-secret',accountId = 'a'.repeat(32);
test('saved credentials feed only child environments and respect explicit credentials and native authorization',async()=>{
  const original = {PATH:'fixture-path'};
  let calls = 0;
  const store = async action=>{calls++; assert.equal(action,'read'); return {secret:token,userName:accountId};};
  assert.deepEqual(await cloudflareEnvironment('cf',['zones','list'],original,store),
    {...original,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId});
  for (const args of [['--help'],['--version'],['--profile','work','zones','list'],['--profile=work'],['auth','login'],['auth','logout'],
    ['auth','create','work'],['auth','delete','work'],['auth','activate','work'],['auth','deactivate'],['auth','list'],
    ['auth','whoami','--profile','work'],['login'],['logout'],
    ['--cwd','work tree','login'],['--quiet','--mode','dev','auth','login'],['--cwd=work','logout']]) {
    const before = calls;
    assert.deepEqual(await cloudflareEnvironment('cf',args,original,store),original); assert.equal(calls,before);
  }
  const explicit = {...original,CLOUDFLARE_API_TOKEN:'explicit-token'};
  const before = calls;
  assert.deepEqual(await cloudflareEnvironment('cf',[],explicit,store),explicit); assert.equal(calls,before);
  if (process.platform === 'win32') {
    assert.deepEqual(await cloudflareEnvironment('cf',[],{cloudflare_api_token:'explicit-token'},store),{CLOUDFLARE_API_TOKEN:'explicit-token'});
    assert.equal(calls,before);
  }
  const accountOverride = await cloudflareEnvironment('cf',[],{CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)},store);
  assert.equal(accountOverride.CLOUDFLARE_ACCOUNT_ID,'b'.repeat(32));
  assert.deepEqual(original,{PATH:'fixture-path'});
  assert.deepEqual(await cloudflareEnvironment('cf',[],original,async()=>null),original);
  await assert.rejects(cloudflareEnvironment('cf',[],original,async()=>({secret:'bad\nsecret'})),/invalid_cloudflare_credential/);
  assert.deepEqual(await inspectCredential(async()=>({userName:accountId})),{target:credentialTarget,present:true,accountId});
  assert.deepEqual(await inspectCredential(async()=>null),{target:credentialTarget,present:false});
});

test('Cloudflare identity queries use the same credentials as resource commands',async()=>{
  let reads = 0;
  const store = async()=>{reads++;return {secret:token,userName:accountId};};
  for (const args of [['auth','whoami'],['whoami'],['--quiet','auth','whoami'],['auth','--quiet','whoami'],
    ['--mode','dev','auth','whoami'],['auth','--mode','dev','whoami']]) {
    const before = reads;
    assert.deepEqual(await cloudflareEnvironment('cf',args,{},store),{CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId});
    assert.equal(reads,before+1);
    assert.deepEqual(await cloudflareEnvironment('cf',args,{CLOUDFLARE_API_TOKEN:'explicit-token'},store),{CLOUDFLARE_API_TOKEN:'explicit-token'});
    assert.equal(reads,before+1);
    assert.deepEqual(await cloudflareEnvironment('cf',args,{},async()=>null),{});
  }
});

test('Cloudflare native environment aliases preserve explicit credentials and account targets',async()=>{
  let reads = 0;
  const store = async()=>{reads++;return {secret:token,userName:accountId};};
  for (const tool of ['cf','wrangler']) {
    for (const environment of [
      {CF_API_TOKEN:'explicit-token'},
      {CF_API_KEY:'explicit-key',CF_EMAIL:'explicit@example.test'},
      {CLOUDFLARE_API_KEY:'explicit-key',CF_EMAIL:'explicit@example.test'},
      {CF_API_KEY:'explicit-key',CLOUDFLARE_EMAIL:'explicit@example.test'},
      {CLOUDFLARE_API_TOKEN:'standard-token',CF_API_TOKEN:'alias-token'}
    ]) {
      const before = reads,original = {...environment};
      assert.deepEqual(await cloudflareEnvironment(tool,['pages','project','list'],environment,store),original);
      assert.equal(reads,before);assert.deepEqual(environment,original);
    }
    const explicitAccount = 'b'.repeat(32);
    assert.deepEqual(await cloudflareEnvironment(tool,['pages','project','list'],{CF_ACCOUNT_ID:explicitAccount},store),
      {CF_ACCOUNT_ID:explicitAccount,CLOUDFLARE_API_TOKEN:token});
    const bothAccounts = {CLOUDFLARE_ACCOUNT_ID:explicitAccount,CF_ACCOUNT_ID:accountId};
    assert.deepEqual(await cloudflareEnvironment(tool,[],bothAccounts,store),{...bothAccounts,CLOUDFLARE_API_TOKEN:token});
    const emptyStandard = {CLOUDFLARE_API_TOKEN:'',CF_API_TOKEN:'ignored-alias'};
    assert.deepEqual(await cloudflareEnvironment(tool,[],emptyStandard,store),
      {...emptyStandard,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId});
    const emptyAccount = {CLOUDFLARE_ACCOUNT_ID:'',CF_ACCOUNT_ID:explicitAccount};
    assert.deepEqual(await cloudflareEnvironment(tool,[],emptyAccount,store),
      {...emptyAccount,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId});
    if (process.platform === 'win32') {
      const before = reads;
      assert.deepEqual(await cloudflareEnvironment(tool,[],{cf_api_token:'lowercase-token'},store),{CF_API_TOKEN:'lowercase-token'});
      assert.equal(reads,before);
      assert.deepEqual(await cloudflareEnvironment(tool,[],{cf_account_id:explicitAccount},store),
        {CF_ACCOUNT_ID:explicitAccount,CLOUDFLARE_API_TOKEN:token});
    }
  }
});

test('resource names and option values do not bypass the saved Cloudflare identity',async()=>{
  let reads = 0;
  const store = async()=>{reads++;return {secret:token,userName:accountId};};
  for (const name of ['auth','login','logout']) {
    for (const args of [['pages','project','create',name,'--production-branch','main'],
      ['--cwd',name,'pages','project','create','site'],['--mode='+name,'zones','list']]) {
      const before = reads;
      assert.equal((await cloudflareEnvironment('cf',args,{},store)).CLOUDFLARE_API_TOKEN,token);
      assert.equal(reads,before+1);
    }
  }
});

test('boolean global values preserve native sign-in and saved-token selection',async()=>{
  let reads = 0;
  const store = async()=>{reads++;return {secret:token,userName:accountId};};
  for (const [tool,flag] of [['cf','--quiet'],['cf','-q'],['cf','--q'],['cf','--local'],
    ['wrangler','--install-skills'],['wrangler','--installSkills'],['wrangler','--experimental-provision'],['wrangler','--x-provision'],
    ['wrangler','--experimental-auto-create'],['wrangler','--x-auto-create']]) for (const value of ['true','false']) {
    for (const option of [[flag,value],[flag+'='+value],[flag]]) {
      for (const args of [[...option,'auth','login'],['auth',...option,'login'],[...option,'login'],[...option,'logout']]) {
        const before = reads;
        assert.deepEqual(await cloudflareEnvironment(tool,args,{},store),{},args.join(' '));assert.equal(reads,before);
      }
      for (const args of [[...option,'auth','whoami'],['auth',...option,'whoami'],[...option,'zones','list']]) {
        const before = reads;
        assert.equal((await cloudflareEnvironment(tool,args,{},store)).CLOUDFLARE_API_TOKEN,token,args.join(' '));assert.equal(reads,before+1);
      }
    }
  }
});

test('diagnostic booleans, clusters and separators follow each native tool without changing identity',async()=>{
  let reads = 0;
  const store = async()=>{reads++;return {secret:token,userName:accountId};};
  for (const [tool,args,saved] of [
    ['cf',['--version','false','zones','list'],false],['cf',['-v','false','zones','list'],false],
    ['cf',['--version=false','zones','list'],true],['cf',['-v=false','zones','list'],true],
    ['cf',['--version=true','zones','list'],false],['cf',['--v','true','zones','list'],false],['cf',['-qv','zones','list'],false],
    ['wrangler',['--version','false','pages','project','list'],true],['wrangler',['-v','true','pages','project','list'],true],
    ['wrangler',['--version'],false],['wrangler',['--version','true'],false],
    ['cf',['zones','list','--help','false'],true],['wrangler',['pages','project','list','--help','false'],true],
    ['cf',['auth','--help=false','whoami'],true],['cf',['auth','-h=false','whoami'],true],
    ['cf',['auth','-qh','false','whoami'],true],['cf',['auth','-qh=false','whoami'],true],
    ['cf',['zones','list','--help=true','--help=false'],true],['cf',['zones','list','--help=false','--help=true'],false],
    ['cf',['auth','--no-help','whoami'],true],['cf',['auth','--no-quiet','false','login'],false],
    ['cf',['auth','--no-quiet','false','whoami'],false],
    ['cf',['zones','list','--','--help'],true],['cf',['zones','list','--','--version'],true],
    ['cf',['--m','login','auth','whoami'],true],['cf',['--m','login','auth','login'],false],
    ['cf',['zones','list','--profile','work'],false]
  ]) {
    const before = reads,env = await cloudflareEnvironment(tool,args,{},store);
    assert.equal(env.CLOUDFLARE_API_TOKEN,saved ? token : undefined,tool+' '+args.join(' '));
    assert.equal(reads,before+(saved ? 1 : 0));
  }
});

test('verification handles user and account tokens, expiry, invalid input and remote errors without echoing secrets',async()=>{
  assert.deepEqual(tokenInput({token:' '+token+' ',accountId:' '+accountId+' '}),{token,accountId});
  for (const value of [{token:''},{token:'x'.repeat(1025)},{token:'bad\nsecret'},{token,accountId:'wrong'}]) assert.throws(()=>tokenInput(value));
  const calls = [];
  const request = async(url,options)=>{
    calls.push(url); assert.equal(options.headers.Authorization,'Bearer '+token); assert.equal(options.redirect,'error');
    return {ok:true,status:200,json:async()=>({success:true,result:{status:calls.length === 1 ? 'disabled' : 'active'}})};
  };
  await verifyToken({token,accountId},request);
  assert.deepEqual(calls,['https://api.cloudflare.com/client/v4/user/tokens/verify','https://api.cloudflare.com/client/v4/accounts/'+accountId+'/tokens/verify']);
  for (const result of [{status:'expired'},{status:'active',not_before:'2999-01-01T00:00:00Z'},{status:'active',expires_on:'2000-01-01T00:00:00Z'}])
    await assert.rejects(verifyToken({token},async()=>({ok:true,status:200,json:async()=>({success:true,result})})),/^Error: cloudflare_token_verification_failed$/);
  await assert.rejects(verifyToken({token},async()=>{throw new Error(token);}),/^Error: cloudflare_token_verification_failed$/);
});

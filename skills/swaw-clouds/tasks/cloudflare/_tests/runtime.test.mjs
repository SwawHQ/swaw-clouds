import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {writeBindings} from '../../_shared/tools/bindings.mjs';

import {fixture as skillFixture,write} from '../../_shared/_tests/fixture.mjs';
const fixture=run=>skillFixture(run,{CLOUDFLARE_API_TOKEN:'fixture-token'});

const groups = {cf:'cli',wrangler:'wrangler'};
const directoryVariables = ['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA',
  'XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','WRANGLER_CACHE_DIR','WRANGLER_LOG_PATH','WRANGLER_REGISTRY_PATH',
  'CLOUDFLARE_REGISTRY_PATH','MINIFLARE_REGISTRY_PATH'];
test('Cloudflare metadata help, cold checks and invalid ensures never prepare tools or packages',()=>fixture(async({skill,cli})=>{
  for (const cold of process.platform === 'win32' ? [false,true] : [false]) {
    for (const group of Object.values(groups)) {
      const command = 'cloudflare/'+group;
      for (const suffix of ['', '/ensure','/check']) {
        const result = cli('help/en',[command+suffix],cold);
        assert.equal(result.status,0,result.stderr); assert.ok(result.stdout.includes('swcl '+command+suffix));
      }
      for (const suffix of ['/ensure','/check']) {
        const result = cli(command+suffix,['--help'],cold);
        assert.equal(result.status,0,result.stderr); assert.ok(result.stdout.includes('swcl '+command+suffix));
      }
      const missing = cli(command+'/check',[],cold);
      assert.equal(missing.status,1,missing.stdout+missing.stderr);
      assert.match(missing.stderr,cold ? /runtime_not_ready|cloudflare\/.+\/ensure/ : /cloudflare\/.+\/ensure/);
      for (const args of [['--unknown'],['--force','--force']]) {
        const invalid = cli(command+'/ensure',args,cold);
        assert.equal(invalid.status,1); assert.match(invalid.stderr,/invalid_ensure_arguments/);
      }
      assert.equal(fs.existsSync(path.join(skill,'tasks/cloudflare',group,'node_modules')),false);
      assert.equal(fs.existsSync(path.join(skill,'.tools')),false);
    }
    const setup = cli('cloudflare/auth/setup',['--help'],cold);
    assert.equal(setup.status,0,setup.stderr);assert.match(setup.stdout,/API Token/);
    const help = cli('help/en',['cloudflare','2'],cold);
    assert.equal(help.status,0,help.stderr);
    for (const group of Object.values(groups)) for (const suffix of ['', '/ensure','/check'])
      assert.ok(help.stdout.includes('cloudflare/'+group+suffix),help.stdout);
    const absent = cli('cloudflare/pages/publish',[],cold);
    assert.equal(absent.status,1);assert.match(absent.stderr,/unknown_command:cloudflare\/pages\/publish/);
    assert.doesNotMatch(help.stdout,/pages\/publish/);
    assert.equal(fs.existsSync(path.join(skill,'.tools')),false);
  }
}));

const fakeCli = `const path=require('node:path');
const fs=require('node:fs');
const name=require('../package.json').name;
if(name==='cf'&&process.env.CF_DELEGATION!=='1'){
  const local=require.resolve('cf',{paths:[process.cwd()]});
  if(local!==__filename){require(local);return;}
}
const args=process.argv.slice(2);
const cwdOption=args.find(arg=>arg.startsWith('--cwd=')),cwdIndex=args.indexOf('--cwd');
if(cwdOption||cwdIndex>=0)process.chdir(cwdOption?cwdOption.slice(6):args[cwdIndex+1]);
let publication;
if(args[0]==='pages'&&args[1]==='deploy'){
  publication={cwd:process.cwd(),args,project:JSON.parse(fs.readFileSync('package.json','utf8')),
    dotenv:fs.readFileSync('.env','utf8'),index:fs.readFileSync(path.join(args[2],'index.html'),'utf8')};
  fs.mkdirSync('.wrangler',{recursive:true});
  fs.writeFileSync('.wrangler/cache.json','fixture');
  if(process.env.SWCL_FIXTURE_RECORD)fs.writeFileSync(process.env.SWCL_FIXTURE_RECORD,JSON.stringify(publication));
}
if(process.env.SWCL_FIXTURE_STATUS){
  fs.writeFileSync(process.env.SWCL_FIXTURE_RECORD,JSON.stringify({name,args,cwd:process.cwd(),
    token:process.env.CLOUDFLARE_API_TOKEN,key:process.env.CLOUDFLARE_API_KEY,email:process.env.CLOUDFLARE_EMAIL,
    aliasToken:process.env.CF_API_TOKEN,aliasKey:process.env.CF_API_KEY,aliasEmail:process.env.CF_EMAIL,
    homedir:require('node:os').homedir(),keyring:process.env.CLOUDFLARE_AUTH_USE_KEYRING,
    dotenv:fs.readFileSync('.env','utf8'),project:JSON.parse(fs.readFileSync('package.json','utf8'))}));
  console.log(process.env.SWCL_FIXTURE_STATUS);process.exit(Number(process.env.SWCL_FIXTURE_EXIT||0));
}
console.log(JSON.stringify({name,args,cwd:process.cwd(),executable:process.execPath,publication,
  path:process.env.PATH??process.env.Path,token:process.env.CLOUDFLARE_API_TOKEN,delegation:process.env.CF_DELEGATION,
  homedir:require('node:os').homedir(),directories:Object.fromEntries(${JSON.stringify(directoryVariables)}
    .map(key=>[key,process.env[key]])),
  key:process.env.CLOUDFLARE_API_KEY,email:process.env.CLOUDFLARE_EMAIL,
  aliasToken:process.env.CF_API_TOKEN,aliasKey:process.env.CF_API_KEY,aliasEmail:process.env.CF_EMAIL,
  keyring:process.env.CLOUDFLARE_AUTH_USE_KEYRING,prefix:process.env.npm_config_prefix}));
console.error('fixture-stderr:'+name);
if(args[0]==='exit')process.exit(Number(args[1]));
if(publication)process.exit(Number(process.env.SWCL_FIXTURE_EXIT||0));
`;
const fakeNpm = `import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('package.json'));
console.log('fixture npm install output');
fs.appendFileSync('.installs.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');
for(const [name,version]of Object.entries(manifest.dependencies)){
  const directory=path.join(root,'node_modules',name);
  const bin=name==='cf'?'bin/cf':'bin/wrangler.js';
  fs.mkdirSync(path.dirname(path.join(directory,bin)),{recursive:true});
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name,version,type:'commonjs',main:bin,bin:{[name]:bin}}));
  fs.writeFileSync(path.join(directory,bin),${JSON.stringify(fakeCli)});
}
`;
function prepareNpm(work,skill) {
  const npm = path.join(work,'npm');
  write(npm,'package.json','{"type":"module"}'); write(npm,'npm-cli.js',fakeNpm);
  writeBindings({schema:'swaw-clouds.bindings/v1',runtime:'node',tools:{
    node:{source:'path',path:process.execPath,version:process.versions.node,npmDirectory:npm}
  }},path.join(skill,'.tools'));
}
function installations(skill,group) {
  const file = path.join(skill,'tasks/cloudflare',group,'.installs.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse) : [];
}

test('native Wrangler reuses its fixed directory, preserves files after failure and accepts explicit native cwd',()=>fixture(async({work,skill,site,temporary,env,cli})=>{
  prepareNpm(work,skill);
  write(site,'package.json','{"private":true,"name":"parent-project"}');
  write(site,'.env','CLOUDFLARE_API_TOKEN=parent-token\n');
  write(site,'public/index.html','fixture static output');
  for(const key of directoryVariables) if(key!=='LOCALAPPDATA')env[key]=path.join(work,'caller',key);
  env.CLOUDFLARE_AUTH_USE_KEYRING='true';
  const originalEnvironment={...env},args=['pages','deploy',path.join(site,'public'),'--project-name','fixture','--branch','preview'];
  const cwd=path.join(temporary,'swaw/clouds/wrangler');
  for(const code of [0,17]) {
    env.SWCL_FIXTURE_EXIT=String(code);
    const result=cli('cloudflare/wrangler',args);
    assert.equal(result.status,code,result.stdout+result.stderr);
    const info=JSON.parse(result.stdout),record=info.publication;
    assert.deepEqual(info.args,args);
    assert.equal(info.token,'fixture-token');assert.equal(info.keyring,'true');
    assert.deepEqual(info.directories,Object.fromEntries(directoryVariables.map(key=>[key,env[key]])));
    assert.equal(record.cwd,cwd);
    assert.deepEqual(record.project,{private:true});assert.equal(record.dotenv,'');assert.equal(record.index,'fixture static output');
    assert.equal(fs.readFileSync(path.join(cwd,'.wrangler/cache.json'),'utf8'),'fixture');
  }
  delete env.SWCL_FIXTURE_EXIT;
  assert.deepEqual(env,originalEnvironment);
  for(const option of [['--cwd',site],['--cwd='+site]]) {
    const result=cli('cloudflare/wrangler',[...option,'whoami']);
    assert.equal(result.status,0,result.stderr);
    const info=JSON.parse(result.stdout);assert.deepEqual(info.args,[...option,'whoami']);assert.equal(info.cwd,fs.realpathSync.native(site));
  }
  assert.equal(installations(skill,'wrangler').length,1);
  assert.deepEqual(fs.readdirSync(path.join(site,'public')),['index.html']);
  assert.equal(fs.existsSync(path.join(site,'.wrangler')),false);
  assert.equal(fs.readFileSync(path.join(site,'.env'),'utf8'),'CLOUDFLARE_API_TOKEN=parent-token\n');
}));

test('Cloudflare commands prepare pinned groups and preserve native storage, arguments and process behavior',()=>fixture(async({work,skill,site,temporary,env,cli})=>{
  prepareNpm(work,skill);
  env.CLOUDFLARE_AUTH_USE_KEYRING='false';env.NPM_CONFIG_PREFIX='fixture-unrelated-prefix';
  for (const key of directoryVariables) if (key!=='LOCALAPPDATA') env[key]=path.join(work,'caller',key);
  const originalEnvironment={...env},originalProcessEnvironment={...process.env};
  write(site,'node_modules/cf/package.json','{"name":"cf","version":"99.0.0","main":"bin/cf"}');
  write(site,'node_modules/cf/bin/cf','console.log("parent-cf-must-not-run");process.exit(88);');
  for (const [name,group] of Object.entries(groups)) {
    const command = 'cloudflare/'+group;
    const root = path.join(skill,'tasks/cloudflare',group);
    const first = cli(command,['--version']);
    assert.equal(first.status,0,first.stdout+first.stderr);
    assert.deepEqual(JSON.parse(first.stdout).args,['--version']);
    assert.match(first.stderr,/fixture npm install output/);
    const ensured = cli(command+'/ensure');
    assert.equal(ensured.status,0,ensured.stdout+ensured.stderr);
    assert.equal(JSON.parse(ensured.stdout).version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).dependencies[name]);
    assert.equal(installations(skill,group).length,1);
    assert.deepEqual(installations(skill,group)[0],['ci','--prefix='+root,'--workspaces=false','--ignore-scripts','--no-audit','--no-fund']);
    assert.equal(cli(command+'/ensure').status,0);
    assert.equal(installations(skill,group).length,1);
    for (const cold of process.platform === 'win32' ? [false,true] : [false]) {
      const help = cli(command,['--help'],cold);
      assert.equal(help.status,0,help.stdout+help.stderr);
      assert.deepEqual(JSON.parse(help.stdout).args,['--help']);
    }
    const args = ['--help','tree 树','','--scope','account:read'];
    const native = cli(command,args);
    assert.equal(native.status,0,native.stdout+native.stderr);
    const info = JSON.parse(native.stdout);
    assert.equal(info.name,name); assert.deepEqual(info.args,args);
    assert.equal(info.cwd,path.join(temporary,'swaw/clouds',name));
    assert.equal(fs.realpathSync.native(info.executable),fs.realpathSync.native(process.execPath));
    assert.equal(info.path.split(path.delimiter)[0],path.dirname(process.execPath));
    assert.equal(info.token,'fixture-token');
    assert.deepEqual(info.directories,Object.fromEntries(directoryVariables.map(key=>[key,env[key]])));
    assert.equal(info.homedir,process.platform==='win32' ? env.USERPROFILE : env.HOME);
    assert.equal(info.keyring,'false');
    if (name === 'cf') assert.equal(info.delegation,'1');
    if (process.platform==='win32') assert.equal(info.prefix,root+path.sep);
    assert.equal(native.stderr.trim(),'fixture-stderr:'+name);
    const exit = cli(command,['exit','17']);
    assert.equal(exit.status,17,exit.stdout+exit.stderr);
    assert.equal(cli(command+'/check').status,0);
    assert.equal(installations(skill,group).length,1);
    const forced = cli(command+'/ensure',['--force']);
    assert.equal(forced.status,0,forced.stdout+forced.stderr);
    assert.equal(JSON.parse(forced.stdout).tool,name); assert.match(forced.stderr,/fixture npm install output/);
    assert.equal(installations(skill,group).length,2);
  }
  assert.equal(fs.existsSync(path.join(skill,'node_modules')),false);
  assert.deepEqual(fs.readdirSync(site),['node_modules']);
  assert.deepEqual(env,originalEnvironment);
  assert.deepEqual({...process.env},originalProcessEnvironment);
}));

test('page login prepares native tools, strips API credentials and preserves native storage options',()=>fixture(async({work,skill,site,temporary,env})=>{
  prepareNpm(work,skill);
  const entry = path.join(work,'page-login.mjs');
  write(work,'page-login.mjs',`import {login} from ${JSON.stringify(pathToFileURL(path.join(skill,'tasks/auth/login.mjs')).href)};
await login(process.argv[2]);`);
  const environment = {...env,CLOUDFLARE_API_KEY:'fixture-api-key',CLOUDFLARE_EMAIL:'fixture-email',cloudflare_api_token:'fixture-lowercase-token',
    CF_API_TOKEN:'fixture-alias-token',CF_API_KEY:'fixture-alias-key',CF_EMAIL:'fixture-alias-email',
    CLOUDFLARE_AUTH_USE_KEYRING:'false',NPM_CONFIG_PREFIX:'fixture-unrelated-prefix'};
  for (const [tool,args] of [['cf',['auth','login']],['wrangler',['login']]]) {
    const result = spawnSync(process.execPath,[entry,tool],{cwd:site,env:environment,encoding:'utf8',timeout:15000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
    const record = JSON.parse(result.stderr.split(/\r?\n/).find(line=>line.startsWith('{"name":')));
    assert.deepEqual(record.args,args);assert.equal(record.token,undefined);assert.equal(record.key,undefined);assert.equal(record.email,undefined);
    for (const key of ['aliasToken','aliasKey','aliasEmail']) assert.equal(record[key],undefined);
    assert.equal(record.cwd,path.join(temporary,'swaw/clouds',tool));assert.equal(fs.existsSync(record.cwd),true);
    assert.equal(record.keyring,'false');
    if (process.platform==='win32') assert.equal(record.prefix,path.join(skill,'tasks/cloudflare',groups[tool])+path.sep);
    if (tool==='cf') assert.equal(record.delegation,'1');
    assert.equal(installations(skill,groups[tool]).length,1);
  }
  const invalid = spawnSync(process.execPath,[entry,'node'],{cwd:site,env:environment,encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/invalid_login_tool/);
}));

test('native sign-in checks distinguish OAuth from API credentials without reading the vault or project environment',()=>fixture(async({work,skill,site,temporary,env,cli})=>{
  prepareNpm(work,skill);
  for (const group of Object.values(groups)) assert.equal(cli('cloudflare/'+group+'/ensure').status,0);
  write(site,'.env','CLOUDFLARE_API_TOKEN=project-token\n');
  write(skill,'tasks/_shared/cloud/credential.ps1','throw "native sign-in checks must not read the vault"');
  const recordFile=path.join(work,'status-record.json');
  write(work,'status.mjs',`import {check} from ${JSON.stringify(pathToFileURL(path.join(skill,'tasks/auth/status.mjs')).href)};
const controller=new AbortController();if(process.argv[3]==='abort')controller.abort();
console.log(await check(process.argv[2],{signal:controller.signal}));`);
  const environment={...env,CLOUDFLARE_API_KEY:'fixture-key',CLOUDFLARE_EMAIL:'fixture-email',CLOUDFLARE_AUTH_USE_KEYRING:'false',
    CF_API_TOKEN:'fixture-alias-token',CF_API_KEY:'fixture-alias-key',CF_EMAIL:'fixture-alias-email',
    SWCL_FIXTURE_RECORD:recordFile};
  const cases=[
    ['cf',{authenticated:true,tokenValid:true,authSource:'OAuth token from fixture'},0,'authorized'],
    ['cf',{authenticated:false},0,'notAuthorized'],
    ['cf',{authenticated:true,tokenValid:false,authSource:'OAuth token from fixture'},0,'unavailable'],
    ['cf',{authenticated:true,tokenValid:true,authSource:'API token from environment'},0,'unavailable'],
    ['wrangler',{loggedIn:true,authType:'OAuth Token'},0,'authorized'],
    ['wrangler',{loggedIn:false},1,'notAuthorized'],
    ['wrangler',{loggedIn:true,authType:'API Token'},0,'unavailable'],
    ['wrangler','not JSON',0,'unavailable']
  ];
  for (const [tool,data,code,expected] of cases) {
    const result=spawnSync(process.execPath,[path.join(work,'status.mjs'),tool],{cwd:site,
      env:{...environment,SWCL_FIXTURE_STATUS:typeof data==='string'?data:JSON.stringify(data),SWCL_FIXTURE_EXIT:String(code)},
      encoding:'utf8',timeout:10000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),expected);assert.equal(result.stderr,'');
    const record=JSON.parse(fs.readFileSync(recordFile,'utf8'));
    assert.deepEqual(record.args,tool==='cf'?['auth','whoami','--profile','default']:['whoami','--json']);
    for (const key of ['token','key','email','aliasToken','aliasKey','aliasEmail']) assert.equal(record[key],undefined);
    assert.equal(record.keyring,'false');assert.equal(record.homedir,process.platform==='win32'?env.USERPROFILE||process.env.USERPROFILE:env.HOME);
    assert.equal(record.dotenv,'');assert.deepEqual(record.project,tool==='cf'?{private:true,type:'module'}:{private:true});
    assert.equal(record.cwd,path.join(temporary,'swaw/clouds',tool));assert.equal(fs.existsSync(record.cwd),true);
  }
  fs.unlinkSync(recordFile);
  for (const [tool,mode] of [['tccli',''],['cf','abort']]) {
    const result=spawnSync(process.execPath,[path.join(work,'status.mjs'),tool,mode],{cwd:site,env:environment,encoding:'utf8',timeout:5000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'unavailable');
    assert.equal(fs.existsSync(recordFile),false);
  }
}));

test('Cloudflare checks do not require Node bindings, execute package code or repair damaged entries',()=>fixture(async({work,skill,cli})=>{
  prepareNpm(work,skill);
  for (const [name,group] of Object.entries(groups)) {
    const ensured = cli('cloudflare/'+group+'/ensure');
    assert.equal(ensured.status,0,ensured.stdout+ensured.stderr);
    assert.equal(JSON.parse(ensured.stdout).tool,name); assert.match(ensured.stderr,/fixture npm install output/);
  }
  fs.rmSync(path.join(skill,'.tools'),{recursive:true,force:true});
  const {inspectCli} = await import(pathToFileURL(path.join(skill,'tasks/cloudflare/_shared/runtime.mjs')).href);
  for (const [name,group] of Object.entries(groups)) {
    const record = inspectCli(name),entry = fs.readFileSync(record.path);
    fs.writeFileSync(record.path,'throw new Error("check must not execute package code");');
    const checked = cli('cloudflare/'+group+'/check');
    assert.equal(checked.status,0,checked.stdout+checked.stderr);
    assert.equal(JSON.parse(checked.stdout).version,record.version);
    assert.equal(fs.existsSync(path.join(skill,'.tools')),false);
    fs.unlinkSync(record.path);
    const damaged = cli('cloudflare/'+group+'/check');
    assert.equal(damaged.status,1); assert.match(damaged.stderr,/cloudflare\/.+\/ensure/);
    assert.equal(fs.existsSync(record.path),false); assert.equal(installations(skill,group).length,1);
    fs.writeFileSync(record.path,entry);
  }
}));

test('native entries load a manually added default Token while local checks and OAuth remain independent',()=>fixture(async({work,skill,env,cli})=>{
  prepareNpm(work,skill);
  delete env.CLOUDFLARE_API_TOKEN;
  write(skill,'tasks/_shared/cloud/credential.ps1',`param([string]$Action,[string]$Target)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
if ($Target -ne 'swcl/cloudflare/default') {exit 2}
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture-calls.txt') -Value $Action
if ($Action -eq 'read') {[Console]::WriteLine('{"secret":"manual-fixture-token","userName":"${'a'.repeat(32)}"}')}
else {[Console]::WriteLine('{"userName":"${'a'.repeat(32)}"}')}
`);
  const bridge = path.join(skill,'tasks/_shared/cloud/fixture-calls.txt');
  for (const group of Object.values(groups)) {
    for (const args of [['zones','list'],group === 'cli' ? ['auth','whoami'] : ['whoami']]) {
      const result = cli('cloudflare/'+group,args);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(JSON.parse(result.stdout).token,'manual-fixture-token');
    }
  }
  assert.deepEqual(fs.readFileSync(bridge,'utf8').trim().split(/\r?\n/),['read','read','read','read']);
  fs.rmSync(path.join(skill,'.tools'),{recursive:true,force:true});
  const checked = cli('cloudflare/auth/token/check');
  assert.equal(checked.status,0,checked.stdout+checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout),{target:'swcl/cloudflare/default',present:true,accountId:'a'.repeat(32)});
  assert.equal(fs.existsSync(path.join(skill,'.tools')),false);
  prepareNpm(work,skill);
  for (const [group,args] of [['cli',['auth','login']],['wrangler',['login']]]) {
    const result = cli('cloudflare/'+group,args);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout).token,undefined);
  }
  assert.deepEqual(fs.readFileSync(bridge,'utf8').trim().split(/\r?\n/),['read','read','read','read','check']);
}));

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {definition} from '../../../_shared/tools/manifest.mjs';
import {writeBindings} from '../../../_shared/tools/bindings.mjs';
import {inspectCli} from '../runtime.mjs';

import {fixture,write,installation,version} from './fixture.mjs';
test('Tencent metadata help, cold checks and invalid ensures never prepare tools',()=>fixture(async({root,cli})=>{
  for (const cold of process.platform==='win32' ? [false,true] : [false]) {
    for (const suffix of ['', '/ensure','/check']) {
      const command = 'tencent/cli'+suffix;
      const help = cli('help/en',[command],cold);
      assert.equal(help.status,0,help.stderr);assert.ok(help.stdout.includes('swcl '+command));
      if (suffix) assert.equal(cli(command,['--help'],cold).status,0);
    }
    const missing = cli('tencent/cli/check',[],cold);
    assert.equal(missing.status,1);assert.match(missing.stderr,cold ? /runtime_not_ready|tccli_installation_unusable/ : /tccli_installation_unusable/);
    for (const args of [['--unknown'],['--force','--force']]) {
      const invalid = cli('tencent/cli/ensure',args,cold);
      assert.equal(invalid.status,1);assert.match(invalid.stderr,/invalid_ensure_arguments/);
    }
    const listed = cli('help/en',['tencent','2'],cold);
    assert.equal(listed.status,0,listed.stderr);
    for (const suffix of ['', '/check','/ensure']) assert.ok(listed.stdout.includes('tencent/cli'+suffix));
    assert.equal(fs.existsSync(root),false);
  }
}));


test('Tencent key checks report absence as failure without preparing tools or reading secrets',()=>fixture(async({skill,root,cli})=>{
  const bridge = path.join(skill,'tasks/_shared/cloud/credential.ps1');
  for (const record of [null,{userName:'fixture-secret-id'}]) {
    fs.writeFileSync(bridge,`param([string]$Action,[string]$Target)
if ($Action -ne 'check' -or $Target -ne 'swcl/tencent/default') {exit 2}
[Console]::WriteLine('${JSON.stringify(record)}')
`);
    const result = cli('tencent/auth/key/check');
    assert.equal(result.status,record?0:1,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{target:'swcl/tencent/default',present:!!record});
    assert.equal(result.stderr,'');
  }
  fs.writeFileSync(bridge,'exit 2');
  const failed = cli('tencent/auth/key/check');
  assert.equal(failed.status,1);assert.match(failed.stderr,/credential_store_failed/);assert.equal(failed.stdout,'');
  const help = cli('tencent/auth/key/check',['--help']);
  assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/swcl tencent\/auth\/key\/check/);
  const invalid = cli('tencent/auth/key/check',['--unexpected']);
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/unexpected_arguments/);
  assert.equal(fs.existsSync(root),false);
}));

test('Tencent checks inspect local metadata and Python ownership without executing or repairing files',()=>fixture(async({root,cli})=>{
  const {home,base,executable} = installation(root);
  write(root,'bindings.json','invalid bindings must not be read by checks');
  assert.deepEqual(inspectCli({root}),{tool:'tccli',version,path:executable});
  const checked = cli('tencent/cli/check');
  assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).version,version);
  assert.equal(fs.existsSync(path.join(root,'.cache')),false);
  const metadata = path.join(home,'Lib/site-packages/tccli-'+version+'.dist-info/METADATA');
  const config = path.join(home,'pyvenv.cfg'),metadataText = fs.readFileSync(metadata),configText = fs.readFileSync(config);
  const alias = path.join(root,'python/cpython-3.13-alias');
  fs.symlinkSync(base,alias,'junction');
  fs.writeFileSync(config,configText.toString().replace(base,alias));
  assert.equal(inspectCli({root}).version,version);
  const escaped = path.join(root,'python/outside');
  fs.symlinkSync(path.dirname(root),escaped,'junction');
  fs.writeFileSync(config,configText.toString().replace(base,escaped));
  assert.throws(()=>inspectCli({root}),/tccli_installation_unusable/);
  fs.writeFileSync(config,configText);
  for (const [file,text] of [[metadata,'Name: tccli\nVersion: 0.0.0\n'],[config,'home = '+base+'\nversion_info = 3.9.1\n'],
    [config,'home = '+path.dirname(root)+'\nversion_info = 3.13.12\ninclude-system-site-packages = false\n']]) {
    fs.writeFileSync(file,text);assert.throws(()=>inspectCli({root}),/tccli_installation_unusable/);
    assert.equal(cli('tencent/cli/check').status,1);assert.equal(fs.readFileSync(file,'utf8'),text);
    fs.writeFileSync(metadata,metadataText);fs.writeFileSync(config,configText);
  }
  fs.unlinkSync(executable);assert.throws(()=>inspectCli({root}),/tccli_installation_unusable/);
  assert.equal(fs.existsSync(executable),false);assert.equal(fs.existsSync(path.join(root,'.cache')),false);
}));

test('Tencent native authorization checks verify STS identity with the selected profile and no environment or vault identity',async t=>fixture(async({work,skill,root})=>{
  const {home}=installation(root),python=path.join(home,'Scripts/python.exe');
  const launcher=path.join(skill,'tasks/tencent/cli/cli.py'),cwd=path.join(work,'swaw/clouds/tccli'),originalCwd=process.cwd(),calls=[];
  write(skill,'tasks/_shared/cloud/credential.ps1','throw "status checks must not read the vault"');
  const environment={...process.env,USERPROFILE:path.join(work,'native home'),HOME:path.join(work,'native home'),
    TENCENTCLOUD_SECRET_ID:'private-id',TENCENTCLOUD_SECRET_KEY:'private-key',TENCENTCLOUD_TOKEN:'private-token',
    TENCENTCLOUD_ROLE_ARN:'private-role',TKE_ROLE_ARN:'private-tke-role',CLOUDFLARE_API_TOKEN:'private-cf-token',PYTHONPATH:work,
    TEMP:path.join(work,'child temp'),TMP:path.join(work,'child temp'),TMPDIR:path.join(work,'child temp')};
  const originalSpawn=childProcess.spawn;
  let output='',code=0;
  const mocked=t.mock.method(childProcess,'spawn',(file,args,options)=>{
    if(file!==python)return originalSpawn(file,args,options);
    calls.push({args,options});
    assert.equal(options.cwd,cwd);assert.deepEqual(fs.readdirSync(options.cwd),[]);
    return originalSpawn(process.execPath,['-e',"console.log(process.argv[1]);console.error('private-cli-error');process.exit(Number(process.argv[2]));",output,String(code)],options);
  });
  syncBuiltinESMExports();
  try {
    const {check}=await import(pathToFileURL(path.join(skill,'tasks/auth/status.mjs')).href);
    for(const [data,exit,expected] of [
      [{AccountId:'12345',UserId:'67890',Type:'CAMUser'},0,'authorized'],
      [{AccountId:'12345'},0,'unavailable'],
      [{AccountId:'',UserId:'67890'},0,'unavailable'],
      [{AccountId:'12345',UserId:'67890',Error:{Message:'private-error'}},0,'unavailable'],
      [{AccountId:'12345',UserId:'67890'},255,'unavailable'],
      ['not JSON',0,'unavailable']
    ]) {
      output=typeof data==='string'?data:JSON.stringify(data);code=exit;
      assert.equal(await check('tccli',{environment}),expected);
      const {args,options}=calls.at(-1);
      assert.deepEqual(args,['-I','-B','-X','utf8',launcher,'sts','GetCallerIdentity','--profile','default',
        '--region','ap-guangzhou','--endpoint','sts.tencentcloudapi.com','--output','json','--filter','@','--timeout','12']);
      for(const key of ['TENCENTCLOUD_SECRET_ID','TENCENTCLOUD_SECRET_KEY','TENCENTCLOUD_TOKEN','TENCENTCLOUD_ROLE_ARN','TKE_ROLE_ARN','CLOUDFLARE_API_TOKEN','PYTHONPATH'])
        assert.equal(options.env[key],undefined);
      assert.equal(options.env.USERPROFILE,environment.USERPROFILE);assert.equal(options.env.HOME,environment.HOME);
      assert.equal(options.env.VIRTUAL_ENV,home);assert.equal(options.cwd,cwd);
      assert.equal(fs.existsSync(options.cwd),true);assert.equal(process.cwd(),originalCwd);
    }
    output=JSON.stringify({AccountId:'12345',UserId:'67890'});code=0;
    assert.equal(await check('tccli',{environment:{...environment,TCCLI_PROFILE:'team'}}),'authorized');
    assert.equal(calls.at(-1).args[calls.at(-1).args.indexOf('--profile')+1],'team');
    const before=calls.length,controller=new AbortController();controller.abort();
    assert.equal(await check('tccli',{environment,signal:controller.signal}),'unavailable');assert.equal(calls.length,before);
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
}));

test('Tencent preparation reuses isolation, repairs damage and forwards native arguments and exit codes',async t=>fixture(async({work,skill,site,root})=>{
  const uv = path.join(work,'uv.exe'),native = path.join(root,'python-tools/tccli/Scripts/tccli.exe');
  const python = path.join(path.dirname(native),'python.exe'),launcher = path.join(skill,'tasks/tencent/cli/cli.py');
  write(work,'uv.exe','uv fixture');
  const uvVersion = definition('uv').version;
  writeBindings({schema:'swaw-clouds.bindings/v1',tools:{uv:{source:'path',path:uv,version:uvVersion}}},root);
  const originalSpawn = childProcess.spawn,originalCwd = process.cwd(),cwd=path.join(work,'swaw/clouds/tccli'),calls = [];
  const variables = {USERPROFILE:path.join(work,'caller home'),HOME:path.join(work,'caller home'),TENCENTCLOUD_SECRET_ID:'fixture-id',TENCENTCLOUD_SECRET_KEY:'fixture-key',UV_CONFIG_FILE:path.join(site,'uv.toml'),PYTHONPATH:site};
  const saved = Object.fromEntries(Object.keys(variables).map(key=>[key,process.env[key]]));
  let installs = 0,failInstall = false;
  const mocked = t.mock.method(childProcess,'spawn',(file,args,options)=>{
    if (file === uv) {
      if (args[0] === '--version') return originalSpawn(process.execPath,['-e',`console.log('uv ${uvVersion}')`],options);
      installs++;assert.deepEqual(args,['tool','install','--quiet','--python','3.13','--reinstall','--force','tccli=='+version]);
      assert.equal(options.env.UV_NO_CONFIG,'1');assert.equal(options.env.UV_CONFIG_FILE,undefined);
      assert.ok(options.env.UV_TOOL_DIR.startsWith(root+path.sep));
      assert.deepEqual(options.stdio,['inherit',2,2]);
      if (!failInstall) installation(root);
      return originalSpawn(process.execPath,['-e','process.exit('+ (failInstall ? 23 : 0)+')'],options);
    }
    if (file === python) {
      assert.deepEqual(args.slice(0,5),['-I','-B','-X','utf8',launcher]);
      args = args.slice(5);
      const output = args[0]==='sts' ? 'console.log(JSON.stringify({AccountId:"12345",UserId:"67890"}));' : '';
      calls.push({args,options});return originalSpawn(process.execPath,['-e',output+'process.exit('+(args[0]==='exit'?17:0)+')'],options);
    }
    return originalSpawn(file,args,options);
  });
  syncBuiltinESMExports();
  try {
    Object.assign(process.env,variables);process.chdir(site);
    const {prepareCli,runCli} = await import(pathToFileURL(path.join(skill,'tasks/tencent/cli/runtime.mjs')).href);
    assert.equal((await prepareCli()).action,'installed');assert.equal(installs,1);
    assert.deepEqual((await Promise.all([prepareCli(),prepareCli()])).map(value=>value.action),['reused','reused']);assert.equal(installs,1);
    const args = ['teo','DescribeZones','--cli-input-json','file://input 树.json',''];
    assert.equal(await runCli(args),0);assert.deepEqual(calls[0].args,args);
    assert.equal(calls[0].options.cwd,cwd);assert.equal(calls[0].options.stdio,'inherit');
    assert.deepEqual(fs.readdirSync(cwd),[]);assert.equal(process.cwd(),site);
    assert.equal(calls[0].options.env.TENCENTCLOUD_SECRET_ID,'fixture-id');assert.equal(calls[0].options.env.PYTHONPATH,undefined);
    assert.equal(calls[0].options.env.VIRTUAL_ENV,path.dirname(path.dirname(native)));
    assert.equal(calls[0].options.env.USERPROFILE,variables.USERPROFILE);assert.equal(calls[0].options.env.HOME,variables.HOME);
    assert.equal(process.env.USERPROFILE,variables.USERPROFILE);assert.equal(process.env.HOME,variables.HOME);
    assert.equal(await runCli(['exit']),17);
    assert.equal(calls.at(-1).options.cwd,cwd);
    assert.equal(await runCli(['version'],{cwd:site}),0);assert.equal(calls.at(-1).options.cwd,site);
    const {login} = await import(pathToFileURL(path.join(skill,'tasks/auth/login.mjs')).href);
    const signal = new AbortController().signal;
    await login('tccli',{signal,environment:{...process.env,TCCLI_PROFILE:'other',TENCENTCLOUD_TOKEN:'fixture-sts',TENCENTCLOUD_ROLE_ARN:'fixture-role',TKE_ROLE_ARN:'fixture-tke-role',CLOUDFLARE_API_TOKEN:'fixture-cf'}});
    const authorized = calls.at(-1);
    assert.deepEqual(authorized.args,['auth','login','--profile','other']);assert.deepEqual(authorized.options.stdio,['inherit',2,2]);
    assert.equal(authorized.options.cwd,cwd);assert.deepEqual(fs.readdirSync(cwd),[]);assert.equal(process.cwd(),site);
    assert.equal(authorized.options.env.USERPROFILE,variables.USERPROFILE);assert.equal(authorized.options.env.HOME,variables.HOME);
    assert.equal(authorized.options.env.TCCLI_PROFILE,'other');
    for (const key of ['TENCENTCLOUD_SECRET_ID','TENCENTCLOUD_SECRET_KEY','TENCENTCLOUD_TOKEN','TENCENTCLOUD_ROLE_ARN','TKE_ROLE_ARN','CLOUDFLARE_API_TOKEN']) assert.equal(authorized.options.env[key],undefined);
    const {check} = await import(pathToFileURL(path.join(skill,'tasks/auth/status.mjs')).href);
    assert.equal(await check('tccli'),'authorized');assert.equal(calls.at(-1).options.cwd,cwd);
    assert.deepEqual(fs.readdirSync(cwd),[]);assert.equal(process.cwd(),site);
    const controller = new AbortController();controller.abort();
    const before = calls.length;await assert.rejects(runCli(['auth','login'],{signal:controller.signal}),/abort/i);assert.equal(calls.length,before);
    assert.equal((await prepareCli({force:true})).action,'installed');assert.equal(installs,2);
    fs.unlinkSync(native);assert.equal((await prepareCli()).action,'installed');assert.equal(installs,3);
    failInstall = true;await assert.rejects(prepareCli({force:true}),/tccli_installation_failed:23/);
    assert.equal(inspectCli({root}).version,version);assert.equal(fs.existsSync(path.join(root,'.cache/install.lock')),false);
  } finally {
    mocked.mock.restore();syncBuiltinESMExports();process.chdir(originalCwd);
    for (const [key,value] of Object.entries(saved)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
}));

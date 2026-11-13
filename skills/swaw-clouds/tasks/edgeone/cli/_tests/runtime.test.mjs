import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,write} from '../../../_shared/_tests/fixture.mjs';
import {writeBindings} from '../../../_shared/tools/bindings.mjs';

test('EdgeOne metadata, read-only checks and invalid ensures do not install packages',()=>fixture(async({skill,cli})=>{
  for (const cold of process.platform==='win32'?[false,true]:[false]) {
    for (const command of ['edgeone/cli','edgeone/cli/ensure','edgeone/cli/check']) {
      const result=cli('help/en',[command],cold);assert.equal(result.status,0,result.stderr);
    }
    for (const command of ['edgeone/cli/ensure','edgeone/cli/check']) {
      const result=cli(command,['--help'],cold);assert.equal(result.status,0,result.stderr);
    }
    const check=cli('edgeone/cli/check',[],cold);assert.equal(check.status,1);
    assert.match(check.stderr,/runtime_not_ready|edgeone\/cli\/ensure/);
    for (const args of [['--unknown'],['--force','--force']]) {
      const result=cli('edgeone/cli/ensure',args,cold);assert.equal(result.status,1);assert.match(result.stderr,/invalid_ensure_arguments/);
    }
    assert.equal(fs.existsSync(path.join(skill,'.tools')),false);
    assert.equal(fs.existsSync(path.join(skill,'tasks/edgeone/cli/node_modules')),false);
  }
}));

test('EdgeOne prepares pinned packages, preserves cwd, arguments, identity and exit status',()=>fixture(async({work,skill,site,env,cli})=>{
  const npm=path.join(work,'npm'),root=path.join(skill,'tasks/edgeone/cli');
  const fake=`console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.USERPROFILE,token:process.env.EDGEONE_PAGES_API_TOKEN}));console.error('fixture-stderr');process.exit(Number(process.env.SWCL_FIXTURE_EXIT||0));`;
  write(npm,'package.json','{"type":"module"}');
  write(npm,'npm-cli.js',`import fs from 'node:fs';import path from 'node:path';
const root=process.argv.find(a=>a.startsWith('--prefix=')).slice(9),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).dependencies.edgeone;
fs.appendFileSync(path.join(root,'installs.txt'),'install\\n');
const dir=path.join(root,'node_modules/edgeone');fs.mkdirSync(path.join(dir,'edgeone-bin'),{recursive:true});
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version,main:'edgeone-bin/edgeone.js'}));
fs.writeFileSync(path.join(dir,'edgeone-bin/edgeone.js'),${JSON.stringify(fake)});`);
  writeBindings({schema:'swaw-clouds.bindings/v1',runtime:'node',tools:{node:{source:'path',path:process.execPath,version:process.versions.node,npmDirectory:npm}}},path.join(skill,'.tools'));
  env.USERPROFILE=path.join(work,'native identity');env.EDGEONE_PAGES_API_TOKEN='fixture-token';
  write(site,'.edgeone/project.json','{"projectId":"fixture"}');
  const original={...env};
  for (const args of [['--help'],['whoami'],['makers','deploy','./output with spaces','-n','fixture','-e','preview']]) {
    env.SWCL_FIXTURE_EXIT='17';const result=cli('edgeone/cli',args);
    assert.equal(result.status,17,result.stderr);assert.match(result.stderr,/fixture-stderr/);
    assert.deepEqual(JSON.parse(result.stdout),{args,cwd:fs.realpathSync.native(site),home:env.USERPROFILE,token:'fixture-token'});
  }
  delete env.SWCL_FIXTURE_EXIT;assert.deepEqual(env,original);
  assert.equal(fs.readFileSync(path.join(root,'installs.txt'),'utf8'),'install\n');
  assert.equal(fs.readFileSync(path.join(site,'.edgeone/project.json'),'utf8'),'{"projectId":"fixture"}');
  assert.equal(cli('edgeone/cli/check').status,0);
  const entry=path.join(root,'node_modules/edgeone/edgeone-bin/edgeone.js');fs.unlinkSync(entry);
  const missing=cli('edgeone/cli/check');assert.equal(missing.status,1);assert.equal(fs.existsSync(entry),false);
  const repair=cli('edgeone/cli/ensure',['--force']);assert.equal(repair.status,0,repair.stderr);
  assert.equal(fs.readFileSync(path.join(root,'installs.txt'),'utf8'),'install\ninstall\n');
}));

test('EdgeOne cancellation before preparation leaves installation untouched',()=>fixture(async({skill})=>{
  const {runCli}=await import(pathToFileURL(path.join(skill,'tasks/edgeone/cli/runtime.mjs')).href);
  const controller=new AbortController();controller.abort();
  await assert.rejects(runCli(['whoami'],{signal:controller.signal}),/abort/i);
  assert.equal(fs.existsSync(path.join(skill,'tasks/edgeone/cli/node_modules')),false);
}));

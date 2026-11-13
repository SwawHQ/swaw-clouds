import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {fixture,write} from '../../_tests/fixture.mjs';
test('cloud working directories initialize atomically and reject changed boundaries or links',()=>fixture(async({work,skill,temporary,env})=>{
  const module=pathToFileURL(path.join(skill,'tasks/_shared/cloud/working-directory.mjs')).href;
  const source=`import {workingDirectory} from ${JSON.stringify(module)};console.log(workingDirectory(process.argv[1]));`;
  const root=path.join(temporary,'swaw/clouds');
  const files={wrangler:{'package.json':'{"private":true}\n','.env':''},
    cf:{'package.json':'{"private":true,"type":"module"}\n','cloudflare.config.ts':'export default {};\n','.env':''},tccli:{}};
  for(const [tool,contents] of Object.entries(files)) {
    const results=await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',source,tool],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
      child.once('error',reject);child.once('close',code=>code===0?resolve(output.trim()):reject(new Error(error)));
    })));
    const cwd=path.join(root,tool);
    assert.deepEqual(results,Array(4).fill(cwd));
    assert.deepEqual(fs.readdirSync(cwd).sort(),Object.keys(contents).sort());
    for(const [name,content] of Object.entries(contents))assert.equal(fs.readFileSync(path.join(cwd,name),'utf8'),content);
  }
  assert.deepEqual(fs.readdirSync(root).sort(),Object.keys(files).sort());
  for(const [tool,file] of [['wrangler','.env'],['cf','cloudflare.config.ts']]) {
    write(path.join(root,tool),file,'fixture must not be overwritten');
    const damaged=spawnSync(process.execPath,['--input-type=module','-e',source,tool],{env,encoding:'utf8',timeout:5000,windowsHide:true});
    assert.ifError(damaged.error);assert.equal(damaged.status,1);assert.match(damaged.stderr,new RegExp('Invalid '+tool+' working file'));
    assert.equal(fs.readFileSync(path.join(root,tool,file),'utf8'),'fixture must not be overwritten');
  }
  const invalid=spawnSync(process.execPath,['--input-type=module','-e',source,'../escape'],{env,encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/invalid_cloud_tool/);assert.equal(fs.existsSync(path.join(root,'../escape')),false);
  fs.rmdirSync(path.join(root,'tccli'));
  const outside=path.join(work,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'tccli'),'junction');
  const linked=spawnSync(process.execPath,['--input-type=module','-e',source,'tccli'],{env,encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(linked.status,1);assert.match(linked.stderr,/linked_path/);assert.deepEqual(fs.readdirSync(outside),[]);
}));

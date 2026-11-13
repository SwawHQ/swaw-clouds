import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {fixture,write} from '../../_shared/_tests/fixture.mjs';
test('authorization preparation runs only the selected tool ensure and supports cancellation',()=>fixture(async({work,skill,env})=>{
  const tools={cf:'cloudflare/cli',wrangler:'cloudflare/wrangler',tccli:'tencent/cli',edgeone:'edgeone/cli'};
  for(const [tool,directory] of Object.entries(tools))write(skill,'tasks/'+directory+'/ensure/entry.mjs',
    `console.log(JSON.stringify({tool:${JSON.stringify(tool)},args:process.argv.slice(2)}));`);
  const entry=path.join(work,'prepare.mjs');
  write(work,'prepare.mjs',`import {prepare} from ${JSON.stringify(pathToFileURL(path.join(skill,'tasks/auth/login.mjs')).href)};
const controller=new AbortController();if(process.argv[3]==='abort')controller.abort();
try{await prepare(process.argv[2],{signal:controller.signal});}catch(error){console.error(error.message);process.exitCode=1;}`);
  for(const tool of Object.keys(tools)) {
    const result=spawnSync(process.execPath,[entry,tool],{env,encoding:'utf8',timeout:5000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{tool,args:[]});
  }
  for(const [tool,mode,message] of [['node','','invalid_login_tool'],['tccli','abort','abort']]) {
    const result=spawnSync(process.execPath,[entry,tool,mode],{env,encoding:'utf8',timeout:5000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,new RegExp(message,'i'));
  }
}));

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {fixture,write} from '../../../_shared/_tests/fixture.mjs';
import {writeBindings} from '../../../_shared/tools/bindings.mjs';

test('EdgeOne native checks exclude API Tokens and distinguish unauthenticated from failures',async t=>fixture(async({work,skill})=>{
  const root=path.join(skill,'tasks/edgeone/cli'),manifest=fs.readFileSync(path.join(root,'package.json')),lock=fs.readFileSync(path.join(root,'package-lock.json'));
  const version=JSON.parse(manifest).dependencies.edgeone;
  write(root,'node_modules/edgeone/package.json',JSON.stringify({version,main:'edgeone-bin/edgeone.js'}));
  write(root,'node_modules/edgeone/edgeone-bin/edgeone.js','throw new Error("must be mocked");');
  write(root,'node_modules/.swcl-packages.json',JSON.stringify({fingerprint:createHash('sha256').update(manifest).update(lock).digest('hex')}));
  writeBindings({schema:'swaw-clouds.bindings/v1',runtime:'node',tools:{node:{source:'path',path:process.execPath,version:process.versions.node}}},path.join(skill,'.tools'));
  const spawn=childProcess.spawn;let output,code=0;
  const mocked=t.mock.method(childProcess,'spawn',(file,args,options)=>{
    assert.equal(file,process.execPath);assert.deepEqual(args.slice(1),['whoami','--json']);
    assert.ok(!Object.keys(options.env).some(k=>/^EDGEONE_PAGES_/i.test(k)));
    assert.equal(options.cwd,process.cwd());assert.equal(options.env.HOME,work);
    return spawn(process.execPath,['-e',`console.log(${JSON.stringify(output)});process.exit(${code});`],options);
  });syncBuiltinESMExports();
  try {
    const {check}=await import(pathToFileURL(path.join(skill,'tasks/auth/status.mjs')).href);
    const environment={...process.env,HOME:work,EDGEONE_PAGES_API_TOKEN:'private',EDGEONE_PAGES_API_REGION:'china'};
    for(const [data,exit,expected] of [
      [{status:'success',authenticated:true,workspaceName:'Team',workspaceId:'w',token:'private'},0,{status:'authorized',workspaceName:'Team',workspaceId:'w'}],
      [{status:'unauthenticated',authenticated:false},1,'notAuthorized'],
      [{status:'error',authenticated:null,message:'private'},1,'unavailable'],
      [{status:'success',authenticated:true},1,'unavailable']
    ]){output=JSON.stringify(data);code=exit;assert.deepEqual(await check('edgeone',{environment}),expected);}
    output='not-json';assert.equal(await check('edgeone',{environment}),'unavailable');
  }finally{mocked.mock.restore();syncBuiltinESMExports();}
}));

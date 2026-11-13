import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,write} from '../../_shared/_tests/fixture.mjs';
import {writeBindings} from '../../_shared/tools/bindings.mjs';
import {startAuthPage} from '../page.mjs';

test('Workspace adapter filters output, preserves native identity and validates switch targets',()=>fixture(async({skill,work})=>{
  write(skill,'tasks/auth/status.mjs',"export async function check(){return {status:'authorized'};}");
  const fake=path.join(work,'workspace.cjs');
  write(work,'workspace.cjs',`const assert=require('node:assert/strict');assert.deepEqual(process.argv.slice(2),['workspace','ls','--json']);assert.equal(process.env.EDGEONE_PAGES_API_TOKEN,undefined);console.log(JSON.stringify({workspaces:[{id:'zone-one',name:'Same',current:true,available:true,token:'private'},{id:'zone-two',name:'Same',available:false},{id:'--bad',name:'bad',available:true}]}));`);
  write(skill,'tasks/edgeone/cli/runtime.mjs',`export const calls=[];export function inspectCli(){return {path:${JSON.stringify(fake)}};}export async function runCli(args,options){calls.push({args,options});return 0;}`);
  writeBindings({schema:'swaw-clouds.bindings/v1',runtime:'node',tools:{node:{source:'path',path:process.execPath,version:process.versions.node}}},path.join(skill,'.tools'));
  const {list,use}=await import(pathToFileURL(path.join(skill,'tasks/auth/workspaces.mjs')).href);
  const {calls}=await import(pathToFileURL(path.join(skill,'tasks/edgeone/cli/runtime.mjs')).href);
  const options={environment:{...process.env,EDGEONE_PAGES_API_TOKEN:'private'}};
  assert.deepEqual(await list(options),[{id:'zone-one',name:'Same',current:true,available:true},{id:'zone-two',name:'Same',current:false,available:false}]);
  for(const id of ['--bad','zone-unknown','zone-two',null])await assert.rejects(use(id,options),/invalid_workspace/);
  assert.equal(calls.length,0);await use('zone-one',options);
  assert.deepEqual(calls[0].args,['workspace','use','zone-one','--interaction','terminal']);
  assert.equal(calls[0].options.useSavedCredential,false);assert.equal(calls[0].options.environment.EDGEONE_PAGES_API_TOKEN,undefined);
}));

test('Workspace routes require session and serialize switches without leaking failures',async()=>{
  let calls=0,release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);
  const page=await startAuthPage({store:async()=>null,environment:{},workspaces:async()=>[],check:async()=>({status:'authorized'}),
    switchWorkspace:async(id,{signal})=>{assert.equal(id,'zone-one');calls++;started();await gate;assert.equal(signal.aborted,false);throw new Error('private-secret');}});
  const url=new URL(page.url),post=(route,body,session=url.hash.slice(1))=>fetch(url.origin+route,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json','X-Swcl-Session':session},body:JSON.stringify(body)});
  try{
    assert.equal((await post('/workspace',{id:'zone-one'},'wrong')).status,403);assert.equal(calls,0);
    const switching=post('/workspace',{id:'zone-one'});await running;
    assert.equal((await post('/workspace',{id:'zone-one'})).status,409);assert.equal((await post('/save',{})).status,409);
    release();const result=await switching;assert.equal(result.status,400);assert.ok(!(await result.text()).includes('private-secret'));
    assert.deepEqual(await (await post('/workspaces',{})).json(),{workspaces:[]});
  }finally{release();page.close();await page.completed;}
});

import {inspectCli,runCli} from '../edgeone/cli/runtime.mjs';
import {toolExecutable} from '../_shared/tools/operations.mjs';
import {probe,withPath} from '../_shared/tools/process.mjs';
import {loginEnvironment} from './login.mjs';
import {check} from './status.mjs';
import path from 'node:path';

export async function list({environment=process.env,signal}={}) {
  const status=await check('edgeone',{environment,signal});
  if(status?.status!=='authorized')throw new Error('workspace_list_failed');
  const node=toolExecutable('node'),cli=inspectCli();
  const env=withPath([path.dirname(node)],loginEnvironment('edgeone',environment));env.CI='true';
  const result=await probe(node,[cli.path,'workspace','ls','--json'],{env,signal,timeout:30000});
  let data;try{data=JSON.parse(result.text);}catch{}
  if(!result.ok||!Array.isArray(data?.workspaces))throw new Error('workspace_list_failed');
  return data.workspaces.filter(w=>typeof w.id==='string'&&/^zone-[a-zA-Z0-9-]+$/.test(w.id)).map(w=>({
    id:w.id,name:typeof w.name==='string'?w.name.slice(0,256):w.id,current:w.current===true,available:w.available===true
  }));
}
export async function use(id,{environment=process.env,signal}={}) {
  if(typeof id!=='string'||!/^zone-[a-zA-Z0-9-]+$/.test(id))throw new Error('invalid_workspace');
  const workspaces=await list({environment,signal});
  if(!workspaces.some(w=>w.id===id&&w.available))throw new Error('invalid_workspace');
  const code=await runCli(['workspace','use',id,'--interaction','terminal'],{
    environment:loginEnvironment('edgeone',environment),signal,useSavedCredential:false,stdio:['inherit',2,2]
  });
  if(code!==0)throw new Error('workspace_switch_failed');
}

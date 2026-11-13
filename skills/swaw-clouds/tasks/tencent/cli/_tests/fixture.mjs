import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {skillRoot} from '../../../_shared/tools/manifest.mjs';
export function testRoot() {const root=path.join(fs.realpathSync.native(os.tmpdir()),'swaw','clouds','tests');fs.mkdirSync(root,{recursive:true});return root;}
export const version = fs.readFileSync(new URL('../requirements.txt',import.meta.url),'utf8').trim().split('==')[1];
export function write(root,name,text) {
  const file = path.join(root,name);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
}
export function installation(root) {
  const home = path.join(root,'python-tools/tccli'),base = path.join(root,'python/cpython-3.13');
  write(base,'python.exe','managed Python fixture');
  write(home,'Scripts/python.exe','tool Python fixture');write(home,'Scripts/tccli.exe','CLI fixture');
  write(home,'Lib/site-packages/tccli/main.py','raise RuntimeError("checks must not execute package code")');
  write(home,'Lib/site-packages/tccli-'+version+'.dist-info/METADATA','Name: tccli\nVersion: '+version+'\n');
  write(home,'pyvenv.cfg','home = '+base+'\nversion_info = 3.13.12\ninclude-system-site-packages = false\n');
  return {home,base,executable:path.join(home,'Scripts/tccli.exe')};
}
export async function fixture(run) {
  const parent = testRoot(),work = fs.mkdtempSync(path.join(parent,'swcl-tencent-'));
  const temporary = {TMP:work,TEMP:work,TMPDIR:work};
  const saved = Object.fromEntries(Object.keys(temporary).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,temporary);
    const skill = path.join(work,'skill 树'),site = path.join(work,'site'),root = path.join(skill,'.tools');
    fs.cpSync(skillRoot,skill,{recursive:true,filter:file=>!['.tools','node_modules'].includes(path.basename(file))});fs.mkdirSync(site);
    const env = {...process.env,USERPROFILE:work,HOME:work,PATH:'',PSModulePath:path.join(process.env.SystemRoot || '', 'System32/WindowsPowerShell/v1.0/Modules')};
    const cli = (command,args=[],cold=false)=>{
      const executable = cold ? path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe') : process.execPath;
      const entry = cold ? ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(skill,'bootstrap/windows.ps1')]
        : [path.join(skill,'tasks/_cli/main.mjs')];
      const result = spawnSync(executable,[...entry,command,...args],{cwd:site,env,encoding:'utf8',timeout:15000,windowsHide:true});
      assert.ifError(result.error);return result;
    };
    await run({work,skill,site,root,cli});
  } finally {
    for (const [key,value] of Object.entries(saved)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    assert.equal(path.dirname(fs.realpathSync.native(work)),parent);assert.ok(path.basename(work).startsWith('swcl-tencent-'));
    fs.rmSync(work,{recursive:true,force:true});
  }
}

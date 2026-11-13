import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {skillRoot} from '../tools/manifest.mjs';
const parent=path.join(fs.realpathSync.native(os.tmpdir()),'swaw','clouds','tests');
fs.mkdirSync(parent,{recursive:true});
export function write(root,name,text) {
  const file = path.join(root,name);
  fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,text);
}
export async function fixture(run,environment = {}) {
  const work = fs.mkdtempSync(path.join(parent,'swcl-runtime-'));
  try {
    const skill = path.join(work,'skill with spaces 树'),site = path.join(work,'site'),temporary = path.join(work,'temp');
    fs.cpSync(skillRoot,skill,{recursive:true,filter:file=>!['.tools','node_modules'].includes(path.basename(file))});
    fs.mkdirSync(site);
    fs.mkdirSync(temporary);
    const env = {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!['path','localappdata','cloudflare_auth_use_keyring','temp','tmp','tmpdir'].includes(key.toLowerCase()))),
      PATH:'',LOCALAPPDATA:path.join(work,'local app data 树'),TEMP:temporary,TMP:temporary,TMPDIR:temporary,
      PSModulePath:path.join(process.env.SystemRoot || '', 'System32/WindowsPowerShell/v1.0/Modules'),...environment};
    const cli = (command,args=[],cold=false) => {
      const executable = cold ? path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe') : process.execPath;
      const entry = cold ? ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(skill,'bootstrap/windows.ps1')]
        : [path.join(skill,'tasks/_cli/main.mjs')];
      const result = spawnSync(executable,[...entry,command,...args],{cwd:site,env,encoding:'utf8',timeout:15000,windowsHide:true});
      assert.ifError(result.error); return result;
    };
    await run({work,skill,site,temporary,env,cli});
  } finally {
    assert.equal(path.dirname(fs.realpathSync.native(work)),parent);
    assert.ok(path.basename(work).startsWith('swcl-runtime-'));
    fs.rmSync(work,{recursive:true,force:true});
  }
}

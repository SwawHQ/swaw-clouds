import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {execute} from '../process.mjs';
import {fixture} from '../../_tests/fixture.mjs';
test('closing Windows authorization kills the CLI wrapper and its child process',{skip:process.platform!=='win32',timeout:15000},()=>fixture(async({work})=>{
  const marker = path.join(work,'login-processes.json'),controller = new AbortController();
  const source = `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);`;
  const running = execute(process.execPath,['-e',source,marker],{signal:controller.signal,stdio:'ignore'});
  try {
    for (let count=0;count<200&&!fs.existsSync(marker);count++) await setTimeout(10);
    assert.ok(fs.existsSync(marker));
    const pids = JSON.parse(fs.readFileSync(marker));
    controller.abort();assert.notEqual(await running,0);
    for (const pid of pids) {
      for (let count=0;count<200;count++) {
        try {process.kill(pid,0);} catch {break;}
        await setTimeout(10);
      }
      assert.throws(()=>process.kill(pid,0));
    }
  } finally {controller.abort();await running;}
}));

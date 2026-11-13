import path from 'node:path';
import {ensureDependencies} from '../../_shared/dependencies.mjs';
import {dependencyRoot,browserEnvironment,loadChromium} from '../../_shared/browser/runtime.mjs';
import {execute,withPath} from '../../_shared/tools/process.mjs';
import {toolExecutable} from '../../_shared/tools/operations.mjs';

async function installBrowser(args) {
  await ensureDependencies(dependencyRoot,{force:true});
  const executable = toolExecutable('node');
  const env = withPath([path.dirname(executable)],browserEnvironment());
  const cli = path.join(dependencyRoot,'node_modules/playwright/cli.js');
  if (await execute(executable,[cli,'install',...args],{cwd:dependencyRoot,env}) !== 0) throw new Error('Browser installation failed.');
}

export async function ensureChromium() {
  await installBrowser(['chromium','--no-shell']);
  console.log('Chromium ready: '+loadChromium().executablePath());
}

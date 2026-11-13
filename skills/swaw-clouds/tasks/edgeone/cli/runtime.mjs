import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dependencyState,ensureDependencies} from '../../_shared/dependencies.mjs';
import {inside} from '../../_shared/tools/filesystem.mjs';
import {prepareTools} from '../../_shared/tools/selection.mjs';
import {toolExecutable} from '../../_shared/tools/operations.mjs';
import {execute,withPath} from '../../_shared/tools/process.mjs';

import {edgeoneEnvironment} from '../auth/credentials.mjs';

const root = fileURLToPath(new URL('./',import.meta.url));

export function inspectCli() {
  const repair = 'run swcl edgeone/cli/ensure --force';
  const status = dependencyState(root);
  if (status.state !== 'ready') throw new Error('edgeone_packages_'+status.state+'; '+repair);
  const entry = inside(root,'node_modules','edgeone','edgeone-bin/edgeone.js');
  if (!fs.statSync(entry,{throwIfNoEntry:false})?.isFile()) throw new Error('edgeone_entry_missing; '+repair);
  const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).dependencies.edgeone;
  return {tool:'edgeone',version,path:entry};
}

export async function prepareCli({force = false} = {}) {
  await ensureDependencies(root,{force});
  return inspectCli();
}

export async function runCli(args,{environment = process.env,signal,stdio = 'inherit',cwd,useSavedCredential = true} = {}) {
  signal?.throwIfAborted();
  const cli = await prepareCli();
  await prepareTools(['node']);
  signal?.throwIfAborted();
  const node = toolExecutable('node');
  const env = withPath([path.dirname(node)],useSavedCredential ? await edgeoneEnvironment(args,environment) : environment);
  return execute(node,[cli.path,...args],{env,signal,stdio,cwd:cwd ?? process.cwd()});
}

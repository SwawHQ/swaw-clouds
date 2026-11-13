import fs from 'node:fs';
import {prepareRuntime} from '../_shared/tools/selection.mjs';
import {readBindings,resolveBinding} from '../_shared/tools/bindings.mjs';
import {runTask,taskEntry} from './dispatch.mjs';
import {taskHelp} from '../help/run.mjs';

const [requested='help',...args]=process.argv.slice(2);
const command=['--help','-h'].includes(requested)?'help':requested;
try {
  taskEntry(command);
  const preparing=/^base\/(?:node|uv)\/ensure$/.test(command);
  const showingHelp=args.length===1&&['--help','-h'].includes(args[0]);
  const native=/^(?:base\/(?:node|uv(?:\/python)?)(?:\/(?:npm|npx))?|(?:cloudflare\/(?:cli|wrangler)|tencent\/cli|edgeone\/cli))$/.test(command);
  const preparingPackages=/^(?:cloudflare\/(?:cli|wrangler)|tencent\/cli|edgeone\/cli)\/ensure$/.test(command);
  if ((preparing||preparingPackages)&&!showingHelp&&(args.length>1||(args.length===1&&args[0]!=='--force'))) throw new Error('invalid_ensure_arguments');
  if (command==='base/uv/python/ensure'&&!showingHelp&&args.length) throw new Error('invalid_ensure_arguments');
  let executable=process.execPath;
  if (showingHelp&&!native&&!/^help(?:\/(?:en|zh))?$/.test(command)) { console.log(taskHelp(command)); }
  else {
    if (!/^help(?:\/(?:en|zh))?$/.test(command)&&!/^(?:base\/(?:[^/]+|uv\/python)|(?:cloudflare\/(?:cli|wrangler|auth\/token)|tencent\/(?:cli|auth\/key)|edgeone\/cli))\/check$/.test(command)) {
      const record=readBindings();
      if (!record.runtime||preparing) {
        const runtime=await prepareRuntime();
        if (!preparing) executable=runtime.path;
      } else if (fs.realpathSync(executable)!==fs.realpathSync(resolveBinding(record.runtime,record).path)) {
        throw new Error(`runtime_binding_unusable; run swcl base/${record.runtime}/ensure`);
      }
    }
    process.exitCode=await runTask(command,args,executable);
  }
} catch (error) { console.error(`[swcl] ${error.message}`); process.exitCode=1; }

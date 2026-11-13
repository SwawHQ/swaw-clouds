import {helpFor} from '../../../_shared/arguments.mjs';
import {inspectCli} from '../runtime.mjs';

const args = process.argv.slice(2);
try {
  if (args.length === 1 && ['--help','-h'].includes(args[0])) console.log(helpFor({command:'tencent/cli/check'}));
  else {
    if (args.length) throw new Error('check_is_read_only; no additional arguments accepted');
    console.log(JSON.stringify({...inspectCli(),action:'checked'}));
  }
} catch (error) {console.error(`[swcl] ${error.message}`);process.exitCode = 1;}

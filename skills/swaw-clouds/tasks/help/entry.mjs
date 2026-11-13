import {help} from './run.mjs';

try { console.log(help(process.argv.slice(2))); }
catch (error) { console.error(`[swcl] ${error.message}`); process.exitCode=1; }

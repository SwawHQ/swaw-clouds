import {runPackageManager} from '../packages.mjs';

try { process.exitCode=await runPackageManager('npx',process.argv.slice(2)); }
catch (error) { console.error(`[swcl] ${error.message}`); process.exitCode=1; }

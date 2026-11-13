import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {skillRoot} from '../../../_shared/tools/manifest.mjs';
import {prepareTool, inspectBinding} from '../../../_shared/tools/selection.mjs';
import {readBindings, writeBindings} from '../../../_shared/tools/bindings.mjs';
import {zip} from './fixtures/zip.mjs';
import {sha256} from '../../../_shared/tools/filesystem.mjs';
import {uvEnvironment, pythonHome, pythonExecutable} from '../environment.mjs';
import {pythonCommandIndex} from '../arguments.mjs';

const testRoot=path.join(fs.realpathSync.native(os.tmpdir()),'swaw','clouds','uv-tests');
fs.mkdirSync(testRoot,{recursive:true});

const uv = process.env.CLOUDS_TEST_UV, python = process.env.CLOUDS_TEST_PYTHON_DIR;
const archive = process.env.CLOUDS_TEST_UV_ARCHIVE;
test('native uv locates Python commands after global options without a flag table', {skip:!uv}, async () => {
  for (const [args,index] of [
    [['run','python'],0],
    [['--offline','run','--','python'],1],
    [['-q','--offline','pip','list'],2],
    [['-vv','--cache-dir=pip','run','python'],2],
    [['--offline','--color=never','--directory','run','pip','list'],4],
    [['--directory=run','--cache-dir','pip','--color','always','run','python'],5],
    [['--directory','pip','--cache-dir','run','pip','list'],4],
    [['--offline','--version'],-1],
    [['--version','run'],-1],
    [['help','run'],-1],
    [['tool','run','python','run'],-1],
    [['tool','run','python','pip'],-1]
  ]) assert.equal(await pythonCommandIndex(uv,args,uvEnvironment()),index,JSON.stringify(args));
});

test('portable uv is verified and reused without changing the external uv', {skip:!uv || !archive}, async () => {
  const work = fs.mkdtempSync(path.join(testRoot, 'swcl-uv-install-'));
  try {
    const before = sha256(uv), received = [];
    const receive = async (url, target, hash) => {
      const name = path.basename(new URL(url).pathname);
      fs.copyFileSync(name.endsWith('.zip') ? archive : path.join(path.dirname(archive),name),target);
      assert.equal(sha256(target),hash); received.push(name);
    };
    const installed = await prepareTool('uv', [], {root:work, env:{PATH:''}, receive});
    assert.equal(installed.source,'managed'); assert.equal(installed.action,'installed');
    assert.equal(received.length,3);
    assert.equal((await prepareTool('uv', [], {root:work, env:{PATH:''}, receive})).action,'reused');
    assert.equal(received.length,3);
    assert.equal((await inspectBinding('uv', {root:work})).version,'0.10.2');
    assert.equal(sha256(uv),before);
  } finally { fs.rmSync(work,{recursive:true,force:true}); }
});

test('real uv and Python isolate an existing uv repository, pip and tool dependencies',
  {skip:!uv || !python, timeout:60000}, async () => {
  const parent = testRoot;
  const work = fs.mkdtempSync(path.join(parent, 'swcl-python-'));
  try {
    const repo = path.join(work, 'repo 树'), skill = path.join(repo, '.agents/skills/swaw-clouds');
    fs.cpSync(skillRoot, skill, {recursive:true, filter:file => !['.tools','node_modules'].includes(path.basename(file))});
    const root = path.join(skill, '.tools'), runtime = 'node';
    writeBindings({schema:'swaw-clouds.bindings/v1', runtime, tools:{
      [runtime]:{source:'path', path:process.execPath, version:process.versions.node}
    }}, root);
    assert.equal((await prepareTool('uv', [], {root, env:{PATH:path.dirname(uv)}})).source, 'path');
    assert.equal(fs.realpathSync.native((await inspectBinding('uv', {root})).path), fs.realpathSync.native(uv));
    assert.equal(fs.existsSync(path.join(root, 'uv')), false);
    fs.cpSync(python, path.join(root, 'python'), {recursive:true});

    function write(name, text) {
      const file = path.join(repo,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,text);
    }
    const protectedFiles = {
      'pyproject.toml':'[project]\nname="unrelated"\nversion="1.0.0"\nrequires-python="==3.9.*"\ndependencies=["nonexistent-project-dependency"]\n',
      'uv.toml':'invalid config = [', 'uv.lock':'repository lock', '.python-version':'3.9',
      '.venv/keep':'repository environment', 'repo_only.py':'raise RuntimeError("repository import")',
      'user/uv/uv.toml':'invalid user config = [', 'user/uv/.python-version':'3.9'
    };
    for (const [name,text] of Object.entries(protectedFiles)) write(name,text);
    const env = {...process.env,APPDATA:path.join(repo,'user'),UV_PROJECT:repo,UV_CONFIG_FILE:path.join(repo,'uv.toml'),
      UV_PYTHON:'3.9',UV_PROJECT_ENVIRONMENT:path.join(repo,'.venv'),UV_TOOL_DIR:path.join(repo,'user-tools'),
      UV_PYTHON_INSTALL_DIR:path.join(repo,'user-python'),UV_ENV_FILE:path.join(repo,'missing.env'),
      PYTHONHOME:repo,PYTHONPATH:repo,VIRTUAL_ENV:path.join(repo,'.venv'),CONDA_PREFIX:path.join(repo,'.venv')};
    const originalPath = env.PATH ?? env.Path;
    function cli(command, args = [], status = 0) {
      const result = spawnSync(process.execPath, [path.join(skill,'tasks/_cli/main.mjs'),command,...args],
        {cwd:repo, env, encoding:'utf8', timeout:30000, windowsHide:true});
      assert.ifError(result.error); assert.equal(result.status,status,result.stdout+result.stderr);
      return result;
    }
    assert.match(cli('base/uv',['--version']).stdout,/^uv /);
    assert.match(cli('base/uv',['--offline','--version']).stdout,/^uv /);
    const found = cli('base/uv', ['python','find','3.13']).stdout.trim();
    const foundRelative = path.relative(path.join(root,'python'), found);
    assert.ok(foundRelative && foundRelative !== '..' && !foundRelative.startsWith('..'+path.sep) && !path.isAbsolute(foundRelative));
    cli('base/uv/python/check', [], 1);
    assert.equal(fs.existsSync(pythonHome(root)),false);
    const automatic = cli('base/uv',['--offline','--color=never','--directory',repo,'run','--','python','-c','import sys; print(sys.prefix)']).stdout.trim();
    assert.equal(fs.realpathSync.native(automatic),fs.realpathSync.native(pythonHome(root)));
    const installed = JSON.parse(cli('base/uv/python/ensure').stdout);
    assert.equal(installed.action,'reused');
    assert.equal(JSON.parse(cli('base/uv/python/ensure').stdout).action,'reused');
    assert.match(cli('base/uv/python',['--help']).stdout,/usage: .*python\.exe \[option\]/i);
    const coldHelp = spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(skill,'bootstrap/windows.ps1'),'base/uv/python','--help'],
      {cwd:repo,env:{...env,PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')},encoding:'utf8',timeout:30000,windowsHide:true});
    assert.ifError(coldHelp.error);assert.equal(coldHelp.status,0,coldHelp.stderr);
    assert.match(coldHelp.stdout,/usage: .*python\.exe \[option\]/i);
    assert.equal(cli('base/uv/python',['-c','print("树")']).stdout.trim(),'树');
    const script = 'import json,os,sys,importlib.util; print(json.dumps(dict(prefix=sys.prefix,base=sys.base_prefix,cwd=os.getcwd(),repo=importlib.util.find_spec("repo_only") is not None,args=sys.argv[1:])))';
    for (const [command,args] of [['base/uv/python',['-c',script,'树','']],['base/uv',['run','--','python','-c',script,'树','']],['base/uv',['-vv','--offline','--color=never','--directory',repo,'run','--','python','-c',script,'树','']],['base/uv',['-q','--offline','--directory='+repo,'run','--','python','-c',script,'树','']]]) {
      const info = JSON.parse(cli(command,args).stdout);
      assert.equal(fs.realpathSync.native(info.prefix),fs.realpathSync.native(pythonHome(root)));
      assert.ok(path.relative(path.join(root,'python'),info.base) && !path.relative(path.join(root,'python'),info.base).startsWith('..'));
      assert.equal(info.cwd,fs.realpathSync.native(repo)); assert.equal(info.repo,false); assert.deepEqual(info.args,['树','']);
    }
    function wheel(name, module, entry = '') {
      const dist = name+'-1.0.0.dist-info';
      const files = {[name+'.py']:module,[dist+'/METADATA']:`Metadata-Version: 2.1\nName: ${name}\nVersion: 1.0.0\n`,
        [dist+'/WHEEL']:'Wheel-Version: 1.0\nGenerator: swcl-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
        [dist+'/RECORD']:''};
      if(entry) files[dist+'/entry_points.txt']=entry;
      const target = path.join(work,name+'-1.0.0-py3-none-any.whl');
      fs.writeFileSync(target,zip(Object.entries(files).map(([name,text])=>({name,bytes:Buffer.from(text)}))));
      return target;
    }
    const dependency = wheel('swcl_env_only','VALUE="skill"\n');
    write('run/keep','directory value, not a command');
    const moved = JSON.parse(cli('base/uv',['--offline','--directory','run','run','--','python','-c',script,'树','']).stdout);
    assert.equal(fs.realpathSync.native(moved.prefix),fs.realpathSync.native(pythonHome(root)));
    assert.equal(moved.cwd,fs.realpathSync.native(path.join(repo,'run')));
    cli('base/uv',['--offline','--color=never','--directory=run','pip','install','--no-index',dependency]);
    assert.equal(cli('base/uv/python',['-c','import swcl_env_only; print(swcl_env_only.VALUE)']).stdout.trim(),'skill');
    const tool = wheel('swcl_probe_cli','import json,sys,os,importlib.util\ndef main():\n print(json.dumps(dict(prefix=sys.prefix,cwd=os.getcwd(),repo=importlib.util.find_spec("repo_only") is not None,shared=importlib.util.find_spec("swcl_env_only") is not None,args=sys.argv[1:])))\n',
      '[console_scripts]\nswcl-probe = swcl_probe_cli:main\n');
    const info = JSON.parse(cli('base/uv',['tool','run','--no-index','--from',tool,'swcl-probe','树']).stdout);
    assert.notEqual(fs.realpathSync.native(info.prefix),fs.realpathSync.native(pythonHome(root)));
    const cacheRelative = path.relative(fs.realpathSync.native(path.join(root,'.cache/uv')),fs.realpathSync.native(info.prefix));
    assert.ok(cacheRelative && !cacheRelative.startsWith('..'), info.prefix);
    assert.equal(info.shared,false); assert.equal(info.repo,false); assert.deepEqual(info.args,['树']);
    assert.equal(info.cwd,fs.realpathSync.native(repo));
    const before = fs.readFileSync(path.join(root,'bindings.json'));
    assert.equal(JSON.parse(cli('base/uv/python/check').stdout).version,installed.version);
    cli('base/uv/check');
    assert.deepEqual(fs.readFileSync(path.join(root,'bindings.json')),before);
    cli('base/uv/python',['-c','raise SystemExit(17)'],17);
    cli('base/uv/python/ensure',['--force'],1);
    for (const [name,text] of Object.entries(protectedFiles)) assert.equal(fs.readFileSync(path.join(repo,name),'utf8'),text);
    assert.deepEqual(fs.readdirSync(path.join(repo,'.venv')),['keep']);
    for (const name of ['user-tools','user-python']) assert.equal(fs.existsSync(path.join(repo,name)),false);
    assert.equal(env.PATH ?? env.Path,originalPath);
    assert.equal(readBindings(root).tools.uv.source,'path');
    // A relocated or replaced environment must fail rather than be silently cleared.
    const config = path.join(pythonHome(root),'pyvenv.cfg'), configText = fs.readFileSync(config,'utf8');
    fs.renameSync(pythonExecutable(root),pythonExecutable(root)+'.saved');
    cli('base/uv/python/ensure',[],1);
    assert.equal(fs.readFileSync(config,'utf8'),configText);
  } finally {
    assert.equal(path.dirname(fs.realpathSync.native(work)),parent);
    assert.ok(path.basename(work).startsWith('swcl-python-'));
    fs.rmSync(work,{recursive:true,force:true});
  }
});

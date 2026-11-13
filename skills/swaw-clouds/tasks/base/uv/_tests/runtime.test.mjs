import {writeBindings} from '../../../_shared/tools/bindings.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess, {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {skillRoot} from '../../../_shared/tools/manifest.mjs';
import {inspectPython} from '../python/runtime.mjs';
import {uvEnvironment, pythonHome, pythonExecutable} from '../environment.mjs';
import {pythonCommandIndex} from '../arguments.mjs';

const testRoot=path.join(fs.realpathSync.native(os.tmpdir()),'swaw','clouds','uv-tests');
fs.mkdirSync(testRoot,{recursive:true});

test('uv environment owns storage and removes inherited Python and uv selection', () => {
  const root = path.join(os.tmpdir(), 'skill tools');
  const source = {Path:'original',UV_PROJECT:'external',UV_PYTHON:'external',UV_CONFIG_FILE:'external',
    UV_SYSTEM_PYTHON:'true',UV_PYTHON_INSTALL_REGISTRY:'1',UV_PYTHON_INSTALL_BIN:'1',
    PYTHONHOME:'external',pythonpath:'external',VIRTUAL_ENV:'external',CONDA_PREFIX:'external',
    CONDA_PREFIX_1:'external',PIP_TARGET:'external',CLOUD_TOKEN:'preserved'};
  const before = {...source}, env = uvEnvironment(source, root);
  assert.deepEqual(source, before);
  assert.equal(env.Path, source.Path);
  assert.equal(env.CLOUD_TOKEN, source.CLOUD_TOKEN);
  for (const key of ['UV_PROJECT','UV_CONFIG_FILE','UV_SYSTEM_PYTHON','PYTHONHOME','pythonpath','CONDA_PREFIX','CONDA_PREFIX_1','PIP_TARGET'])
    assert.equal(env[key], undefined, key);
  for (const key of ['UV_NO_CONFIG','UV_NO_PROJECT','UV_NO_ENV_FILE','UV_MANAGED_PYTHON','PYTHONNOUSERSITE','PYTHONSAFEPATH','PYTHONUTF8'])
    assert.equal(env[key], '1', key);
  for (const key of ['UV_PYTHON_INSTALL_REGISTRY','UV_PYTHON_INSTALL_BIN']) assert.equal(env[key], '0');
  for (const key of ['UV_CACHE_DIR','UV_PYTHON_CACHE_DIR','UV_PYTHON_INSTALL_DIR','UV_PYTHON_BIN_DIR','UV_TOOL_DIR','UV_TOOL_BIN_DIR','UV_PROJECT_ENVIRONMENT','VIRTUAL_ENV'])
    assert.ok(path.relative(root,env[key]) && !path.relative(root,env[key]).startsWith('..'), key);
});

test('Python check fails without creating or repairing an environment', async () => {
  const work = fs.mkdtempSync(path.join(testRoot, 'swcl-python-check-'));
  try {
    const root = path.join(work, 'missing');
    await assert.rejects(inspectPython({root}), /python_environment_unusable/);
    assert.deepEqual(fs.readdirSync(work), []);
  } finally { fs.rmSync(work, {recursive:true, force:true}); }
});

test('nested Python help and checks stay read-only and old routes are absent', {skip:process.platform!=='win32'}, () => {
  const parent = testRoot;
  const work = fs.mkdtempSync(path.join(parent, 'swcl-python-routes-'));
  try {
    const skill = path.join(work,'skill'), root = path.join(skill,'.tools');
    fs.cpSync(skillRoot, skill, {recursive:true, filter:file => !['.tools','node_modules'].includes(path.basename(file))});
    const powershell = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const env = {...process.env,PATH:'',PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
    const cli = (cold,command,args=[]) => {
      const executable = cold ? powershell : process.execPath;
      const entry = cold
        ? ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(skill,'bootstrap/windows.ps1')]
        : [path.join(skill,'tasks/_cli/main.mjs')];
      const result = spawnSync(executable,[...entry,command,...args],{cwd:work,env,encoding:'utf8',timeout:10000,windowsHide:true});
      assert.ifError(result.error);return result;
    };
    for (const cold of [false,true]) {
      for (const command of ['base/uv/python/check','base/uv/python/ensure']) {
        const result = cli(cold,command,['--help']);
        assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes('swcl '+command));
      }
      const checked = cli(cold,'base/uv/python/check');
      assert.equal(checked.status,1);
      assert.ok(checked.stderr.includes(cold ? 'runtime_not_ready' : 'base/uv/python/ensure'),checked.stderr);
      const invalid = cli(cold,'base/uv/python/ensure',['--force']);
      assert.equal(invalid.status,1);assert.match(invalid.stderr,/invalid_ensure_arguments/);
      for (const command of ['base/python','base/python/check','base/python/ensure']) {
        const removed = cli(cold,command,['--help']);
        assert.equal(removed.status,1);assert.ok(removed.stderr.includes('unknown_command:'+command),removed.stderr);
      }
      const help = cli(cold,'help/en',['base/uv','2']);
      assert.equal(help.status,0,help.stderr);assert.ok(help.stdout.includes('base/uv/python/ensure'));
      assert.equal(fs.existsSync(root),false);
    }
  } finally {
    assert.equal(path.dirname(fs.realpathSync.native(work)),parent);
    assert.ok(path.basename(work).startsWith('swcl-python-routes-'));
    fs.rmSync(work,{recursive:true,force:true});
  }
});

test('ready Python environments support concurrent reuse and still reject damage', async t => {
  const parent = testRoot;
  const work = fs.mkdtempSync(path.join(parent, 'swcl-python-reuse-'));
  const skill = path.join(work, 'skill'), root = path.join(skill, '.tools');
  const home = pythonHome(root), executable = pythonExecutable(root), base = path.join(root, 'python/cpython-3.13');
  let mocked;
  try {
    fs.cpSync(skillRoot, skill, {recursive:true, filter:file => !['.tools','node_modules'].includes(path.basename(file))});
    fs.mkdirSync(path.dirname(executable), {recursive:true});
    fs.mkdirSync(base, {recursive:true});
    fs.writeFileSync(executable, 'process fixture');
    writeBindings({schema:'swaw-clouds.bindings/v1', tools:{
      uv:{source:'path', path:process.execPath, version:'0.10.2'}
    }}, root);
    const bindings = fs.readFileSync(path.join(root, 'bindings.json'));
    const spawn = childProcess.spawn;
    let probes = 0, activeBase = base;
    mocked = t.mock.method(childProcess, 'spawn', (file, args, options) => {
      if (file !== executable) return spawn(file, args, options);
      probes++;
      return spawn(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', JSON.stringify(['3.13.1', home, activeBase])], options);
    });
    syncBuiltinESMExports();
    const {preparePython} = await import(pathToFileURL(path.join(skill, 'tasks/base/uv/python/runtime.mjs')));
    const results = await Promise.allSettled([preparePython(), preparePython()]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled','fulfilled']);
    assert.deepEqual(results.map(result => result.value.action), ['reused','reused']);
    assert.equal(probes, 2);
    const internalAlias = path.join(root, 'python/current');
    fs.symlinkSync(base, internalAlias, process.platform === 'win32' ? 'junction' : 'dir');
    activeBase = internalAlias;
    assert.equal((await preparePython()).action, 'reused', 'A managed version alias may resolve within the managed Python root.');
    const externalBase = path.join(work, 'external-python'), externalAlias = path.join(root, 'python/external');
    fs.mkdirSync(externalBase);
    fs.symlinkSync(externalBase, externalAlias, process.platform === 'win32' ? 'junction' : 'dir');
    activeBase = externalAlias;
    await assert.rejects(preparePython(), /python_environment_unusable/, 'A managed alias must not resolve outside the managed Python root.');
    activeBase = base;
    assert.equal(fs.existsSync(path.join(root, '.cache')), false);
    fs.unlinkSync(executable);
    await assert.rejects(preparePython(), /python_environment_unusable/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'bindings.json')), bindings);
    assert.equal(fs.existsSync(home), true);
    assert.equal(fs.existsSync(path.join(root, '.cache')), false);
  } finally {
    mocked?.mock.restore();
    syncBuiltinESMExports();
    assert.equal(path.dirname(fs.realpathSync.native(work)), parent);
    assert.ok(path.basename(work).startsWith('swcl-python-reuse-'));
    fs.rmSync(work, {recursive:true, force:true});
  }
});

test('uv command discovery stops before tool and script arguments', async t => {
  const spawn = childProcess.spawn, calls = [];
  const mocked = t.mock.method(childProcess, 'spawn', (file, args, options) => {
    calls.push(args);
    assert.deepEqual(args,['tool','run','--help'],'Only the outer command may be probed.');
    return spawn(process.execPath,['-e','console.log("Usage: uv.exe tool run [OPTIONS] [COMMAND]")'],options);
  });
  syncBuiltinESMExports();
  try {
    for (const argument of ['run','pip']) {
      assert.equal(await pythonCommandIndex('fake-uv',['tool','run','python',argument],{}),-1);
    }
    assert.equal(calls.length,2);
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
});

test('failed native command discovery cannot skip Python isolation', async t => {
  const spawn = childProcess.spawn;
  const mocked = t.mock.method(childProcess,'spawn',(file,args,options)=>spawn(process.execPath,['-e','process.exit(2)'],options));
  syncBuiltinESMExports();
  try {await assert.rejects(pythonCommandIndex('fake-uv',['--offline','run','python'],{}),/uv_argument_probe_failed/);}
  finally {mocked.mock.restore();syncBuiltinESMExports();}
});

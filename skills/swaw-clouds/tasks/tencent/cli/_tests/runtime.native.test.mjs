import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess,{spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import https from 'node:https';
import {X509Certificate} from 'node:crypto';
import {skillRoot} from '../../../_shared/tools/manifest.mjs';

import {fixture,write,installation,testRoot} from './fixture.mjs';
const toolPython = path.join(skillRoot,'.tools/python-tools/tccli/Scripts/python.exe');
test('tccli OAuth acquisition and refresh reject untrusted TLS and accept an explicit CA',
  {skip:process.platform !== 'win32' || !fs.existsSync(toolPython)},async()=>{
  const parent = testRoot(),work = fs.mkdtempSync(path.join(parent,'swcl-tencent-tls-'));
  const certificate = spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',`
$ErrorActionPreference='Stop'
$rsa=[System.Security.Cryptography.RSA]::Create(2048)
$request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddIpAddress([System.Net.IPAddress]::Loopback)
$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddHours(1))
@{pfx=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx));cert=[Convert]::ToBase64String($cert.RawData)}|ConvertTo-Json -Compress
$cert.Dispose();$rsa.Dispose()`],{encoding:'utf8',timeout:10000,windowsHide:true});
  let server;
  try {
    assert.ifError(certificate.error);assert.equal(certificate.status,0,certificate.stderr);
    const pair = JSON.parse(certificate.stdout),ca = path.join(work,'ca.pem');
    fs.writeFileSync(ca,new X509Certificate(Buffer.from(pair.cert,'base64')).toString());
    let requests = 0;
    server = https.createServer({pfx:Buffer.from(pair.pfx,'base64')},(req,res)=>{
      requests++;req.resume();res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({SecretId:'fixture-id',SecretKey:'fixture-key',Token:'fixture-token',AccessToken:'fixture-access',ExpiresAt:9999999999}));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const script = `import runpy, sys
import requests
from tccli import main, oauth
launcher, oauth._API_ENDPOINT, expected = sys.argv[1:]
def exercise():
    for function, args in [(oauth.get_temp_cred, ('fixture-access', 'cn')), (oauth.refresh_user_token, ('fixture-refresh', 'fixture-id', 'cn'))]:
        try:
            function(*args)
        except requests.exceptions.SSLError:
            assert expected == 'reject'
        else:
            assert expected == 'accept', 'OAuth accepted an untrusted certificate'
    return 17
main.main = exercise
runpy.run_path(launcher, run_name='__main__')`;
    for (const trusted of [false,true]) {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$/i.test(key)));
      Object.assign(env,{USERPROFILE:work,HOME:work,NO_PROXY:'127.0.0.1'});
      if (trusted) env.REQUESTS_CA_BUNDLE = ca;
      const result = await new Promise((resolve,reject)=>{
        const child = childProcess.spawn(toolPython,['-I','-B','-X','utf8','-c',script,
          path.join(skillRoot,'tasks/tencent/cli/cli.py'),'https://127.0.0.1:'+server.address().port,trusted?'accept':'reject'],
          {env,encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']});
        let output = '';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
        child.once('error',reject);child.once('close',code=>resolve({code,output}));
      });
      assert.equal(result.code,17,result.output);assert.equal(requests,trusted?2:0);
    }
  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(fs.realpathSync.native(work)),parent);
    fs.rmSync(work,{recursive:true,force:true});
  }
});

test('tccli native status initializes missing native configuration and selects the default or named OAuth profile',
  {skip:process.platform !== 'win32' || !fs.existsSync(toolPython)},async t=>fixture(async({work,skill,root})=>{
  const {home}=installation(root),python=path.join(home,'Scripts/python.exe'),nativeHome=path.join(work,'native home'),credentials=new Map();
  for(const profile of ['default','team']) {
    const text=JSON.stringify({type:'oauth',secretId:'fixture-'+profile,secretKey:'fixture-key',token:'fixture-token',expiresAt:9999999999,
      oauth:{openId:'fixture-id',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:9999999999,site:'cn'}});
    credentials.set(profile,text);write(nativeHome,'.tccli/'+profile+'.credential',text);
  }
  const script=`import json, os, runpy, socket, sys
from tencentcloud.sts.v20180813 import models, sts_client
assert os.path.expanduser('~') == os.environ['USERPROFILE'] == os.environ['HOME']
def no_network(*args, **kwargs):
    raise AssertionError('native status test must not use the network')
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.create_connection = no_network
socket.getaddrinfo = no_network
calls = []
def identity(self, request):
    profile = os.environ['SWCL_TEST_PROFILE']
    assert self.credential.secretId == 'fixture-' + profile, 'wrong native profile'
    assert self.credential.secretKey == 'fixture-key'
    assert self.credential.token == 'fixture-token'
    calls.append(profile)
    response = models.GetCallerIdentityResponse()
    response.from_json_string(json.dumps({'AccountId': '12345', 'UserId': profile, 'Type': 'CAMUser'}))
    return response
sts_client.StsClient.GetCallerIdentity = identity
sys.argv = sys.argv[1:]
try:
    runpy.run_path(sys.argv[0], run_name='__main__')
finally:
    assert calls == [os.environ['SWCL_TEST_PROFILE']], 'identity was not checked exactly once'
`;
  const originalSpawn=childProcess.spawn;
  let calls=0,output='';
  const mocked=t.mock.method(childProcess,'spawn',(file,args,options)=>{
    assert.equal(file,python);
    calls++;
    assert.equal(options.env.USERPROFILE,nativeHome);assert.equal(options.env.HOME,nativeHome);
    const child=originalSpawn(toolPython,[...args.slice(0,4),'-c',script,...args.slice(4)],options);
    child.stderr.on('data',chunk=>output+=chunk);return child;
  });
  syncBuiltinESMExports();
  try {
    const {check}=await import(pathToFileURL(path.join(skill,'tasks/auth/status.mjs')).href);
    for(const profile of ['default','team']) {
      const environment={...process.env,USERPROFILE:nativeHome,HOME:nativeHome,TCCLI_PROFILE:profile==='team'?'team':'',SWCL_TEST_PROFILE:profile,
        TENCENTCLOUD_SECRET_ID:'wrong-environment-id',TENCENTCLOUD_SECRET_KEY:'wrong-environment-key'};
      output='';assert.equal(await check('tccli',{environment}),'authorized',profile+': '+output);
      assert.equal(fs.existsSync(path.join(nativeHome,'.tccli',profile+'.configure')),true);
      for(const [name,text] of credentials)assert.equal(fs.readFileSync(path.join(nativeHome,'.tccli',name+'.credential'),'utf8'),text);
    }
    assert.equal(calls,2);
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
}));

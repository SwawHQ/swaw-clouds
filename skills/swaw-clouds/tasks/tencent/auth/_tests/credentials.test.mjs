import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tencentEnvironment,keyInput} from '../credentials.mjs';
import {verifyKey} from '../verify.mjs';
const secretId='AKID'+'a'.repeat(32),secretKey='b'.repeat(32);

test('Tencent credentials preserve explicit identities and never mix partial environment credentials with the vault',async()=>{
  const original = {PATH:'fixture-path'},calls = [];
  const store = async action=>{calls.push(action);return {userName:secretId,secret:secretKey};};
  assert.deepEqual(await tencentEnvironment(['teo','DescribeZones'],original,store),{...original,TENCENTCLOUD_SECRET_ID:secretId,TENCENTCLOUD_SECRET_KEY:secretKey});
  assert.equal((await tencentEnvironment(['teo','DescribeZones','--version','2022-09-01'],original,store)).TENCENTCLOUD_SECRET_KEY,secretKey);
  for (const value of ['auth','configure','help']) assert.equal((await tencentEnvironment(['teo','DescribeZones','--Filters.0.Values.0',value],original,store)).TENCENTCLOUD_SECRET_KEY,secretKey);
  for (const args of [['help'],['teo','help'],['--version'],['auth','login'],['auth','logout'],['configure','list'],['--profile','work'],['--profile=work'],['--secretId','explicit'],['--token=explicit'],['--role-arn','explicit'],['--use-cvm-role','true']]) {
    const before = calls.length;assert.deepEqual(await tencentEnvironment(args,original,store),original);assert.equal(calls.length,before);
  }
  for (const env of [{TCCLI_PROFILE:'work'},{TENCENTCLOUD_ROLE_ARN:'role'},{TKE_ROLE_ARN:'role'},
    {TENCENTCLOUD_SECRET_ID:'explicit-id',TENCENTCLOUD_SECRET_KEY:'explicit-key',TENCENTCLOUD_TOKEN:'explicit-token'}]) {
    const before = calls.length;assert.deepEqual(await tencentEnvironment(['teo','DescribeZones'],env,store),env);assert.equal(calls.length,before);
  }
  for (const env of [{TENCENTCLOUD_SECRET_ID:'partial'},{TENCENTCLOUD_SECRET_KEY:'partial'},{TENCENTCLOUD_TOKEN:'partial'}])
    await assert.rejects(tencentEnvironment(['teo','DescribeZones'],env,store),/^Error: incomplete_tencent_credentials$/);
  if (process.platform === 'win32') assert.deepEqual(await tencentEnvironment(['teo','DescribeZones'],{tencentcloud_secret_id:'id',tencentcloud_secret_key:'key'},store),
    {TENCENTCLOUD_SECRET_ID:'id',TENCENTCLOUD_SECRET_KEY:'key'});
  assert.deepEqual(await tencentEnvironment(['teo','DescribeZones'],original,async()=>null),original);
  await assert.rejects(tencentEnvironment(['teo','DescribeZones'],original,async()=>({userName:secretId,secret:'bad\nsecret'})),/invalid_tencent_credential/);
  assert.deepEqual(original,{PATH:'fixture-path'});
});

test('Tencent identity verification signs only the fixed STS request and sanitizes failures',async()=>{
  assert.deepEqual(keyInput({secretId:' '+secretId+' ',secretKey:' '+secretKey+' '}),{secretId,secretKey});
  for (const value of [{secretId,secretKey:''},{secretId:'bad\nvalue',secretKey},{secretId,secretKey:'x'.repeat(129)}]) assert.throws(()=>keyInput(value),/invalid_tencent_key/);
  await verifyKey({secretId,secretKey},async(url,options)=>{
    assert.equal(url,'https://sts.tencentcloudapi.com/');assert.equal(options.method,'POST');assert.equal(options.body,'{}');assert.equal(options.redirect,'error');
    assert.equal(options.headers['X-TC-Action'],'GetCallerIdentity');assert.equal(options.headers['X-TC-Timestamp'],'1551113065');
    assert.equal(options.headers.Authorization,'TC3-HMAC-SHA256 Credential='+secretId+'/2019-02-25/sts/tc3_request, SignedHeaders=content-type;host, Signature=4cc0fab72bc87ae9f3666a11d95767f2e95c78ac0c95a3c10c63bd64a9d3125e');
    assert.ok(!JSON.stringify(options).includes(secretKey));
    return {ok:true,json:async()=>({Response:{AccountId:'12345',UserId:'67890'}})};
  },1551113065000);
  for (const request of [async()=>{throw new Error(secretKey);},async()=>({ok:true,json:async()=>({Response:{Error:{Message:secretKey}}})})])
    await assert.rejects(verifyKey({secretId,secretKey},request),/^Error: tencent_key_verification_failed$/);
});

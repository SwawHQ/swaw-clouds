import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {credentialStore as store} from '../credential-store.mjs';
const token='fixture-token-never-a-real-secret',accountId='a'.repeat(32);
test('Windows generic credentials use the GUI password format and never expose a secret in checks',{skip:process.platform !== 'win32'},async()=>{
  // A unique test target prevents reading or replacing the user's default credential.
  const target='swcl/test/'+randomUUID();
  const credentialStore=(action,record)=>store(target,action,record);
  try {
    assert.equal(await credentialStore('read',null),null);
    await credentialStore('write',{secret:token,userName:accountId});
    const check = await credentialStore('check',null);
    assert.deepEqual(check,{userName:accountId}); assert.ok(!JSON.stringify(check).includes(token));
    assert.deepEqual(await credentialStore('read',null),{secret:token,userName:accountId});
    await credentialStore('write',{secret:token+'-updated',userName:'api-token'});
    assert.deepEqual(await credentialStore('read',null),{secret:token+'-updated',userName:'api-token'});
  } finally { await credentialStore('remove',null); }
  assert.equal(await credentialStore('check',null),null);
});

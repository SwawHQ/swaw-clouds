import {credentialStore as systemStore} from '../../_shared/cloud/credential-store.mjs';

export const credentialTarget='swcl/edgeone/default';
export const credentialStore=(action,record)=>systemStore(credentialTarget,action,record);

export function tokenInput(value) {
  const token=typeof value?.token==='string'?value.token.trim():'';
  const site=value?.site;
  if (!token || token.length>4096 || /[\s\x00-\x1f\x7f]/.test(token) || !['china','global'].includes(site)) throw new Error('invalid_edgeone_token');
  return {token,site};
}

export async function verifyToken(value,request=fetch) {
  const {token,site}=tokenInput(value);
  const host=site==='china'?'pages-api.cloud.tencent.com':'pages-api.edgeone.ai';
  try {
    const response=await request('https://'+host+'/v1',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({Action:'DescribeUserInfo',Region:site==='china'?'ap-guangzhou':'ap-singapore'}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const body=await response.json(),data=body?.Data?.Response??body?.Data??body?.Response??body;
    if (!response.ok || !data || data.Error || data.Message || (data.Code!=null&&String(data.Code)!=='0') ||
        ![data.AppId,data.Uin,data.UserName].some(v=>(typeof v==='string'&&v.length>0)||(typeof v==='number'&&v>0))) throw new Error();
  } catch {throw new Error('edgeone_token_verification_failed');}
}

export async function edgeoneEnvironment(args,environment,store=credentialStore) {
  const env={...environment};
  if (process.platform==='win32') for(const key of Object.keys(env))
    if (/^EDGEONE_PAGES_/i.test(key)&&key!==key.toUpperCase()){env[key.toUpperCase()]=env[key];delete env[key];}
  // Credential-management commands must keep the native identity and storage rules.
  if (!args.length || ['login','logout','switch','workspace'].includes(args[0]) ||
      args.some(arg=>['--help','-h','--version','-v'].includes(arg)||/^(?:--token|-t)(?:=|$)/.test(arg)||/^-t[^-]/.test(arg)) ||
      env.EDGEONE_PAGES_API_TOKEN) return env;
  const record=await store('read');if(!record)return env;
  let value;try{value=tokenInput({token:record.secret,site:record.userName});}catch{throw new Error('invalid_edgeone_credential; run swcl edgeone/auth/setup');}
  return {...env,EDGEONE_PAGES_API_TOKEN:value.token,EDGEONE_PAGES_API_REGION:value.site};
}

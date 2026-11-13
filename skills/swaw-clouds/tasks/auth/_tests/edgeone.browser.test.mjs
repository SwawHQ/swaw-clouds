import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadChromium} from '../../_shared/browser/runtime.mjs';
import {startAuthPage} from '../page.mjs';
const copy=JSON.parse(fs.readFileSync(new URL('../page.json',import.meta.url),'utf8'));
for(const language of ['zh','en'])test('EdgeOne '+language+' page handles login, Token and environment independently',{timeout:30000},async()=>{
  const writes=[],logins=[],errors=[];let authorized=false,current='zone-one';
  const local=await startAuthPage({workspaces:async()=>[{id:'zone-one',name:'First',current:current==='zone-one',available:true},{id:'zone-two',name:'Second',current:current==='zone-two',available:true}],switchWorkspace:async id=>{current=id;},platform:'edgeone',language,environment:{EDGEONE_PAGES_API_TOKEN:'private-env'},
    store:async(platform,action,value)=>{if(action==='write')writes.push({platform,...value});return null;},verify:async()=>{},prepare:async()=>{},
    login:async tool=>{logins.push(tool);authorized=true;},check:async()=>authorized?{status:'authorized',workspaceName:'Test workspace',workspaceId:'workspace-1'}:'notAuthorized'});
  const chromium=loadChromium(),browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
  try {
    const page=await browser.newPage({viewport:{width:320,height:800}});page.on('pageerror',e=>errors.push(e.message));await page.goto(local.url);
    await page.locator('#edgeone-status').filter({hasText:copy[language].notAuthorized}).waitFor();assert.deepEqual(logins,[]);
    await page.locator('[data-tool="edgeone"]').click();await page.locator('#edgeone-status').filter({hasText:copy[language].authorized}).waitFor();
    assert.deepEqual(logins,['edgeone']);await page.locator('#edgeone-workspace-select option').first().waitFor({state:'attached'});assert.equal(await page.locator('#edgeone-workspace-select').inputValue(),'zone-one');
    assert.equal(await page.locator('#edgeone-workspace').textContent(),'First');
    const selectBox=await page.locator('#edgeone-workspace-select').boundingBox(),buttonBox=await page.locator('#edgeone-workspace-switch').boundingBox();assert.ok(buttonBox.x>=selectBox.x+selectBox.width);assert.ok(Math.abs(buttonBox.y-selectBox.y)<2);
    await page.locator('#edgeone-workspace-select').selectOption('zone-two');assert.equal(current,'zone-one');assert.equal(await page.locator('#edgeone-workspace').textContent(),'First');await page.locator('#edgeone-workspace-switch').click();await page.locator('#edgeone-workspace-status').filter({hasText:copy[language].edgeone.workspaceSwitched}).waitFor();assert.equal(current,'zone-two');assert.equal(await page.locator('#edgeone-workspace').textContent(),'Second');
    await page.locator('#edgeone-tab-token').click();await page.locator('#edgeone-token-input').fill('fixture-secret');await page.locator('#edgeone-site').selectOption('china');
    await page.locator('#platform-edgeone [data-save]').click();await page.locator('#platform-edgeone [data-status]').filter({hasText:copy[language].saved}).waitFor();
    assert.deepEqual(writes,[{platform:'edgeone',secret:'fixture-secret',userName:'china'}]);assert.equal(await page.locator('#edgeone-token-input').inputValue(),'');
    await page.locator('#edgeone-tab-environment').click();assert.equal(await page.locator('#platform-edgeone [data-env="EDGEONE_PAGES_API_TOKEN"]').textContent(),copy[language].set);
    assert.ok(!(await page.locator('body').textContent()).includes('private-env'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#tab-tencent').click();assert.equal(await page.locator('#tencent-tab-token').textContent(),copy[language].tencent.tabToken);
    await page.locator('#tab-edgeone').click();await page.locator('#edgeone-tab-login').click();await page.reload();
    await page.locator('#edgeone-status').filter({hasText:copy[language].authorized}).waitFor();assert.equal(logins.length,1);assert.deepEqual(errors,[]);
  }finally{local.close();await local.completed;await browser.close();}
});

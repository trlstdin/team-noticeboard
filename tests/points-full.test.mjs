import test from 'node:test';import assert from 'node:assert/strict';
import {trainCalibration} from '../scripts/points-calibrate.mjs';import native from '../worker/index.js';import interpreted from './interpreted-backend.mjs';let worker=native;
class Bucket{constructor(){this.value=null;this.rev=0;this.other=new Map();this.otherRevs=new Map()}async get(k){if(k&&k!=='noticeboard/journal-v1.json'){const v=this.other.get(k);return v?{etag:String(this.otherRevs.get(k)||0),json:async()=>JSON.parse(v)}:null}if(!this.value)return null;const value=this.value;return{etag:String(this.rev),json:async()=>JSON.parse(value)}}async put(k,value,o={}){if(k!=='noticeboard/journal-v1.json'){if(o.onlyIf?.etagMatches!==undefined&&String(this.otherRevs.get(k)||0)!==o.onlyIf.etagMatches)return null;this.other.set(k,value);this.otherRevs.set(k,(this.otherRevs.get(k)||0)+1);return {etag:String(this.otherRevs.get(k))}}if(o.onlyIf.etagMatches!==undefined&&String(this.rev)!==o.onlyIf.etagMatches)return null;if(o.onlyIf.etagDoesNotMatch==='*'&&this.value!==null)return null;this.value=value;this.rev++;return{etag:String(this.rev)}}}
function app(){
 const env={BUCKET:new Bucket(),DATA_KEY:'encryption-test-only',ROOT_GITHUB_ID:'1'};
 let provider=async url=>Response.json({id:[...url].reduce((n,c)=>n+c.charCodeAt(0),0),login:url.split('/').at(-1),type:'User'});
 Object.defineProperty(env,'GH_FETCH',{get(){return async(url,options={})=>{if(options.headers?.Authorization==='Bearer fixture-root-access'){if(url.endsWith('/user'))return Response.json({id:1,login:'owner'});if(url.includes('/memberships/'))return new Response('{}',{status:404});return Response.json({permissions:{admin:true,maintain:true,push:true}})}return provider(url,options)}},set(value){provider=value}});
 const ready=(async()=>{const {hash,encrypt}=await import('../worker/index.js');env.BUCKET.other.set('auth/'+await hash('root-test-only'),JSON.stringify({githubId:1,login:'owner',secret:await encrypt('fixture-root-access',env),expiresAt:Date.now()+1000000}))})();
 let version=0;return {env,async call(path,data,token='root-test-only'){await ready;const req=new Request('https://board.test/api/'+path,{method:data?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json',origin:'https://board.test'}:{})},body:data?JSON.stringify(data):undefined});const res=await worker.fetch(req,env,{waitUntil(){}});const body=await res.json();return{status:res.status,body,res}},async change(data,token){const r=await this.call('change',{...data,version},token);if(r.status===200)version=r.body.version;return r},async state(token){return(await this.call('state',undefined,token)).body}}
}
async function setup(){const a=app();assert.equal((await a.change({action:'repo.save',name:'A',url:'https://github.com/example/a'})).status,200);const repoId=(await a.state()).repos[0].id;await a.change({action:'user.save',repoId,name:'Editor',role:'editor'});const userId=(await a.state()).users[0].id;const token=(await a.change({action:'token.create',userId,scopes:['edit','copy']})).body.token;return{a,repoId,userId,token}}

for(const [name,backend] of [['native',native],['interpreted',interpreted]]){
 test(name+': rule approval, stale proposals, rollback, quotes and role boundaries',async()=>{
  worker=backend;const {a,repoId,token}=await setup();
  const proposal=await a.change({action:'points.workflow.create',type:'rules',prompt:'试运行每日10分',suggestion:{patch:{daily:10},explanation:'降低基础发行'}});assert.equal(proposal.status,200);const workflowId=proposal.body.workflowId;
  assert.equal((await a.state()).points.rules.daily,20);
  assert.equal((await a.change({action:'points.workflow.decide',id:workflowId,decision:'approve',reason:'无权批准'},token)).status,403);
  assert.equal((await a.change({action:'points.workflow.decide',id:workflowId,decision:'approve',reason:'主管批准试运行'})).status,200);
  let s=await a.state();assert.equal(s.points.rules.daily,10);assert.equal(s.points.rules.version,2);assert.equal(s.points.ruleHistory.length,1);
  assert.equal((await a.change({action:'points.workflow.decide',id:workflowId,decision:'approve',reason:'重复'})).status,409);
  const bad=await a.change({action:'points.workflow.create',type:'rules',prompt:'非法字段',suggestion:{patch:{version:99},explanation:'不应执行'}});assert.equal(bad.status,400);
  assert.equal((await a.change({action:'points.workflow.create',type:'rules',prompt:'费率越界',suggestion:{patch:{listingRate:0.9},explanation:'不应执行'}})).status,400);
  const next=await a.change({action:'points.workflow.create',type:'rules',prompt:'恢复发行',suggestion:{patch:{daily:20},explanation:'恢复原值'}});const stale=await a.change({action:'points.workflow.create',type:'rules',prompt:'另一建议',suggestion:{patch:{daily:15},explanation:'另一建议'}});
  await a.change({action:'points.workflow.decide',id:next.body.workflowId,decision:'approve',reason:'恢复'});
  assert.equal((await a.change({action:'points.workflow.decide',id:stale.body.workflowId,decision:'approve',reason:'旧版本'})).status,409);
  assert.equal((await a.change({action:'points.workflow.cancel',id:stale.body.workflowId,reason:'撤回过期建议'})).status,200);assert.equal((await a.call('points/assistant',{id:stale.body.workflowId})).body.workflow.status,'cancelled');
  await a.change({action:'task.save',repoId,title:'待开发池',proposer:'owner',column:6});s=await a.state();const t=s.tasks[0];assert.equal(t.pointQuote.listing[0],2);
  const signal=await a.change({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'阻塞关键依赖',suggestion:{blocking:3,explanation:'阻塞下游'}},token);assert.equal(signal.status,200);
  assert.equal((await a.change({action:'points.workflow.decide',id:signal.body.workflowId,decision:'approve',reason:'确认依赖'})).status,200);
  assert.equal((await a.state()).tasks[0].pointQuote.listing[0],3);
 });
 test(name+': evidence freshness, CI gates, observation period and quality review never auto-pay',async()=>{
  worker=backend;const {a,repoId,token}=await setup();await a.change({action:'task.save',repoId,title:'质量事项',proposer:'owner',column:1});let t=(await a.state()).tasks[0];await a.change({action:'task.claim',id:t.id},token);
  await a.change({action:'task.move',id:t.id,column:4,rank:0});assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);
  const evidence={action:'points.evidence',id:t.id,testsPassed:true,acceptancePassed:true,noRegression:true,notes:'测试记录与验收范围'};await a.change(evidence);
  assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);t=(await a.state()).tasks[0];assert.ok(Date.parse(t.pointEligibleAt)>Date.now());
  let journal=JSON.parse(a.env.BUCKET.value);journal.tasks[0].pointEligibleAt='2000-01-01T00:00:00Z';a.env.BUCKET.value=JSON.stringify(journal);
  const review=await a.change({action:'points.workflow.create',type:'quality',taskId:t.id,prompt:'质量审查',suggestion:{min:80,max:100,explanation:'通过测试但存在小风险'}},token);
  await a.change({action:'points.workflow.decide',id:review.body.workflowId,decision:'approve',reason:'质量审查通过'});assert.equal((await a.state(token)).points.balance,0);
  assert.equal((await a.change({action:'points.settle',id:t.id,quality:120})).status,400);
  assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,200);assert.equal((await a.state(token)).points.balance,5);
  assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);
  await a.change({action:'task.save',repoId,title:'第二事项',proposer:'owner',column:0});t=(await a.state()).tasks.find(v=>v.title==='第二事项');await a.change({action:'task.claim',id:t.id},token);await a.change({...evidence,id:t.id});
  await a.change({action:'task.save',id:t.id,repoId,title:'内容变化',body:'新版需求',proposer:'owner',column:4});assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);
  await a.change({...evidence,id:t.id});a.env.GH_FETCH=async url=>url.includes('check-runs')?Response.json({total_count:1,check_runs:[{name:'tests',status:'completed',conclusion:'failure'}]}):Response.json({statuses:[]});
  assert.equal((await a.change({action:'points.ci',id:t.id,commitUrl:'https://github.com/example/a/commit/'+'a'.repeat(40)})).status,200);
  assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);
  assert.equal((await a.change({action:'points.ci',id:t.id,commitUrl:'https://github.com/evil/other/commit/'+'a'.repeat(40)})).status,400);
 });
 test(name+': immutable reversals, debt recovery, donation, audit and private exports',async()=>{
  worker=backend;const {a,repoId,token}=await setup();await a.change({action:'points.daily'},token);let s=await a.state(token);const daily=s.points.ledger[0];await a.change({action:'points.donate',amount:15,reason:'支持公共协作'},token);
  assert.equal((await a.change({action:'points.reverse',entryId:daily.id,reason:'撤销错误赠送'},token)).status,403);
  assert.equal((await a.change({action:'points.reverse',entryId:daily.id,reason:'撤销错误赠送'})).status,200);assert.equal((await a.state(token)).points.balance,-15);
  assert.equal((await a.change({action:'points.reverse',entryId:daily.id,reason:'重复冲正'})).status,409);
  await a.change({action:'points.adjust',account:s.points.account,amount:20,reason:'确认更正'});assert.equal((await a.state(token)).points.balance,5);
  assert.equal((await a.call('points/audit')).body.ok,true);const myRows=await a.call('points/ledger?all=1',undefined,token);assert.ok(myRows.body.entries.every(l=>l.account===s.points.account));assert.equal((await a.call('points/export',undefined,token)).status,403);
  assert.equal((await a.call('points/ledger',undefined,'')).status,403);const exported=(await a.call('points/export')).body;assert.ok(exported.ledger.length>=4);assert.ok(!JSON.stringify(exported).includes('DATA_KEY'));
  const page=(await a.call('points/ledger?all=1&limit=2')).body;assert.equal(page.entries.length,2);assert.ok(page.nextBefore);const page2=(await a.call('points/ledger?all=1&limit=2&before='+page.nextBefore)).body;assert.notEqual(page.entries[0].id,page2.entries[0].id);
  const journal=JSON.parse(a.env.BUCKET.value);journal.points.ledger[0].amount++;a.env.BUCKET.value=JSON.stringify(journal);assert.equal((await a.call('points/audit')).body.ok,false);
 });
 test(name+': model suggestions use encrypted provider, durable checkpoints and strict approval',async()=>{
  worker=backend;const {a,repoId,token}=await setup();await a.change({action:'task.save',repoId,title:'需要语义评估',proposer:'owner',column:6});const t=(await a.state()).tasks[0];
  assert.equal((await a.change({action:'points.provider',enabled:true,model:'gpt-4.1-mini',apiKey:'private-ai-test-key',dailyLimit:10},token)).status,403);
  await a.change({action:'points.provider',enabled:true,model:'gpt-4.1-mini',apiKey:'private-ai-test-key',dailyLimit:10});
  for(const obj of [(await a.state()),(await a.call('points/export')).body])assert.ok(!JSON.stringify(obj).includes('private-ai-test-key'));assert.ok(!a.env.BUCKET.value.includes('private-ai-test-key'));
  let calls=0;a.env.AI_FETCH=async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(opts.headers.Authorization,'Bearer private-ai-test-key');return Response.json({choices:[{message:{content:JSON.stringify({blocking:2,explanation:'阻塞两项下游工作'})}}]})};
  const job=(await a.change({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'评估阻塞'},token)).body.workflowId;
  assert.equal((await a.call('points/assistant',{id:job},'')).status,403);
  const generated=await a.call('points/assistant',{id:job},token);assert.equal(generated.status,200);assert.equal(generated.body.workflow.status,'awaiting_approval');assert.equal(calls,1);
  const resumed=await a.call('points/assistant',{id:job},token);assert.equal(resumed.body.workflow.status,'awaiting_approval');assert.equal(calls,1);assert.equal((await a.state()).tasks[0].pointSignal,undefined);
  let s=await a.state();assert.equal((await a.call('change',{action:'points.workflow.decide',id:job,decision:'approve',reason:'确认',version:s.version})).status,200);assert.equal((await a.state()).tasks[0].pointSignal.blocking,2);
  s=await a.state();const fresh=(await a.call('change',{action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'异常输出',version:s.version},token)).body.workflowId;
  a.env.AI_FETCH=async()=>Response.json({choices:[{message:{content:'{"blocking":999,"explanation":"invalid"}'}}]});const failed=await a.call('points/assistant',{id:fresh},token);assert.equal(failed.body.workflow.status,'failed');assert.equal((await a.state()).tasks[0].pointSignal.blocking,2);
 });
}
for(const [name,backend] of [['native',native],['interpreted',interpreted]]){
 test(name+': approved critical repair weights and private evidence never enter public task snapshots/events',async()=>{
  worker=backend;const {a,repoId}=await setup();await a.change({action:'task.save',repoId,title:'严重修复',proposer:'owner',column:6});const t=(await a.state()).tasks[0];
  const proposed=await a.change({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'严重故障',suggestion:{blocking:0,severity:'critical',explanation:'经主管核实的严重故障'}});await a.change({action:'points.workflow.decide',id:proposed.body.workflowId,decision:'approve',reason:'确认严重性'});
  await a.change({action:'task.move',id:t.id,column:1,rank:0});assert.equal((await a.state()).tasks[0].pointWeight,8);await a.change({action:'task.claim',id:t.id});await a.change({action:'points.evidence',id:t.id,testsPassed:true,acceptancePassed:true,noRegression:true,notes:'private-quality-evidence-fixture'});await a.change({action:'task.move',id:t.id,column:4,rank:0});
  const guest=await a.state('');assert.equal(guest.tasks.length,1);assert.ok(Object.keys(guest.tasks[0]).every(k=>!k.startsWith('point')));const journal=JSON.parse(a.env.BUCKET.value);assert.ok(JSON.stringify(journal).includes('private-quality-evidence-fixture'));assert.ok(!JSON.stringify(journal.events.filter(e=>e.visibility==='public')).includes('private-quality-evidence-fixture'));
  const before=a.env.BUCKET.value;assert.equal((await a.change({action:'points.workflow.create',type:'rules',prompt:'非法权重类型',suggestion:{patch:{weights:null},explanation:'不应保存'}})).status,400);assert.equal(a.env.BUCKET.value,before);
 });
 test(name+': one model lease, concurrent journal changes preserved, usage limit and request collision enforced',async()=>{
  worker=backend;const {a,repoId,token}=await setup();await a.change({action:'task.save',repoId,title:'模型并发',proposer:'owner',column:6});const t=(await a.state()).tasks[0];await a.change({action:'points.provider',enabled:true,model:'gpt-4.1-mini',apiKey:'concurrency-fixture',dailyLimit:1});
  const job=(await a.change({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'评估'},token)).body.workflowId;let release,notify;const started=new Promise(resolve=>notify=resolve);let calls=0;a.env.AI_FETCH=async()=>{calls++;notify();await new Promise(resolve=>release=resolve);return Response.json({choices:[{message:{content:'{"blocking":1,"explanation":"建议"}'}}]})};
  const running=a.call('points/assistant',{id:job},token);await started;assert.equal((await a.call('points/assistant',{id:job},token)).status,409);let s=await a.state();assert.equal((await a.call('change',{action:'points.daily',version:s.version,requestId:'daily-lease-fixture'})).status,200);release();assert.equal((await running).status,200);assert.equal(calls,1);assert.equal((await a.state()).points.balance,20);
  s=await a.state();assert.equal((await a.call('change',{action:'points.donate',amount:1,reason:'different payload',version:s.version,requestId:'daily-lease-fixture'})).status,409);
  const second=(await a.call('change',{action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'超出上限',version:s.version},token)).body.workflowId;assert.equal((await a.call('points/assistant',{id:second},token)).status,429);assert.equal(calls,1);
 });
}
for(const [name,backend] of [['native',native],['interpreted',interpreted]])test(name+': calibration import verifies dataset provenance and requires approval with seven-day application limit',async()=>{
 worker=backend;const {a}=await setup();assert.equal((await a.change({action:'points.calibration.propose',report:{status:'proposal'},reason:'无数据不应通过'})).status,409);
 const rows=Array.from({length:90},(_,i)=>({id:'training-fixture-'+i,time:new Date(Date.UTC(2020,0,1)+i*7*86400000).toISOString(),state:'high',action:['hold','waitingRate:+5','pinGrowth:-5'][i%3],reward:i%3===1?5:i%3===0?1:0,usable:true}));let journal=JSON.parse(a.env.BUCKET.value);journal.points=journal.points||{accounts:{},ledger:[]};journal.points.calibration=rows;a.env.BUCKET.value=JSON.stringify(journal);
 let s=await a.state();let report=trainCalibration({calibration:rows,rules:s.points.rules});assert.equal(report.status,'proposal');
 assert.equal((await a.change({action:'points.calibration.propose',report:{...report,datasetHash:'tampered'},reason:'错误数据摘要'})).status,400);
 let proposed=await a.change({action:'points.calibration.propose',report,reason:'通过离线验证后提交'});assert.equal(proposed.status,200);assert.equal((await a.state()).points.rules.waitingRate,0.2);
 assert.equal((await a.change({action:'points.workflow.decide',id:proposed.body.workflowId,decision:'approve',reason:'人工批准离线建议'})).status,200);assert.equal((await a.state()).points.rules.waitingRate,0.21);
 s=await a.state();report=trainCalibration({calibration:rows,rules:s.points.rules});proposed=await a.change({action:'points.calibration.propose',report,reason:'同周第二次调参'});assert.equal(proposed.status,200);assert.equal((await a.change({action:'points.workflow.decide',id:proposed.body.workflowId,decision:'approve',reason:'不应同周再次应用'})).status,409);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import ts from 'typescript';import {instantiateBackend} from '../worker/interpreted-runtime.js';
import {createQwenGateway} from '../integrations/qwen-gateway/gateway.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const gatewayToken='a'.repeat(64),gatewayHash=createHash('sha256').update(gatewayToken).digest('hex');
const auth=(await readFile(new URL('../worker/github-auth.js',import.meta.url),'utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'');
const main=(await readFile(new URL('../worker/index.js',import.meta.url),'utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'').replace(/const QWEN_GATEWAY_HASH='[a-f0-9]+'/,"const QWEN_GATEWAY_HASH='"+gatewayHash+"'");
const native=(await import('data:text/javascript;base64,'+Buffer.from(auth+'\n'+main).toString('base64'))).default;
const interpreted=instantiateBackend(ts.transpileModule((auth+'\n'+main).replace('export default','var __noticeboardBackend ='),{compilerOptions:{target:ts.ScriptTarget.ES5,module:ts.ModuleKind.None,downlevelIteration:true}}).outputText).handler;let worker=native;

class Bucket{constructor(){this.value=null;this.rev=0;this.other=new Map();this.otherRevs=new Map()}async get(k){if(k&&k!=='noticeboard/journal-v1.json'){const v=this.other.get(k);return v?{etag:String(this.otherRevs.get(k)||0),json:async()=>JSON.parse(v)}:null}if(!this.value)return null;const value=this.value;return{etag:String(this.rev),json:async()=>JSON.parse(value)}}async put(k,value,o={}){if(k!=='noticeboard/journal-v1.json'){if(o.onlyIf?.etagMatches!==undefined&&String(this.otherRevs.get(k)||0)!==o.onlyIf.etagMatches)return null;this.other.set(k,value);this.otherRevs.set(k,(this.otherRevs.get(k)||0)+1);return {etag:String(this.otherRevs.get(k))}}if(o.onlyIf.etagMatches!==undefined&&String(this.rev)!==o.onlyIf.etagMatches)return null;if(o.onlyIf.etagDoesNotMatch==='*'&&this.value!==null)return null;this.value=value;this.rev++;return{etag:String(this.rev)}}}
function app(){
 const env={BUCKET:new Bucket(),DATA_KEY:'encryption-test-only',ROOT_GITHUB_ID:'1'};
 let provider=async url=>Response.json({id:[...url].reduce((n,c)=>n+c.charCodeAt(0),0),login:url.split('/').at(-1),type:'User'});
 Object.defineProperty(env,'GH_FETCH',{get(){return async(url,options={})=>{if(options.headers?.Authorization==='Bearer fixture-root-access'){if(url.endsWith('/user'))return Response.json({id:1,login:'owner'});if(url.includes('/memberships/'))return new Response('{}',{status:404});return Response.json({permissions:{admin:true,maintain:true,push:true}})}return provider(url,options)}},set(value){provider=value}});
 const ready=(async()=>{const {hash,encrypt}=await import('../worker/index.js');env.BUCKET.other.set('auth/'+await hash('root-test-only'),JSON.stringify({githubId:1,login:'owner',secret:await encrypt('fixture-root-access',env),expiresAt:Date.now()+1000000}))})();
 let version=0;return {env,async call(path,data,token='root-test-only'){await ready;const req=new Request('https://board.test/api/'+path,{method:data?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json',origin:'https://board.test'}:{})},body:data?JSON.stringify(data):undefined});const res=await worker.fetch(req,env,{waitUntil(){}});const body=await res.json();return{status:res.status,body,res}},async change(data,token){const r=await this.call('change',{...data,version},token);if(r.status===200)version=r.body.version;return r},async state(token){return(await this.call('state',undefined,token)).body}}
}
async function setup(){const a=app();assert.equal((await a.change({action:'repo.save',name:'A',url:'https://github.com/example/a'})).status,200);const repoId=(await a.state()).repos[0].id;await a.change({action:'user.save',repoId,name:'Editor',role:'editor'});const userId=(await a.state()).users[0].id;const token=(await a.change({action:'token.create',userId,scopes:['edit','copy']})).body.token;return{a,repoId,userId,token}}

function mutate(a){return async(b,token)=>a.call('change',{...b,version:(await a.state(token)).version},token)}
async function gw(a,action,body={},credential=gatewayToken){const r=await worker.fetch(new Request('https://board.test/api/points/gateway/'+action,{method:'POST',headers:{Authorization:'Gateway '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)}),a.env,{waitUntil(){}});return {status:r.status,body:await r.json()}}
for(const [name,backend] of [['native',native],['interpreted',interpreted]]){
 test(name+': Qwen queue claims and returns a validated proposal without gaining approval or monetary permission',async()=>{
  worker=backend;const {a,repoId,token}=await setup(),d=mutate(a);
  assert.equal((await gw(a,'claim',{},'wrong')).status,403);assert.equal((await a.call('points/model-test',{},gatewayToken)).status,403);
  await gw(a,'heartbeat',{workerId:'test-worker',model:'qwen3-vl:4b',ready:true});assert.equal((await a.state()).points.provider.source,'qwen-gateway');
  await d({action:'task.save',repoId,title:'私密目标',proposer:'owner',column:6});const t=(await a.state()).tasks[0];const id=(await d({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'判断依赖'},token)).body.workflowId;
  const queued=await a.call('points/ai',{id},token);assert.equal(queued.body.pending,true);assert.equal(queued.body.workflow.gatewayRequest.status,'queued');
  const claim=await gw(a,'claim',{workerId:'test-worker'});assert.equal(claim.status,200);const job=claim.body.job;assert.equal(job.id,id);assert.ok(!JSON.stringify(job).includes('root-test-only'));assert.ok(!JSON.stringify(job).includes(token));
  assert.equal((await gw(a,'claim',{workerId:'second-worker'})).body.job,null);assert.equal((await gw(a,'renew',{...job,messages:undefined})).status,200);
  const result={id,requestId:job.requestId,leaseToken:job.leaseToken,model:'qwen3-vl:4b',content:'{"blocking":2,"explanation":"本地千问建议"}'};
  assert.equal((await gw(a,'result',{...result,leaseToken:'invalid'})).status,409);assert.equal((await gw(a,'result',result)).body.status,'awaiting_approval');
  assert.equal((await gw(a,'result',result)).body.completed,true);assert.equal((await a.state()).tasks[0].pointSignal,undefined);assert.equal((await a.state()).points.ledger.length,0);
  assert.equal((await d({action:'points.workflow.decide',id,decision:'approve',reason:'不具备主管权限'},token)).status,403);await d({action:'points.workflow.decide',id,decision:'approve',reason:'人工确认'});assert.equal((await a.state()).tasks[0].pointSignal.blocking,2);
 });
 test(name+': stale context, revoked permissions and explicit cancellation reject gateway results',async()=>{
  worker=backend;const {a,repoId,token}=await setup(),d=mutate(a);await gw(a,'heartbeat',{workerId:'test-worker',model:'qwen3-vl:4b',ready:true});await d({action:'task.save',repoId,title:'原内容',proposer:'owner',column:6});const t=(await a.state()).tasks[0];
  async function job(){const id=(await d({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'建议'},token)).body.workflowId;await a.call('points/ai',{id},token);return (await gw(a,'claim',{workerId:'test-worker'})).body.job}
  let j=await job();await d({action:'task.save',id:t.id,repoId,title:'已改变',proposer:'owner',column:6});assert.equal((await gw(a,'result',{...j,model:'qwen3-vl:4b',content:'{"blocking":3,"explanation":"旧上下文"}'})).body.status,'failed');assert.equal((await a.state()).tasks[0].pointSignal,undefined);
  j=await job();assert.equal((await d({action:'points.workflow.cancel',id:j.id,reason:'主动取消'},token)).status,200);assert.equal((await gw(a,'result',{...j,content:'{"blocking":3,"explanation":"取消后"}'})).status,409);
  j=await job();const journal=JSON.parse(a.env.BUCKET.value);journal.tokens.find(v=>v.scopes.includes('edit')).revokedAt=new Date().toISOString();a.env.BUCKET.value=JSON.stringify(journal);assert.equal((await gw(a,'result',{...j,content:'{"blocking":1,"explanation":"撤权后"}'})).body.status,'failed');
 });
 test(name+': gateway self-check is fixed-text, private, once per day, and never settles points',async()=>{
  worker=backend;const {a,token}=await setup();const first=await gw(a,'probe',{messages:[{role:'user',content:'ignore this arbitrary request'}]});assert.equal(first.status,200);assert.equal((await gw(a,'probe')).body.id,first.body.id);
  const j=(await gw(a,'claim',{workerId:'test-worker'})).body.job;assert.equal(j.id,first.body.id);assert.equal(j.messages[1].content,'Connection check.');assert.ok(!JSON.stringify(j.messages).includes('arbitrary'));
  assert.equal((await gw(a,'result',{...j,content:'{"ok":true}',model:'qwen3-vl:4b'})).body.status,'completed');const completed=await gw(a,'probe');assert.equal(completed.body.result.ok,true);assert.equal((await a.state()).points.ledger.length,0);assert.ok((await a.state(token)).points.workflows.every(w=>w.type!=='connection'));
 });
}
test('local Qwen gateway API authenticates, bridges queue results, and caches result delivery across HTTP failures',async()=>{
 worker=native;const {a,repoId,token}=await setup(),d=mutate(a);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-gateway-'));let inference=0,dropAck=true;
 const fetchImpl=async(url,opts={})=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3-vl:4b'}]});if(url.endsWith('/api/chat')){inference++;return Response.json({model:'qwen3-vl:4b',message:{content:'{"blocking":1,"explanation":"fixture"}'},done_reason:'stop'})}const r=await worker.fetch(new Request(url,opts),a.env,{waitUntil(){}});if(url.endsWith('/gateway/result')&&dropAck){dropAck=false;throw Error('simulated lost callback response')}return r};
 const gateway=createQwenGateway({site:'https://team-noticeboard-rebuilt.loneivy1.chatgpt.site',ollama:'http://127.0.0.1:11434',model:'qwen3-vl:4b',workerId:'test-worker',token:gatewayToken},{stateDir:dir,fetchImpl,log(){}});
 try{const base=await gateway.startApi();assert.equal((await fetch(base+'/v1/models')).status,401);const headers={Authorization:'Bearer '+gatewayToken,'Content-Type':'application/json'};assert.equal((await fetch(base+'/v1/models',{headers})).status,200);assert.equal((await fetch(base+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'other-model',messages:[{role:'user',content:'hello'}]})})).status,400);
  await gateway.tick();await d({action:'task.save',repoId,title:'Gateway test',proposer:'owner',column:6});const t=(await a.state()).tasks[0],id=(await d({action:'points.workflow.create',type:'signal',taskId:t.id,prompt:'建议'},token)).body.workflowId;await a.call('points/ai',{id},token);
  await assert.rejects(gateway.tick());assert.equal(inference,1);await gateway.tick();assert.equal(inference,1);assert.equal((await a.state()).points.workflows.find(w=>w.id===id).status,'awaiting_approval');assert.ok(!JSON.stringify(await (await fetch(base+'/health')).json()).includes(gatewayToken));
 }finally{await gateway.stop();fs.rmSync(dir,{recursive:true,force:true})}
});

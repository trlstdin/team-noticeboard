import test from 'node:test';import assert from 'node:assert/strict';
import native from '../worker/index.js';import interpreted from './interpreted-backend.mjs';let worker=native;
class Bucket{constructor(){this.value=null;this.rev=0;this.other=new Map();this.otherRevs=new Map()}async get(k){if(k&&k!=='noticeboard/journal-v1.json'){const v=this.other.get(k);return v?{etag:String(this.otherRevs.get(k)||0),json:async()=>JSON.parse(v)}:null}if(!this.value)return null;const value=this.value;return{etag:String(this.rev),json:async()=>JSON.parse(value)}}async put(k,value,o={}){if(k!=='noticeboard/journal-v1.json'){if(o.onlyIf?.etagMatches!==undefined&&String(this.otherRevs.get(k)||0)!==o.onlyIf.etagMatches)return null;this.other.set(k,value);this.otherRevs.set(k,(this.otherRevs.get(k)||0)+1);return {etag:String(this.otherRevs.get(k))}}if(o.onlyIf.etagMatches!==undefined&&String(this.rev)!==o.onlyIf.etagMatches)return null;if(o.onlyIf.etagDoesNotMatch==='*'&&this.value!==null)return null;this.value=value;this.rev++;return{etag:String(this.rev)}}}
function app(){
 const env={BUCKET:new Bucket(),DATA_KEY:'encryption-test-only',ROOT_GITHUB_ID:'1'};
 let provider=async url=>Response.json({id:[...url].reduce((n,c)=>n+c.charCodeAt(0),0),login:url.split('/').at(-1),type:'User'});
 Object.defineProperty(env,'GH_FETCH',{get(){return async(url,options={})=>{if(options.headers?.Authorization==='Bearer fixture-root-access'){if(url.endsWith('/user'))return Response.json({id:1,login:'owner'});if(url.includes('/memberships/'))return new Response('{}',{status:404});return Response.json({permissions:{admin:true,maintain:true,push:true}})}return provider(url,options)}},set(value){provider=value}});
 const ready=(async()=>{const {hash,encrypt}=await import('../worker/index.js');env.BUCKET.other.set('auth/'+await hash('root-test-only'),JSON.stringify({githubId:1,login:'owner',secret:await encrypt('fixture-root-access',env),expiresAt:Date.now()+1000000}))})();
 let version=0;return {env,async call(path,data,token='root-test-only'){await ready;const req=new Request('https://board.test/api/'+path,{method:data?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json',origin:'https://board.test'}:{})},body:data?JSON.stringify(data):undefined});const res=await worker.fetch(req,env,{waitUntil(){}});const body=await res.json();return{status:res.status,body,res}},async change(data,token){const r=await this.call('change',{...data,version},token);if(r.status===200)version=r.body.version;return r},async state(token){return(await this.call('state',undefined,token)).body}}
}
async function setup(){const a=app();assert.equal((await a.change({action:'repo.save',name:'A',url:'https://github.com/example/a'})).status,200);const repoId=(await a.state()).repos[0].id;await a.change({action:'user.save',repoId,name:'Editor',role:'editor'});const userId=(await a.state()).users[0].id;const token=(await a.change({action:'token.create',userId,scopes:['edit','copy']})).body.token;return{a,repoId,userId,token}}

for(const [name,backend] of [['native',native],['interpreted',interpreted]])test(name+': points atomic lifecycle, replay, identity, permissions and insufficient funds',async()=>{
 worker=backend;const {a,repoId,token}=await setup();
 const create=column=>a.change({action:'task.save',repoId,title:'Points task',proposer:'owner',column});
 assert.equal((await create(6)).status,200);let s=await a.state();const t=s.tasks[0];assert.equal(s.points.balance,0);
 assert.equal((await a.change({action:'task.move',id:t.id,column:0,rank:0})).status,200);
 s=await a.state();assert.equal(s.points.balance,18);assert.equal(s.points.ledger.filter(l=>l.kind==='listing').length,1);
 await a.change({action:'task.move',id:t.id,column:6,rank:0});await a.change({action:'task.move',id:t.id,column:0,rank:0});assert.equal((await a.state()).points.balance,18);
 const req={action:'task.pin',id:t.id,pinned:true,requestId:'unique-pin'};await a.change(req);s=await a.state();assert.equal(s.points.balance,16);
 const replay=await a.call('change',{...req,version:0});assert.equal(replay.body.replayed,true);assert.equal((await a.state()).points.balance,16);
 await a.change({action:'task.move',id:t.id,column:0,rank:1024});assert.equal((await a.state()).points.balance,13);
 await a.change({action:'task.pin',id:t.id,pinned:false});await a.change({action:'task.pin',id:t.id,pinned:true});assert.equal((await a.state()).points.balance,9);
 await a.change({action:'points.daily'});assert.equal((await a.state()).points.balance,9);
 assert.equal((await a.change({action:'task.claim',id:t.id},token)).status,200);
 await a.change({action:'task.move',id:t.id,column:4,rank:0});
 assert.equal((await a.change({action:'points.settle',id:t.id,quality:100},token)).status,403);
 assert.equal((await a.change({action:'points.settle',id:t.id,quality:121})).status,400);
 assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,200);
 assert.equal((await a.state(token)).points.balance,8);
 assert.equal((await a.change({action:'points.settle',id:t.id,quality:100})).status,409);
 assert.equal((await a.state('')).points,null);
 assert.equal((await a.change({action:'points.daily'},'')).status,403);
 await a.change({action:'task.move',id:t.id,column:0,rank:2048});
 const before=a.env.BUCKET.value;assert.equal((await a.change({action:'task.move',id:t.id,column:0,rank:3072})).status,409);assert.equal(a.env.BUCKET.value,before);
});

test('daily cap and concurrent claims preserve one atomic ledger entry',async()=>{
 worker=native;const {a,token,userId}=await setup();
 const second=(await a.change({action:'token.create',userId,scopes:['edit','copy']})).body.token;
 assert.equal((await a.state(token)).points.account,(await a.state(second)).points.account);
 const version=(await a.state()).version;
 const results=await Promise.all([a.call('change',{action:'points.daily',version,requestId:'concurrent-a'},token),a.call('change',{action:'points.daily',version,requestId:'concurrent-b'},second)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 let s=await a.state(token);assert.equal(s.points.balance,20);assert.equal(s.points.ledger.length,1);
 const journal=JSON.parse(a.env.BUCKET.value);const w=journal.points.accounts[s.points.account];w.balance=95;w.lastDaily='2000-01-01';a.env.BUCKET.value=JSON.stringify(journal);
 assert.equal((await a.call('change',{action:'points.daily',version:s.version},second)).status,200);
 s=await a.state(token);assert.equal(s.points.balance,100);assert.equal(s.points.ledger[0].amount,5);
});

test('waiting price uses whole days and pin escalation resets after seven days',async()=>{
 const {listingPrice,nextPinPrice}=await import('../worker/index.js');const now='2026-11-10T00:00:00.000Z';
 assert.equal(listingPrice({createdAt:'2026-11-09T23:59:59.000Z'},0,now),2);
 assert.equal(listingPrice({createdAt:'2026-10-01T00:00:00.000Z'},0,now),3);
 assert.equal(listingPrice(null,2,now),1);
 assert.equal(nextPinPrice({pointPinAt:'2026-11-09T00:00:00.000Z',pointPinCount:1},now),3);
 assert.equal(nextPinPrice({pointPinAt:'2026-11-09T00:00:00.000Z',pointPinCount:200},now),8);
 assert.equal(nextPinPrice({pointPinAt:'2026-11-03T00:00:00.000Z',pointPinCount:200},now),2);
});

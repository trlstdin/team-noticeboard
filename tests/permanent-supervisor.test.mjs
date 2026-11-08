import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {instantiateBackend} from '../worker/interpreted-runtime.js';

// Substitute a fixture digest into both real execution engines. The production
// bearer is never read, embedded in fixtures, or committed to the repository.
const bearer='permanent-supervisor-test-fixture-only';
const digest=createHash('sha256').update(bearer).digest('hex');
const auth=(await readFile(new URL('../worker/github-auth.js',import.meta.url),'utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'');
const main=(await readFile(new URL('../worker/index.js',import.meta.url),'utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'').replace(/const PERMANENT_SUPERVISOR_HASH='[a-f0-9]{64}'/,"const PERMANENT_SUPERVISOR_HASH='"+digest+"'");
const native=(await import('data:text/javascript;base64,'+Buffer.from(auth+'\n'+main).toString('base64'))).default;
const code=ts.transpileModule((auth+'\n'+main).replace('export default','var __noticeboardBackend ='),{compilerOptions:{target:ts.ScriptTarget.ES5,module:ts.ModuleKind.None,downlevelIteration:true}}).outputText;
const interpreted=instantiateBackend(code).handler;
class Bucket{
 constructor(){this.records=new Map();this.rev=0;}
 async get(k){const v=this.records.get(k);return v?{etag:String(this.rev),json:async()=>JSON.parse(v)}:null;}
 async put(k,value){this.records.set(k,value);return {etag:String(++this.rev)};}
}
for(const [name,worker] of [['native',native],['interpreted',interpreted]]){
 test(name+': permanent supervisor works without GitHub, survives time and restores a cookie session',async()=>{
  const bucket=new Bucket(),env={BUCKET:bucket,GH_FETCH:()=>{throw Error('Permanent links must not depend on GitHub');}};
  const call=async(path,token,body,cookie)=>{
   const res=await worker.fetch(new Request('https://board.test/api/'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{}),...(body?{'content-type':'application/json',origin:'https://board.test'}:{})},body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});
   return {res,body:await res.json()};
  };
  assert.equal((await call('state')).body.actor.root,false);
  assert.equal((await call('state','invalid-bearer')).body.actor.root,false);
  let result=await call('state',bearer);assert.equal(result.body.actor.root,true);assert.equal(result.body.actor.manage,true);assert.equal(result.body.actor.edit,true);assert.equal(result.body.actor.canAccounts,true);assert.equal(result.body.actor.signedIn,false);
  const future=Date.now;try{Date.now=()=>future()+100*365*86400000;assert.equal((await call('state',bearer)).body.actor.root,true);}finally{Date.now=future;}
  result=await call('session',null,{token:bearer});assert.equal(result.res.status,200);const session=result.body.session;assert.match(result.res.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  result=await call('state',null,null,'board_session='+session);assert.equal(result.body.actor.root,true);
  result=await call('change',session,{action:'repo.save',version:result.body.version,name:'Authorized project',url:'https://github.com/example/project'});assert.equal(result.res.status,200);
  const second=await call('session',null,{token:session});assert.equal(second.res.status,200);assert.equal((await call('state',second.body.session)).body.actor.root,true);
  // Browser logout ends that cookie without invalidating the owner's link.
  await call('logout',session,{});assert.equal((await call('state',session)).body.actor.root,false);assert.equal((await call('state',bearer)).body.actor.root,true);
  // A private revocation record invalidates the bearer and all descendants.
  await bucket.put('capabilities/permanent-supervisor/'+digest,JSON.stringify({revokedAt:Date.now()}));
  assert.equal((await call('state',bearer)).body.actor.root,false);assert.equal((await call('state',second.body.session)).body.actor.root,false);assert.equal((await call('session',null,{token:bearer})).res.status,403);
  assert.equal((await call('state')).body.actor.root,false);
 });
}

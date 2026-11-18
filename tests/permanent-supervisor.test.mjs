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
 test(name+': obsolete master bearer and its descendants grant no supervisor access',async()=>{
  const bucket=new Bucket(),env={BUCKET:bucket,GH_FETCH:()=>{throw Error('No GitHub calls expected')}};
  const call=async(path,token,body)=>{const res=await worker.fetch(new Request('https://board.test/api/'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json',origin:'https://board.test'}:{})},body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});return {res,body:await res.json()};};
  for(const token of ['',bearer,'invalid']){const state=(await call('state',token)).body;assert.equal(state.actor.supervisor,false);assert.equal('root' in state.actor,false);}
  assert.equal((await call('session','',{token:bearer})).res.status,403);
  const child='old-child-session';await bucket.put('sessions/'+createHash('sha256').update(child).digest('hex'),JSON.stringify({parentType:'permanent-supervisor',parentHash:digest,expiresAt:Date.now()+86400000}));assert.equal((await call('state',child)).body.actor.supervisor,false);
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import native, {hash as nativeHash, decrypt as nativeDecrypt} from '../worker/index.js';
import interpreted, {hash as interpretedHash, decrypt as interpretedDecrypt} from './interpreted-backend.mjs';

class Bucket {
 constructor(){this.records=new Map();this.revisions=new Map();}
 async get(key){
  const value=this.records.get(key);
  return value?{etag:String(this.revisions.get(key)||0),json:async()=>JSON.parse(value)}:null;
 }
 async put(key,value,options={}){
  const revision=String(this.revisions.get(key)||0);
  if(options.onlyIf?.etagMatches!==undefined&&options.onlyIf.etagMatches!==revision)return null;
  if(options.onlyIf?.etagDoesNotMatch==='*'&&this.records.has(key))return null;
  this.records.set(key,value);this.revisions.set(key,Number(revision)+1);
  return {etag:String(Number(revision)+1)};
 }
}
for(const [name,worker,hash,decrypt] of [['native',native,nativeHash,nativeDecrypt],['interpreted',interpreted,interpretedHash,interpretedDecrypt]]){
 test(name+': source credential publishes without a human login and preserves assignments on address change',async()=>{
  const env={BUCKET:new Bucket(),DATA_KEY:'cast-fixture',CAST_PUBLISHERS:[{sourceId:'fixture-source',keyHash:await hash('fixture-key')}]};
  const call=async(path,body,key='fixture-key')=>{
   const response=await worker.fetch(new Request('https://board.test/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Cast-Publisher-Key':key},body:JSON.stringify(body)}),env,{waitUntil(){}});
   return {status:response.status,body:await response.json()};
  };
  const payload=url=>({sourceId:'fixture-source',entries:[{environmentId:'11',name:'环境 11',url}]});
  const first=await call('cast/sync',payload('https://old.trycloudflare.com/11/token/'));
  assert.equal(first.status,200);
  const accountId=first.body.published[0].id;
  let stored=JSON.parse(env.BUCKET.records.get('noticeboard/journal-v1.json'));
  stored.accounts[0].grants=['existing-user'];
  env.BUCKET.records.set('noticeboard/journal-v1.json',JSON.stringify(stored));
  const updated=await call('cast/sync',payload('https://new.trycloudflare.com/11/token/'));
  assert.equal(updated.status,200);assert.equal(updated.body.published[0].id,accountId);
  stored=JSON.parse(env.BUCKET.records.get('noticeboard/journal-v1.json'));
  assert.equal(stored.accounts.filter(a=>!a.deletedAt).length,1);
  assert.deepEqual(stored.accounts[0].grants,['existing-user']);
  assert.equal(await decrypt(stored.accounts[0].secret,env),'https://new.trycloudflare.com/11/token/');
  const version=stored.version;
  assert.equal((await call('cast/sync',payload('https://new.trycloudflare.com/11/token/'))).body.version,version);
  assert.equal((await call('cast/sync',{...payload('https://new.trycloudflare.com/'),sourceId:'other'})).status,403);
  assert.equal((await call('cast/sync',payload('https://new.trycloudflare.com/'),'wrong-key')).status,403);
  assert.equal((await call('change',{action:'repo.save',name:'Unauthorized',url:'https://github.com/a/b'})).status,403);
 });
}

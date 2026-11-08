import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import native from '../worker/index.js';
import interpreted from './interpreted-backend.mjs';

const snapshot=JSON.parse(await readFile(new URL('../public-state.json',import.meta.url),'utf8'));
const marker='2026-11-08-software-and-development';
const journalKey='noticeboard/journal-v1.json';
const softwareId='e5a406bf-7040-47e2-a581-b43af2748e35';
const inputId='b54009f4-5e6b-43c3-8104-011bebddfe3f';
function fixture(){
 const s=structuredClone(snapshot);
 s.version=277;s.events=[{id:'private-existing-event',hash:'previous-private-hash',visibility:'private'}];
 s.accounts=[{id:'private-account',secret:{iv:[1],data:[2]},name:'private',grants:[]}];
 s.users=[{id:'private-user',role:'viewer',name:'private'}];s.tokens=[{id:'private-token',hash:'private-hash',repoIds:[s.repos[0].id]}];
 return s;
}
class Bucket{
 constructor(s){this.value=JSON.stringify(s);this.rev=1;this.reject=false;this.writes=0;}
 async get(k){if(k!==journalKey)return null;const value=this.value,etag=String(this.rev);return {etag,json:async()=>JSON.parse(value)};}
 async put(k,value,options){assert.equal(k,journalKey);assert.ok(options.onlyIf.etagMatches);if(this.reject||options.onlyIf.etagMatches!==String(this.rev))return null;this.value=value;this.writes++;return {etag:String(++this.rev)};}
}
const state=(worker,bucket)=>worker.fetch(new Request('https://board.test/api/state'),{BUCKET:bucket},{});
for(const [name,worker] of [['native',native],['interpreted',interpreted]]){
 test(name+': approved content merges once, keeps private data and unique history IDs',async()=>{
  const before=fixture(),bucket=new Bucket(before),response=await state(worker,bucket);
  assert.equal(response.status,200);const visible=await response.json(),saved=JSON.parse(bucket.value);
  assert.equal(saved.tasks.length,before.tasks.length+5);
  assert.ok(saved.contentUpdates[marker]);assert.equal(saved.version,287);
  for(const key of ['accounts','users','tokens','repos','notes'])assert.deepEqual(saved[key],before[key]);
  assert.deepEqual(saved.events[0],before.events[0]);assert.equal(saved.events[1].previousHash,'previous-private-hash');
  assert.equal(saved.events.length,11);assert.equal(new Set(saved.tasks.map(t=>t.historyNumber)).size,saved.tasks.length);
  assert.equal(saved.tasks.find(t=>t.id===inputId).mergedInto,softwareId);
  assert.ok(saved.tasks.find(t=>t.id===inputId).deletedAt);
  const software=saved.tasks.find(t=>t.id===softwareId);assert.equal(software.historyNumber,47);
  assert.match(software.body,/收藏夹/);assert.match(software.body,/语音第三代方案/);
  for(const t of before.tasks){const updated=saved.tasks.find(v=>v.id===t.id);assert.equal(updated.historyNumber,t.historyNumber);assert.equal(updated.column,t.column);if(![softwareId,inputId,'a239cd16-4270-4749-8fb0-276c878c6df5','3d4a6b0a-eeb9-4538-ac67-5c54fa150bb3','cd82580f-89b6-4b7b-9b29-0f2f53160da6'].includes(t.id))assert.deepEqual(updated,t);}
  const added=saved.tasks.slice(before.tasks.length);assert.ok(added.every(t=>t.column===0&&t.body.split('\n').length===2));
  assert.ok(added.filter(t=>t.title!=='AI 视频生成').every(t=>!t.repositoryUrl&&!t.personalRepositoryUrl));
  assert.deepEqual(visible.accounts,[]);assert.deepEqual(visible.users,[]);assert.deepEqual(visible.tokens,[]);assert.ok(visible.tasks.every(t=>t.column===4));
  const original=bucket.value;assert.equal((await state(worker,bucket)).status,200);assert.equal(bucket.value,original);assert.equal(bucket.writes,1);
  // A later user's edits or deletion must survive subsequent reads.
  saved.tasks.find(t=>t.id===softwareId).body='later user edit';added[0].deletedAt='later deletion';bucket.value=JSON.stringify(saved);
  await state(worker,bucket);assert.equal(JSON.parse(bucket.value).tasks.find(t=>t.id===softwareId).body,'later user edit');assert.equal(bucket.writes,1);
 });
 test(name+': conflicting writes and changed merge targets leave the journal intact',async()=>{
  for(const mode of ['etag','target']){const s=fixture();if(mode==='target')s.tasks=s.tasks.filter(t=>t.id!==inputId);const bucket=new Bucket(s);bucket.reject=mode==='etag';const before=bucket.value;assert.equal((await state(worker,bucket)).status,409);assert.equal(bucket.value,before);assert.equal(bucket.writes,0);}
 });
 test(name+': concurrent readers commit only one content update',async()=>{
  const bucket=new Bucket(fixture());const results=await Promise.all([state(worker,bucket),state(worker,bucket)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(bucket.writes,1);assert.equal(JSON.parse(bucket.value).version,287);
 });
}

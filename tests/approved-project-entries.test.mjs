import test from 'node:test';
import assert from 'node:assert/strict';
import native from '../worker/index.js';
import interpreted from './interpreted-backend.mjs';

const key='noticeboard/journal-v1.json',marker='2026-11-09-task69-and-three-projects';
const repoId='7d22d89f-9eac-410c-9b29-27f52e26d63c';
const targetId='34b3095c-0404-4898-a118-a54b1355e7d3';
function fixture(){
 const task=(id,historyNumber)=>({id,historyNumber,repoId,title:'保持原标题'+historyNumber,body:'保持原文',proposer:'保持提出者',assignee:'保持认领人',host:'保持主机',finisher:'保持完成者',column:2,rank:1024,createdAt:'2026-11-08T00:00:00Z',updatedAt:'2026-11-08T01:00:00Z',repositoryUrl:'',personalRepositoryUrl:''});
 return {version:369,nextTaskHistoryNumber:72,repos:[{id:repoId,name:'team-noticeboard',url:'https://github.com/trlstdin/team-noticeboard'}],tasks:[task(targetId,69),task('unrelated70',70),task('unrelated71',71)],events:[{id:'existing',seq:369,visibility:'private',hash:'previous-hash'}],accounts:[{id:'private-account',secret:{iv:[1],data:[2]},grants:[]}],users:[{id:'private-user'}],tokens:[{id:'private-token',hash:'private',repoIds:[repoId]}],notes:['原说明'],contentUpdates:{'2026-11-08-software-and-development':{version:300}}};
}
class Bucket{
 constructor(s){this.value=JSON.stringify(s);this.rev=1;this.reject=false;this.writes=0;}
 async get(k){if(k!==key)return null;const value=this.value,etag=String(this.rev);return {etag,json:async()=>JSON.parse(value)};}
 async put(k,value,options){assert.equal(k,key);if(this.reject||options.onlyIf.etagMatches!==String(this.rev))return null;this.value=value;this.writes++;return {etag:String(++this.rev)};}
}
const read=(worker,bucket)=>worker.fetch(new Request('https://board.test/api/state'),{BUCKET:bucket},{});
for(const [name,worker] of [['native',native],['interpreted',interpreted]]){
 test(name+': approved batch changes only task69 links and adds the three requested projects',async()=>{
  const before=fixture(),bucket=new Bucket(before);assert.equal((await read(worker,bucket)).status,200);const after=JSON.parse(bucket.value);
  assert.equal(after.version,373);assert.equal(after.tasks.length,6);assert.ok(after.contentUpdates[marker]);
  const target=after.tasks.find(t=>t.id===targetId),original=before.tasks[0];
  assert.equal(target.repositoryUrl,'https://github.com/alistrode/omnidispatch');assert.equal(target.personalRepositoryUrl,'https://github.com/trlstdin/rororororo/tree/projects/omnidispatch');
  for(const field of Object.keys(original))if(!['repositoryUrl','personalRepositoryUrl','updatedAt'].includes(field))assert.deepEqual(target[field],original[field]);
  for(const t of before.tasks.slice(1))assert.deepEqual(after.tasks.find(v=>v.id===t.id),t);
  for(const field of ['repos','accounts','users','tokens','notes'])assert.deepEqual(after[field],before[field]);
  const added=after.tasks.slice(3);assert.deepEqual(added.map(t=>t.historyNumber),[72,73,74]);assert.deepEqual(added.map(t=>t.title),['栗灯AI主播','循价：跨平台商品比价、模拟交易与结算','DevSpace本地开发MCP服务']);assert.ok(added.every(t=>t.column===0&&t.personalRepositoryUrl));
  assert.equal(after.events.length,5);assert.deepEqual(after.events[0],before.events[0]);assert.equal(after.events[1].previousHash,'previous-hash');assert.ok(after.events.slice(1).every(e=>e.visibility==='public'&&e.action==='task.save'&&e.contentUpdate===marker));
  const committed=bucket.value;await read(worker,bucket);assert.equal(bucket.value,committed);assert.equal(bucket.writes,1);
  target.repositoryUrl='https://github.com/user/later-edit';added[0].deletedAt='later deletion';bucket.value=JSON.stringify(after);const later=bucket.value;await read(worker,bucket);assert.equal(bucket.value,later);
 });
 test(name+': an existing requested project is preserved rather than duplicated',async()=>{
  const s=fixture();s.tasks.push({...s.tasks[1],id:'existing-devspace',historyNumber:72,title:'用户现有DevSpace',body:'保留用户内容',repositoryUrl:'https://github.com/alistrode/devspace-vm',personalRepositoryUrl:'https://github.com/trlstdin/rororororo/tree/projects/devspace-vm-20261030'});const old=s.tasks.at(-1),bucket=new Bucket(s);assert.equal((await read(worker,bucket)).status,200);const after=JSON.parse(bucket.value);assert.equal(after.tasks.length,s.tasks.length+2);assert.deepEqual(after.tasks.find(t=>t.id===old.id),old);
 });
 test(name+': conflicts or a changed target preserve the complete journal',async()=>{
  for(const mode of ['etag','missing','different-link']){const s=fixture();if(mode==='missing')s.tasks.shift();if(mode==='different-link')s.tasks[0].repositoryUrl='https://github.com/user/other';const bucket=new Bucket(s);bucket.reject=mode==='etag';const before=bucket.value;assert.equal((await read(worker,bucket)).status,409);assert.equal(bucket.value,before);assert.equal(bucket.writes,0);}
 });
 test(name+': concurrent readers commit the approved batch once',async()=>{
  const bucket=new Bucket(fixture());const results=await Promise.all([read(worker,bucket),read(worker,bucket)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(bucket.writes,1);assert.equal(JSON.parse(bucket.value).tasks.length,6);
 });
}

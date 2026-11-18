import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../web/collaboration.js',import.meta.url),'utf8');
function client(api){const context=vm.createContext({crypto:webcrypto,api,pendingMutations:0,mutationTail:Promise.resolve(),state:{tasks:[]},$:()=>({open:false}),refresh:async()=>{},toast(){},statuses:[]});vm.runInContext(source,context);vm.runInContext('operationStatus=(message,state,retry)=>statuses.push({message,state,retry})',context);return context;}
test('uncertain automatic and manual retries retain the original operation identifier',async()=>{
 const ids=[];let saved=false;const c=client(async(path,data)=>{if(path.startsWith('operation?'))return {state:'unknown'};ids.push(data.requestId);if(!saved)throw Object.assign(Error('temporary'),{status:503});return {state:'completed'};});
 await assert.rejects(c.runMutation('change',{action:'task.save',title:'Draft'}));const retry=c.statuses.findLast(s=>s.retry).retry;assert.equal(ids.length,2);saved=true;await retry();assert.equal(ids.length,3);assert.equal(new Set(ids).size,1);assert.equal(c.pendingMutations,0);
});
test('adopting the server version never sends a second mutation',async()=>{
 let writes=0;const c=client(async()=>{writes++;throw Object.assign(Error('conflict'),{status:409,code:'ITEM_CONFLICT',conflict:{mine:{title:'mine'},theirs:{title:'server'}}});});vm.runInContext("chooseItemVersion=async()=> 'theirs'",c);const result=await c.runMutation('change',{action:'task.save',title:'mine'});assert.equal(result.discarded,true);assert.equal(writes,1);
});
test('choosing a note draft retries against the displayed server note with the same identifier',async()=>{
 const payloads=[];const c=client(async(_path,data)=>{payloads.push(data);if(payloads.length===1)throw Object.assign(Error('conflict'),{status:409,code:'ITEM_CONFLICT',conflict:{kind:'note',mine:{body:'draft'},theirs:{body:'updated'},revision:'updated'}});return {state:'completed'};});vm.runInContext("chooseItemVersion=async()=> 'mine'",c);await c.runMutation('change',{action:'note.save',repoId:'r',column:0,note:'draft',baseNote:'old'});assert.equal(payloads[1].note,'draft');assert.equal(payloads[1].baseNote,'updated');assert.equal(payloads[0].requestId,payloads[1].requestId);
});
test('pending moves survive incoming snapshots and acknowledgement preserves the newer local intent',async()=>{
 let release;const gate=new Promise(r=>release=r);let revision=1;const c=client(async(_path,data)=>{await gate;return {version:++revision,task:{id:'t',column:data.column,rank:0,revision}}});c.state={version:1,tasks:[{id:'t',column:0,rank:0,revision:1}]};
 const first=c.runMutation('change',{action:'task.place',id:'t',column:1,order:['t']});
 c.state.tasks=[{id:'t',column:0,rank:0,revision:1}];c.overlayTaskIntents();assert.equal(c.state.tasks[0].column,1);
 const second=c.runMutation('change',{action:'task.place',id:'t',column:2,order:['t']});assert.equal(c.state.tasks[0].column,2);
 c.state.tasks=[];c.overlayTaskIntents();assert.equal(c.state.tasks[0].column,2);
 release();await Promise.all([first,second]);assert.equal(c.state.tasks[0].column,2);assert.equal(c.pendingMutations,0);
});

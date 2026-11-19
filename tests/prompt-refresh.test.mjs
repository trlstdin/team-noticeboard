import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const worker=await readFile(new URL('../worker/index.js',import.meta.url),'utf8');
test('unchanged-version polling returns saved prompt counts only for editable tasks',async()=>{
 const context=vm.createContext({canEdit:(actor,repo)=>actor.edit&&repo==='allowed',actorSnapshot:()=>({}),canBoard:()=>true});
 vm.runInContext(worker.slice(worker.indexOf('function savedPrompts('),worker.indexOf('\nfunction snapshot(')),context);
 vm.runInContext(worker.slice(worker.indexOf('async function stateDelta('),worker.indexOf('\nasync function waitForUpdates(')),context);
 const state={version:5,events:[],tasks:[{id:'a',repoId:'allowed'},{id:'b',repoId:'private'}],taskPrompts:{a:{prompts:['saved']},b:{prompts:['private']}}};
 const result=await context.stateDelta(state,{edit:true},{},5,'etag');
 assert.deepEqual(JSON.parse(JSON.stringify(result.savedPromptCounts)),{a:1});
 const anonymous=await context.stateDelta(state,{edit:false},{},5,'etag');
 assert.equal(anonymous.savedPromptCounts,undefined);
 assert.equal(anonymous.savedPrompts,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.savedPrompts)),{a:{prompts:['saved']}});
});

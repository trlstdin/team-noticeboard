import test from 'node:test';import assert from 'node:assert/strict';
import {createPointsGraph} from '../integrations/points-agent/run.mjs';import {trainCalibration} from '../scripts/points-calibrate.mjs';
test('actual LangGraph interrupts for human approval and recovers authoritative workflow without rerunning model',async()=>{
 let workflow=null,creates=0,generations=0;
 const client=async(path,body)=>{if(path==='state')return {version:1};if(path==='change'){creates++;workflow={id:'flow-1',type:'signal',status:'queued'};return {workflowId:workflow.id}}if(path.startsWith('points/workflow'))return {workflow};if(path==='points/assistant'){generations++;workflow={...workflow,status:'awaiting_approval'};return {workflow}}throw Error('Unexpected endpoint')};
 const result=await createPointsGraph(client).invoke({type:'signal',taskId:'task-1',prompt:'评估依赖'},{configurable:{thread_id:'thread-1'}});assert.equal(result.workflowId,'flow-1');assert.ok(result.__interrupt__?.length);assert.equal(creates,1);assert.equal(generations,1);
 workflow={...workflow,status:'approved'};const recovered=await createPointsGraph(client).invoke({workflowId:'flow-1'},{configurable:{thread_id:'recovered'}});assert.equal(recovered.workflow.status,'approved');assert.equal(generations,1);assert.equal(creates,1);
});
test('offline calibration refuses insufficient samples and produces only bounded proposals after validation',()=>{
 assert.equal(trainCalibration({calibration:[]}).status,'insufficient_data');
 const actions=['hold','waitingRate:+5','pinGrowth:-5'];const calibration=Array.from({length:90},(_,i)=>({id:'sample-'+i,time:new Date(Date.UTC(2020,0,1)+i*7*86400000).toISOString(),state:'high',action:actions[i%3],reward:i%3===1?5:i%3===0?1:0,usable:true}));
 const result=trainCalibration({calibration,rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(result.status,'proposal');assert.deepEqual(result.patch,{waitingRate:0.21});assert.equal(result.baseRuleVersion,3);assert.ok(result.holdoutImprovement>0);
 const bad=trainCalibration({calibration:[...calibration,{...calibration[0]}],rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(bad.status,'insufficient_data');
 const coverage=trainCalibration({calibration:calibration.map(r=>({...r,action:'hold'})),rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(coverage.status,'insufficient_coverage');
});

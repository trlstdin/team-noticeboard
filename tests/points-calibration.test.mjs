import test from 'node:test';import assert from 'node:assert/strict';
import {trainCalibration} from '../scripts/points-calibrate.mjs';
test('offline calibration refuses insufficient samples and produces only bounded proposals after validation',()=>{
 assert.equal(trainCalibration({calibration:[]}).status,'insufficient_data');
 const actions=['hold','waitingRate:+5','pinGrowth:-5'];const calibration=Array.from({length:90},(_,i)=>({id:'sample-'+i,time:new Date(Date.UTC(2020,0,1)+i*7*86400000).toISOString(),state:'high',action:actions[i%3],reward:i%3===1?5:i%3===0?1:0,usable:true}));
 const result=trainCalibration({calibration,rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(result.status,'proposal');assert.deepEqual(result.patch,{waitingRate:0.21});assert.equal(result.baseRuleVersion,3);assert.ok(result.holdoutImprovement>0);
 const bad=trainCalibration({calibration:[...calibration,{...calibration[0]}],rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(bad.status,'insufficient_data');
 const coverage=trainCalibration({calibration:calibration.map(r=>({...r,action:'hold'})),rules:{version:3,waitingRate:0.2,pinGrowth:1}});assert.equal(coverage.status,'insufficient_coverage');
});

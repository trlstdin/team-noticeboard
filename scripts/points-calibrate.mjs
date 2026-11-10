// Offline, conservative tabular Q-learning. Never calls the board or changes a price.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
export const CALIBRATION_ACTIONS=['hold','waitingRate:-10','waitingRate:-5','waitingRate:+5','waitingRate:+10','pinGrowth:-10','pinGrowth:-5','pinGrowth:+5','pinGrowth:+10'];
export function trainCalibration(bundle){
 const rows=(bundle.calibration||[]).filter(r=>r.usable!==false).sort((a,b)=>a.time.localeCompare(b.time));const reason=[];
 if(rows.length<50)reason.push('至少需要50个有效周观测');
 const seen=new Set();for(let i=0;i<rows.length;i++){const r=rows[i];if(!['low','medium','high'].includes(r.state)||!CALIBRATION_ACTIONS.includes(r.action)||!Number.isFinite(r.reward)||!Number.isFinite(Date.parse(r.time))||seen.has(r.id))reason.push('观测格式、奖励或唯一编号无效');seen.add(r.id);if(i&&Date.parse(r.time)-Date.parse(rows[i-1].time)<6*86400000)reason.push('观测周期重叠或间隔不足');}
 if(reason.length)return {status:'insufficient_data',samples:rows.length,reasons:[...new Set(reason)],patch:null};
 // Chronological holdout avoids learning from future validation outcomes.
 const split=Math.floor(rows.length*0.8),train=rows.slice(0,split),holdout=rows.slice(split),q={},counts={};
 for(const r of train){q[r.state]=q[r.state]||{};counts[r.state]=counts[r.state]||{};q[r.state][r.action]=0;counts[r.state][r.action]=(counts[r.state][r.action]||0)+1}
 const eligible=(state)=>Object.keys(counts[state]||{}).filter(a=>counts[state][a]>=3);
 for(let epoch=0;epoch<100;epoch++)for(let i=0;i<train.length-1;i++){
  const r=train[i],next=train[i+1],nextState=r.nextState||next.state,actions=eligible(nextState);const future=actions.length?Math.max(...actions.map(a=>q[nextState][a]||0)):0;
  q[r.state][r.action]+=0.1*(r.reward+0.9*future-q[r.state][r.action]);
 }
 const current=rows.at(-1).nextState||rows.at(-1).state,actions=eligible(current);if(!actions.includes('hold')||actions.length<3)return {status:'insufficient_coverage',samples:rows.length,reasons:['当前状态需覆盖保持不变及至少两个调参动作，每个动作至少3条训练样本'],patch:null};
 const conservative=a=>q[current][a]-1/Math.sqrt(counts[current][a]);const best=actions.reduce((a,b)=>conservative(b)>conservative(a)?b:a,'hold');
 const validation=holdout.filter(r=>r.state===current),chosen=validation.filter(r=>r.action===best),baseline=validation.filter(r=>r.action==='hold');
 if(best==='hold')return {status:'keep',samples:rows.length,action:best,patch:null,reasons:['保守估计未发现优于保持参数的动作'],q,counts};
 if(chosen.length<2||baseline.length<2)return {status:'insufficient_validation',samples:rows.length,action:best,patch:null,reasons:['时间留出集缺少候选动作或基线观测'],q,counts};
 const mean=list=>list.reduce((n,r)=>n+r.reward,0)/list.length;const improvement=mean(chosen)-mean(baseline);
 if(improvement<=0)return {status:'keep',samples:rows.length,patch:null,reasons:['候选动作未通过留出集收益比较'],q,counts};
 const [field,percent]=best.split(':'),rules=bundle.rules||{},base=rules[field];if(!Number.isFinite(base)||base<=0)return {status:'invalid_rules',patch:null,reasons:['缺少有效当前参数']};
 const value=Math.round(base*(1+Number(percent)/100)*1000000)/1000000,limits=field==='waitingRate'?[0,0.5]:[0.5,2];if(value<limits[0]||value>limits[1])return {status:'bounded',patch:null,reasons:['建议超出硬边界']};
 return {status:'proposal',datasetHash:createHash('sha256').update(JSON.stringify({rules:bundle.rules,calibration:rows})).digest('hex'),samples:rows.length,action:best,patch:{[field]:value},baseRuleVersion:rules.version,holdoutImprovement:improvement,algorithm:{name:'offline-tabular-q-learning',alpha:0.1,gamma:0.9,epochs:100,chronologicalTrainFraction:0.8},warning:'观察数据受任务难度和人员变化影响，不代表因果效果；仅限每周或每月人工审批采用。',q,counts};
}
export async function run(args=process.argv.slice(2)){const input=args[0],output=args[1];if(!input||!output)throw Error('用法：node scripts/points-calibrate.mjs 积分审计包.json 建议输出.json');const bundle=JSON.parse(await readFile(input,'utf8'));const result=trainCalibration(bundle);await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,samples:result.samples||0,output}))}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e.message);process.exitCode=1});

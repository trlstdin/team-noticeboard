// Optional Node runner; all authoritative checkpoints remain in the board's journal.
import {StateGraph,Annotation,START,END,MemorySaver,interrupt} from '@langchain/langgraph';
import {pathToFileURL} from 'node:url';
export function createPointsGraph(client){
 const State=Annotation.Root({workflowId:Annotation(),workflow:Annotation(),type:Annotation(),taskId:Annotation(),prompt:Annotation()});
 return new StateGraph(State)
  .addNode('checkpoint',async state=>{
   if(state.workflowId){const r=await client('points/workflow?id='+encodeURIComponent(state.workflowId));return {workflow:r.workflow}}
   const current=await client('state');const r=await client('change',{action:'points.workflow.create',type:state.type,taskId:state.taskId,prompt:state.prompt,version:current.version,requestId:crypto.randomUUID()});return {workflowId:r.workflowId,workflow:(await client('points/workflow?id='+r.workflowId)).workflow};
  })
  .addNode('generate',async state=>({workflow:(await client('points/assistant',{id:state.workflowId})).workflow}))
  .addNode('human_approval',state=>{interrupt({workflowId:state.workflowId,status:state.workflow.status,message:'在告示板积分中心人工审批；此运行器没有记账节点。'});return {}})
  .addEdge(START,'checkpoint')
  .addConditionalEdges('checkpoint',s=>['approved','rejected','cancelled'].includes(s.workflow.status)?END:s.workflow.status==='awaiting_approval'||s.workflow.type==='appeal'?'human_approval':'generate')
  .addConditionalEdges('generate',s=>s.workflow.status==='awaiting_approval'?'human_approval':END)
  .addEdge('human_approval',END).compile({checkpointer:new MemorySaver()});
}
function parseArgs(args){const out={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('参数必须使用 --名称 值');out[args[i].slice(2)]=args[i+1]}return out}
export async function run(args=process.argv.slice(2)){
 const opts=parseArgs(args),base=new URL(opts.url||'https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/');if(!['team-noticeboard-rebuilt.loneivy1.chatgpt.site','127.0.0.1','localhost'].includes(base.hostname)||base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw Error('仅支持现有站点或本地测试地址');const token=process.env.NOTICEBOARD_SESSION;if(!token)throw Error('缺少 NOTICEBOARD_SESSION 环境变量；不要把会话写在命令行参数或文件中');
 const client=async(path,body)=>{const r=await fetch(new URL('/api/'+path,base),{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const value=await r.json();if(!r.ok)throw Error(value.error||'请求失败');return value};
 const graph=createPointsGraph(client);const result=await graph.invoke({workflowId:opts.workflow,type:opts.type,taskId:opts.task,prompt:opts.prompt},{configurable:{thread_id:opts.workflow||crypto.randomUUID()}});
 if(result.workflow?.status==='failed')process.exitCode=1;console.log(JSON.stringify({workflowId:result.workflowId,status:result.workflow?.status,interrupt:result.__interrupt__?.map(i=>i.value),error:result.workflow?.error||null},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e.message);process.exitCode=1});

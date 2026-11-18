'use strict';
let currentFormScope='',directoryValue=null,directoryUntil=0,liveStopped=false,liveController=null,refreshAgain=false;
const operationCache=new Map(),dirtyNotes=new Map();
const editFields=['repoId','title','body','repositoryUrl','personalRepositoryUrl','proposer','assignee','assigneeId','proposerId','host','finisher','column','pinned'];
function personLabel(value){return value==='主管链接'?'trlstdin':value||''}
function draftBase(task){return Object.fromEntries(editFields.map(k=>[k,task?.[k]??'']))}
function operationStatus(message,status,retry){const box=$('#operation-status');if(!box)return;box.hidden=false;box.dataset.status=status;box.replaceChildren();const label=document.createElement('span');label.textContent=message;box.append(label);if(retry){const button=document.createElement('button');button.textContent='核对并重试';button.onclick=retry;box.append(button);}}
function friendlyVersion(value){const labels={title:'标题',body:'说明',proposer:'提出人',assignee:'认领人',host:'主机',repositoryUrl:'仓库',personalRepositoryUrl:'个人仓库',column:'栏目',pinned:'置顶状态',name:'名称',url:'地址',accessEnabled:'成员权限',canIssueLinks:'签发权限'};return Object.entries(labels).filter(([k])=>value[k]!==undefined&&value[k]!=='').map(([k,label])=>label+'：'+(k==='column'?state.columns[value[k]]:k==='pinned'?(value[k]?'置顶':'不置顶'):personLabel(value[k]))).join('\n\n')}
function chooseItemVersion(conflict){return new Promise(resolve=>{const dialog=$('#conflict-dialog');$('#conflict-mine').textContent=friendlyVersion(conflict.fields?Object.fromEntries(conflict.fields.map(k=>[k,conflict.mine[k]])):conflict.mine);$('#conflict-theirs').textContent=friendlyVersion(conflict.fields?Object.fromEntries(conflict.fields.map(k=>[k,conflict.theirs[k]])):conflict.theirs);const finish=choice=>{dialog.close();resolve(choice)};$('#choose-mine').onclick=()=>finish('mine');$('#choose-theirs').onclick=()=>finish('theirs');dialog.oncancel=e=>{e.preventDefault();finish('cancel')};dialog.showModal();});}
// Pending intents overlay incoming snapshots until their own acknowledgement.
const taskIntents=new Map(),confirmedTasks=new Map();
let intentRenderPending=false,directoryFlight=null;
function renderIntent(){if(intentRenderPending||typeof document==='undefined')return;intentRenderPending=true;requestAnimationFrame(()=>{intentRenderPending=false;if(state&&!document.body.classList.contains('is-dragging')){renderBoard();}});}
function overlayTaskIntents(){if(!state?.tasks)return;for(const op of taskIntents.values()){
 const d=op.payload,t=state.tasks.find(t=>t.id===d.id);if(!t)continue;
 if(d.action==='task.pin')t.pinned=d.pinned;
 if(d.action==='task.save')for(const key of editFields)if(d[key]!==undefined&&(!d.base||JSON.stringify(d[key])!==JSON.stringify(d.base[key])))t[key]=d[key];
 if(d.action==='task.place'||d.action==='task.move'){t.column=d.column;if(d.order){const at=d.order.indexOf(t.id),before=state.tasks.find(x=>x.id===d.order[at-1]),after=state.tasks.find(x=>x.id===d.order[at+1]);t.rank=before&&after?(before.rank+after.rank)/2:before?before.rank+1024:after?after.rank-1024:0;}else t.rank=d.rank;}
 t.pendingSave=true;
 }}
function rememberIntent(operation){if(!['task.pin','task.place','task.move','task.save'].includes(operation.payload.action)||!operation.payload.id)return;taskIntents.set(operation.id,operation);persistIntents();overlayTaskIntents();renderIntent();}
function persistIntents(){if(typeof sessionStorage==='undefined')return;try{sessionStorage.setItem('board-pending-intents',JSON.stringify({actor:state?.actor?.id,operations:[...taskIntents.values()].map(o=>({id:o.id,path:o.path,payload:o.payload,state:'unknown'}))}));}catch{}}
function acknowledgeTask(operation,result){taskIntents.delete(operation.id);if(result.board)applyStateUpdate(result.board);if(result.task?.deletedAt){state.tasks=state.tasks.filter(t=>t.id!==result.task.id);}else if(result.task){const current=state.tasks.find(t=>t.id===result.task.id);if(current)Object.assign(current,result.task,{pendingSave:false});else if(!result.task.deletedAt)state.tasks.push(result.task);confirmedTasks.set(result.task.id,result.task);}else if(operation.payload.id){const task=state.tasks.find(t=>t.id===operation.payload.id);if(task)delete task.pendingSave;}
 persistIntents();overlayTaskIntents();renderIntent();}
function recoverIntents(){if(typeof sessionStorage==='undefined'||!state?.actor?.edit)return;let saved;try{saved=JSON.parse(sessionStorage.getItem('board-pending-intents')||'null')}catch{}if(saved?.actor!==state.actor.id)return;for(const op of saved.operations||[])if(!taskIntents.has(op.id))runMutation(op.path,op.payload,op).catch(()=>{});}
function updatePeopleOptions(value,scope){if(currentFormScope!==scope||!$('#dialog').open)return;for(const name of ['proposer','assignee']){const select=$('#fields [name="'+name+'"]');if(!select)continue;const current=select.value;for(const m of value.members)if(![...select.options].some(o=>o.value===m.login)){const option=document.createElement('option');option.value=m.login;option.textContent=m.login;select.append(option);}select.value=current;}const hint=$('#people-loading');if(hint)hint.textContent='成员名单已更新';}

function runMutation(path,payload,originalOperation){
 const scope=$('#dialog')?.open?currentFormScope:crypto.randomUUID(),signature=scope+':'+path+':'+JSON.stringify(payload);
 let operation=originalOperation||operationCache.get(signature);if(!operation){operation={id:crypto.randomUUID(),path,payload:{baseVersion:state?.version,...payload},state:'processing'};operationCache.set(signature,operation);}
 if(!originalOperation&&payload.id){const t=state.tasks.find(t=>t.id===payload.id);if(t)operation.payload={baseRevision:t.revision??t.updatedAt,baseVersion:state.version,...operation.payload};}
 rememberIntent(operation);operationStatus('正在保存…','processing');pendingMutations++;
 const work=mutationTail.then(async()=>{
  operationStatus('正在提交…','processing');let data={...operation.payload,requestId:operation.id};
  if(data.action?.startsWith('task.')&&data.id&&data.baseRevision===undefined){const task=state.tasks.find(t=>t.id===data.id);if(task)data.baseRevision=task.revision??task.updatedAt??task.createdAt??0;}
  for(let attempt=0;attempt<4;attempt++){
   try{
    if(operation.state==='unknown'&&path==='change'){const known=await api('operation?id='+encodeURIComponent(operation.id));if(known.state==='completed'){operation.state='completed';operationStatus('提交已确认','completed');acknowledgeTask(operation,known);return known;}}
    const result=await api(path,data);operation.state='completed';operationStatus(result.noChange?'内容没有变化':result.workflow?.status==='failed'?'处理失败：'+result.workflow.error:'已保存','completed');
    if(data.action==='note.save')dirtyNotes.delete(data.repoId+':'+data.column);
    acknowledgeTask(operation,result);return result;
   }catch(error){
    if(error.code==='ITEM_CONFLICT'&&error.conflict){
     const choice=await chooseItemVersion(error.conflict);if(choice==='theirs'){if(data.action==='note.save')dirtyNotes.delete(data.repoId+':'+data.column);operation.state='completed';operationStatus('已采用服务器版本','completed');taskIntents.delete(operation.id);persistIntents();return {discarded:true};}if(choice==='cancel'){operation.state='failed';throw new Error('已保留输入，未提交冲突版本');}
     data={...data,...error.conflict.mine,base:error.conflict.theirs,baseRevision:error.conflict.revision,baseVersion:undefined,...(error.conflict.kind==='note'?{note:error.conflict.mine.body,baseNote:error.conflict.theirs.body}:{})};operation.payload={...data};continue;
    }
    if(!error.status||error.status>=500){operation.state='unknown';operationStatus('结果待确认，输入已保留','unknown',()=>runMutation(path,operation.payload,operation).catch(e=>toast(e.message)));if(attempt<1&&path==='change')continue;if(taskIntents.has(operation.id)&&typeof window!=='undefined'){clearTimeout(operation.retryTimer);operation.retryDelay=Math.min(15000,(operation.retryDelay||500)*2);operation.retryTimer=setTimeout(()=>runMutation(path,operation.payload,operation).catch(()=>{}),operation.retryDelay);}}
    else {operation.state='failed';operationStatus(error.message+'；本地修改已保留','failed',()=>runMutation(path,operation.payload,operation).catch(e=>toast(e.message)));}
    throw error;
   }
  }
  operation.state='failed';throw new Error('这条事项仍在变化，输入已保留，请重新选择版本');
 }).finally(async()=>{pendingMutations--;if(!pendingMutations)void refresh()});
 mutationTail=work.catch(()=>{});return work;
}
async function loadPeopleDirectory(){if(directoryValue&&directoryUntil>Date.now())return directoryValue;if(directoryFlight)return directoryFlight;directoryFlight=api('directory').then(value=>{directoryValue=value;directoryUntil=Date.now()+60000;return value}).finally(()=>{directoryFlight=null});return directoryFlight;}
function bindRepositorySuggestions(){
 for(const input of $$('#fields input[name="repositoryUrl"],#fields input[name="personalRepositoryUrl"],#fields input[name="url"]')){
  const list=document.createElement('datalist');list.id='repo-options-'+input.name;input.setAttribute('list',list.id);input.setAttribute('autocomplete','off');input.after(list);let sequence=0,timer;
  const update=async()=>{const ticket=++sequence,q=input.value.trim().toLowerCase(),local=(directoryValue?.repositories||[]).filter(r=>(r.name+' '+r.url).toLowerCase().includes(q));const show=items=>{list.replaceChildren(...items.slice(0,30).map(r=>{const o=document.createElement('option');o.value=r.url;o.label=r.name;return o}));};show(local);if(!q)return;try{const value=await api('directory?q='+encodeURIComponent(q));if(ticket===sequence)show(value.repositories);}catch{}};
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(update,250)});input.addEventListener('focus',update);if(!directoryValue)loadPeopleDirectory().then(update).catch(()=>{});else update();
 }
}
function domKey(node,index){if(node.nodeType!==1)return '#'+index;return node.id?'id:'+node.id:node.classList.contains('task')?'task:'+node.dataset.id:node.classList.contains('point-task-row')?'point-task:'+node.dataset.pointTask:node.classList.contains('column')?'column:'+node.dataset.column:node.classList.contains('project-shell')?'project:'+node.dataset.repoId:node.tagName+':'+index;}
function reconcileNode(current,next){
 if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
 if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
 const dirty=current===document.activeElement&&current.matches('input,textarea,select')||current.matches('textarea[data-note-repo]')&&dirtyNotes.has(current.dataset.noteRepo+':'+current.dataset.noteColumn);
 if(dirty)return;
 for(const a of [...current.attributes])if(!next.hasAttribute(a.name))current.removeAttribute(a.name);
 for(const a of [...next.attributes])if(current.getAttribute(a.name)!==a.value)current.setAttribute(a.name,a.value);
 const original=[...current.childNodes],byKey=new Map(original.map((n,i)=>[domKey(n,i),n]));let cursor=current.firstChild;
 [...next.childNodes].forEach((target,i)=>{const key=domKey(target,i),existing=byKey.get(key);if(existing){byKey.delete(key);if(existing!==cursor)current.insertBefore(existing,cursor);reconcileNode(existing,target);cursor=existing.nextSibling;}else{const added=target.cloneNode(true);current.insertBefore(added,cursor);cursor=added.nextSibling;}});
 for(const node of byKey.values())node.remove();
}
function patchHTML(element,html){const next=document.createElement(element.tagName);for(const a of element.attributes)next.setAttribute(a.name,a.value);next.innerHTML=html;reconcileNode(element,next);}
function patchBoard(html){const template=document.createElement('div');template.innerHTML=html;for(const column of template.querySelectorAll(':scope > .column'))column.insertBefore(column.querySelector('.column-notes'),column.querySelector('.column-projects'));reconcileNode($('#board'),Object.assign(template,{className:$('#board').className,id:'board'}));}
function captureView(){const active=document.activeElement;return {active,focusId:active?.id,focusName:active?.name,selection:typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null,x:scrollX,y:scrollY,scrolls:$$('#board .column-projects,#point-center [class*=list]').map(e=>[e,e.scrollTop,e.scrollLeft])};}
function restoreView(saved){for(const [e,y,x] of saved.scrolls)if(e.isConnected){e.scrollTop=y;e.scrollLeft=x;}const active=saved.active?.isConnected?saved.active:saved.focusId?document.getElementById(saved.focusId):saved.focusName?$('#fields [name="'+saved.focusName+'"]'):null;if(active&&document.activeElement!==active){active.focus({preventScroll:true});if(saved.selection&&active.setSelectionRange)try{active.setSelectionRange(...saved.selection)}catch{}}window.scrollTo(saved.x,saved.y);}
function applyStateUpdate(updated){
 if(updated.delta&&state&&updated.version===state.version&&!taskIntents.size&&!(updated.tasks?.length||updated.removedTaskIds?.length)&&!updated.accounts&&JSON.stringify(updated.actor)===JSON.stringify(state.actor)){state={...state,cursor:updated.cursor};return;}
 if(updated.delta){if(!state||updated.version<state.version)return;const byId=new Map(state.tasks.map(t=>[t.id,t]));for(const id of updated.removedTaskIds||[])byId.delete(id);for(const task of updated.tasks||[])byId.set(task.id,task);const changed={...updated};delete changed.tasks;delete changed.delta;delete changed.removedTaskIds;state={...state,...changed,tasks:[...byId.values()]};}
 else {if(state&&!state.offlineSnapshot&&updated.version<state.version)return;state=updated;}
 for(const [id,task] of confirmedTasks){const current=state.tasks.find(t=>t.id===id);if(current&&Number(current.revision||0)<Number(task.revision||0))Object.assign(current,task);else if(current)confirmedTasks.delete(id);}
 overlayTaskIntents();
 const projectOrder=new Map([...state.repos].sort((a,b)=>(a.rank??-Date.parse(a.createdAt))-(b.rank??-Date.parse(b.createdAt))||a.id.localeCompare(b.id)).map((r,i)=>[r.id,i]));for(let column=0;column<state.columns.length;column++)state.tasks.filter(t=>t.column===column).sort((a,b)=>(projectOrder.get(a.repoId)??99999)-(projectOrder.get(b.repoId)??99999)||Number(!!b.pinned)-Number(!!a.pinned)||a.rank-b.rank||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).forEach((t,i)=>t.columnNumber=i+1);
 const saved=captureView();if(!state.actor.edit)editing=false;else editing=(sessionStorage.getItem('board-mode')||readModeCookie()||'edit')==='edit';render();restoreView(saved);
}
async function refreshState(){
 if(refreshing){refreshAgain=true;return;}refreshing=true;
 try{const suffix=state&&!state.offlineSnapshot?'?since='+state.version+(['accounts','manage'].includes(view)?'&accounts=1':''):'';const updated=await api('state'+suffix);
  if(document.body.classList.contains('is-dragging')){refreshAgain=true;return;}
  applyStateUpdate(updated);$('#notice').textContent=state.offlineSnapshot?'当前显示公开快照，连接恢复后自动更新。':'';$('#sync-status').textContent=state.offlineSnapshot?'公开快照':state.storage?.pending?'已共享 · 待写入仓库':'已共享';
 }catch(error){$('#notice').textContent=error.message;$('#sync-status').textContent='连接中断，正在重连';}
 finally{refreshing=false;if(refreshAgain&&!document.body.classList.contains('is-dragging')){refreshAgain=false;queueMicrotask(()=>refresh());}}
}
async function startLiveUpdates(){
 let delay=1000;
 document.addEventListener('input',e=>{if(e.target.matches('textarea[data-note-repo]'))dirtyNotes.has(e.target.dataset.noteRepo+':'+e.target.dataset.noteColumn)||dirtyNotes.set(e.target.dataset.noteRepo+':'+e.target.dataset.noteColumn,e.target.defaultValue)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});window.addEventListener('beforeunload',()=>{liveStopped=true;liveController?.abort()});
 while(!liveStopped){
  if(document.hidden){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  try{liveController=new AbortController();const r=await fetch((CONFIG.apiBase||'')+'/api/updates?cursor='+encodeURIComponent(state?.cursor||'')+(['accounts','manage'].includes(view)?'&accounts=1':''),{signal:liveController.signal,cache:'no-store',headers:sessionToken?{Authorization:'Bearer '+sessionToken}:{}});if(!r.ok)throw Error('更新连接中断');const update=await r.json();if(update.changed||['accounts','manage'].includes(view)||refreshAgain)await refresh();delay=1000;}
  catch{if(liveStopped)break;await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(15000,delay*2);await refresh();}
 }
}

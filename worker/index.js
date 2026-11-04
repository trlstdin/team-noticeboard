import { ghRequest, ghRepo, ghProfile, githubIdentity, githubAuthRoute, githubDeviceRoute } from './github-auth.js';
const KEY='noticeboard/journal-v1.json';
const COLUMNS=['待开发','修复','优化','先接单后开发','已验收'];
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const id=()=>crypto.randomUUID();
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const text=(v,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'输入内容为空或超过长度限制');return v.trim()};
const url=v=>{let u;try{u=new URL(text(v,4000))}catch{fail(400,'请输入完整的 URL')}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail(400,'只支持 HTTP / HTTPS 链接');return u.href};
const initial=()=>({version:0,repos:[],tasks:[],accounts:[],users:[],tokens:[],notes:['等待开发的需求与新功能','已发现的问题与缺陷','体验、性能与流程优化','先认领接单，再安排开发','已完成并通过验收'],events:[]});
async function load(env){if(!env.BUCKET)fail(503,'共享存储尚未配置');const o=await env.BUCKET.get(KEY);return {s:o?await o.json():initial(),etag:o?.etag||null};}
function cookie(request){return /(?:^|;\s*)board_session=([^;]*)/.exec(request.headers.get('cookie')||'')?.[1]||''}
async function identity(request,env,s){
 const raw=request.headers.get('authorization')?.replace(/^Bearer /,'')||cookie(request);
 if(raw&&env.ADMIN_TOKEN&&await hash(raw)===await hash(env.ADMIN_TOKEN))return {root:true,name:'仓库主管',id:'root',edit:true,manage:true};
 const gh=await githubIdentity(raw,request,env,s);if(gh)return gh;
 let t=raw?s.tokens.find(t=>t.hash):null;if(raw){const h=await hash(raw);t=s.tokens.find(t=>t.hash===h&&!t.revokedAt)}else t=null;
 const who=null;
 if(t?.userId&&!s.users.some(u=>!u.deletedAt&&u.id===t.userId))t=null;
 const users=t?.userId?s.users.filter(u=>!u.deletedAt&&u.id===t.userId):who?s.users.filter(u=>u.identity===who):[];
 return {root:false,id:users[0]?.id||t?.id||who||'anonymous',name:users[0]?.name||t?.label||'访客',users,token:t,edit:users.some(u=>['editor','supervisor'].includes(u.role))&&(!t||t.scopes.includes('edit')),manage:users.some(u=>u.role==='supervisor')&&(!t||t.scopes.includes('manage')),signedIn:!!who,identityId:who||null};
}
function repoRole(a,repoId){if(a.root)return 'supervisor';if(a.token&&!a.token.repoIds.includes(repoId))return 'viewer';return a.users?.find(u=>u.repoId===repoId)?.role||'viewer'}
const canEdit=(a,r)=>a.root||['editor','supervisor'].includes(repoRole(a,r))&&(!a.token||a.token.scopes.includes('edit'));
const canManage=(a,r)=>a.root||repoRole(a,r)==='supervisor'&&(!a.token||a.token.scopes.includes('manage'));
function canAccount(a,acc){if(a.root)return true;if(!a.token&&!a.users?.some(u=>u.role!=='viewer'))return false;if(a.token&&!a.token.scopes.includes('copy'))return false;return canManage(a,acc.repoId)||a.users?.some(u=>u.repoId===acc.repoId&&acc.grants.includes(u.id))&&(!a.token||a.token.repoIds.includes(acc.repoId));}
const requireEdit=(a,r)=>{if(!canEdit(a,r))fail(403,'没有这个仓库的编辑权限')};
const requireManage=(a,r)=>{if(!canManage(a,r))fail(403,'需要该仓库的主管权限')};
function get(list,value){const item=list.find(i=>i.id===value&&!i.deletedAt);if(!item)fail(404,'记录不存在或已归档');return item;}
async function aesKey(env){if(!env.DATA_KEY)fail(503,'账号加密密钥未配置');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.DATA_KEY)),'AES-GCM',false,['encrypt','decrypt']);}
async function encrypt(value,env){const iv=crypto.getRandomValues(new Uint8Array(12));const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv},await aesKey(env),new TextEncoder().encode(value));return {iv:Array.from(iv),data:Array.from(new Uint8Array(buf))}}
async function decrypt(value,env){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv)},await aesKey(env),new Uint8Array(value.data)))}
function snapshot(s,a,env){return {version:s.version,columns:COLUMNS,notes:s.notes,repos:s.repos.filter(r=>!r.deletedAt).map(r=>({...r,role:repoRole(a,r.id),canEdit:canEdit(a,r.id),canManage:canManage(a,r.id)})),tasks:s.tasks.filter(t=>!t.deletedAt),accounts:s.accounts.filter(v=>!v.deletedAt&&canAccount(a,v)).map(({secret,...v})=>v),users:s.users.filter(u=>!u.deletedAt&&canManage(a,u.repoId)),tokens:s.tokens.filter(t=>a.root||t.repoIds.every(r=>canManage(a,r))).map(({hash,...t})=>t),actor:{id:a.id,name:a.name,root:a.root,edit:a.edit,manage:a.manage,canAccounts:!!(a.root||a.token?.scopes.includes('copy')||a.signedIn&&a.users?.some(u=>u.role!=='viewer')),signedIn:a.signedIn,githubLogin:a.githubLogin||null,githubId:a.githubId||null},historyCount:s.events.length,storage:{shared:true,github:!!env.BOARD_SYNC_KEY,repository:'https://github.com/trlstdin/team-noticeboard',committedVersion:s.repositorySync?.version||0,commit:s.repositorySync?.commit||null,pending:Math.max(0,s.version-(s.repositorySync?.version||0))}};}
async function github(event,env){if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)return {configured:false};if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY))throw Error('Invalid repository configuration');
 const res=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/contents/.noticeboard/events/'+event.id+'.json',{method:'PUT',headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'TeamNoticeboard','Content-Type':'application/json'},body:JSON.stringify({message:'board: '+event.action,content:btoa(unescape(encodeURIComponent(JSON.stringify(event,null,2))))})});
 if(res.status===422){const old=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/contents/.noticeboard/events/'+event.id+'.json',{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'TeamNoticeboard'}});if(!old.ok)throw Error('GitHub retry verification failed');const data=await old.json();if(!data.content||decodeURIComponent(escape(atob(data.content.replace(/\s/g,''))))!==JSON.stringify(event,null,2))throw Error('GitHub history differs');}else if(!res.ok)throw Error('GitHub sync HTTP '+res.status);return {configured:true};}
const handler={async fetch(request,env,ctx){try{
 const p=new URL(request.url).pathname;
 if(p.startsWith('/api/github/device/'))return json(await githubDeviceRoute(request,env));
 if(p.startsWith('/api/repository/'))return await repositoryRoute(request,env);
 if(p.startsWith('/auth/github'))return await githubAuthRoute(request,env);
 if(p==='/design.md')return new Response(DESIGN_DOCUMENT,{headers:{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename=noticeboard-design.md'}});
 if(p==='/'||p==='/index.html')return new Response(PAGE,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"}});
 if(!p.startsWith('/api/'))return json({error:'Not found'},404);
 const {s,etag}=await load(env);const a=await identity(request,env,s);
 if(request.method==='GET'){
 if(p==='/api/state')return json(snapshot(s,a,env));
 if(p==='/api/github/users'){const rid=new URL(request.url).searchParams.get('repoId');requireManage(a,rid);if(!a.accessToken)fail(403,'请先通过 GitHub 授权连接主管账号');const r=get(s.repos,rid),ref=ghRepo(r.url);const collaborators=await ghRequest(env,'/repos/'+ref.owner+'/'+ref.repo+'/collaborators?per_page=100',a.accessToken)||[];return json({users:collaborators.map(u=>({githubId:u.id,githubLogin:u.login,name:u.login,role:u.permissions?.admin||u.permissions?.maintain?'supervisor':u.permissions?.push?'editor':'viewer'}))});}
 if(p==='/api/history'){const query=new URL(request.url).searchParams;const before=Number(query.get('before')||Number.MAX_SAFE_INTEGER),limit=Math.max(1,Math.min(200,Number(query.get('limit')||50)));const visible=s.events.filter(e=>(e.visibility==='public'||a.root||canManage(a,e.repoId))&&e.seq<before).reverse();const events=visible.slice(0,limit).map(({privateData,...e})=>e);return json({events,nextBefore:visible.length>limit?events.at(-1).seq:null,total:s.events.filter(e=>e.visibility==='public'||a.root||canManage(a,e.repoId)).length});}
 return json({error:'Not found'},404);}
 if(request.method!=='POST')fail(405,'不支持的请求方式');
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&!(origin===env.PUBLIC_ORIGIN&&request.headers.get('authorization')?.startsWith('Bearer ')))fail(403,'不允许跨站操作');
 if(Number(request.headers.get('content-length')||0)>100000)fail(413,'请求过大');
 const raw=await request.text();if(raw.length>100000)fail(413,'请求过大');let b;try{b=JSON.parse(raw)}catch{fail(400,'请求格式错误')}
 if(p==='/api/session'){
 const temp={headers:new Headers(request.headers)};temp.headers.set('authorization','Bearer '+text(b.token,200));temp.headers.delete('cookie');const actor=await identity(temp,env,s);if(!actor.root&&!actor.token&&!actor.signedIn)fail(403,'链接无效或已被撤销');
 const res=json({ok:true});res.headers.set('set-cookie','board_session='+b.token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000');return res;}
 if(p==='/api/logout'){if(a.sessionKey)await env.BUCKET.put('auth/'+await hash(a.sessionKey),JSON.stringify({revokedAt:Date.now(),expiresAt:0}));const res=json({ok:true});res.headers.set('set-cookie','board_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return res;}
 if(p==='/api/copy'){const acc=get(s.accounts,b.id);if(!canAccount(a,acc))fail(403,'没有该账号的复制权限');return json({url:await decrypt(acc.secret,env)});}
 if(p==='/api/sync'){if(!a.root)fail(403,'仅主管可同步');if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)fail(503,'尚未配置 GitHub 仓库存储凭据');let count=0;for(const e of s.events.filter(e=>e.visibility==='public')){await github(e,env);count++}return json({count});}
 if(p!=='/api/change')fail(404,'Not found');
 if(b.version!==s.version)fail(409,'其他成员已更新内容，已为你保留输入；请刷新后重试');
 let result={},repoId=b.repoId,visibility='private',detail={},privateData;const now=new Date().toISOString();
 if(b.action==='repo.save'){
 if(b.id){const r=get(s.repos,b.id);requireManage(a,r.id);r.name=text(b.name,100);r.url=url(b.url);ghRepo(r.url);repoId=r.id;detail={name:r.name,url:r.url};}
 else {if(!a.root)fail(403,'只有总主管可添加项目');const r={id:id(),name:text(b.name,100),url:(ghRepo(b.url),url(b.url)),createdAt:now,rank:-Date.now(),notes:[...s.notes]};s.repos.push(r);repoId=r.id;detail={...r};}visibility='public';
 }else if(b.action==='repo.move'){
 const r=get(s.repos,b.id);requireEdit(a,r.id);if(!Number.isFinite(b.rank))fail(400,'项目顺序无效');r.rank=b.rank;repoId=r.id;visibility='public';detail={id:r.id,rank:r.rank};
 }else if(b.action==='task.place'){
 const t=get(s.tasks,b.id);repoId=t.repoId;requireEdit(a,repoId);if(!Number.isInteger(b.column)||b.column<0||b.column>4||!Array.isArray(b.order))fail(400,'无效的拖拽位置');
 const expected=s.tasks.filter(x=>!x.deletedAt&&x.repoId===repoId&&x.id!==t.id&&x.column===b.column).map(x=>x.id);if(b.order.length!==expected.length+1||new Set(b.order).size!==b.order.length||!b.order.includes(t.id)||expected.some(i=>!b.order.includes(i)))fail(409,'列表已变化，请刷新后拖动');
 t.column=b.column;if(b.column===4&&!t.finisher)t.finisher=a.name;t.updatedAt=now;for(let i=0;i<b.order.length;i++)get(s.tasks,b.order[i]).rank=i*1024;visibility='public';detail={id:t.id,column:t.column,order:b.order};
 }else if(b.action==='task.save'){
 const old=b.id?get(s.tasks,b.id):null;if(old)requireEdit(a,old.repoId);repoId=text(b.repoId);get(s.repos,repoId);requireEdit(a,repoId);if(!Number.isInteger(b.column)||b.column<0||b.column>4)fail(400,'栏目无效');
 const t={id:old?.id||id(),repoId,title:text(b.title,180),body:typeof b.body==='string'?b.body.slice(0,10000):'',proposer:text(b.proposer,100),finisher:typeof b.finisher==='string'?b.finisher.slice(0,100):'',column:b.column,rank:old?.rank??-Date.now(),createdAt:old?.createdAt||now,updatedAt:now};if(old)Object.assign(old,t);else s.tasks.push(t);visibility='public';detail=t;
 }else if(b.action==='task.move'){
 const t=get(s.tasks,b.id);repoId=t.repoId;requireEdit(a,repoId);if(!Number.isInteger(b.column)||b.column<0||b.column>4||!Number.isFinite(b.rank))fail(400,'无效的排序');t.column=b.column;t.rank=b.rank;t.updatedAt=now;visibility='public';detail={...t};
 }else if(b.action==='task.archive'){
 const t=get(s.tasks,b.id);repoId=t.repoId;requireEdit(a,repoId);t.deletedAt=now;visibility='public';detail={...t};
 }else if(b.action==='note.save'){
 const r=get(s.repos,b.repoId);repoId=r.id;requireEdit(a,repoId);if(!Number.isInteger(b.column)||b.column<0||b.column>4)fail(400,'栏目无效');r.notes=r.notes||[...s.notes];r.notes[b.column]=typeof b.note==='string'?b.note.slice(0,1000):'';visibility='public';detail={repoId,column:b.column,note:r.notes[b.column]};
 }else if(b.action==='user.save'){
 get(s.repos,repoId);requireManage(a,repoId);if(!['viewer','editor','supervisor'].includes(b.role))fail(400,'角色无效');if(b.role==='supervisor'&&!a.root)fail(403,'只有总主管可设置主管');
 const u=b.id?get(s.users,b.id):{id:id(),repoId};if(u.repoId!==repoId)fail(400,'不能跨仓库修改用户');if(u.role==='supervisor'&&!a.root)fail(403,'不能修改其他主管');const profile=await ghProfile(env,text(b.githubLogin||b.name,39));Object.assign(u,{...profile,role:b.role});if(!b.id)s.users.push(u);detail={userId:u.id,name:u.name,role:u.role};
 }else if(b.action==='user.archive'){
 const ids=Array.isArray(b.ids)?b.ids:[b.id];if(!ids.length||ids.length>200)fail(400,'请选择要删除的用户');for(const uid of ids){const u=get(s.users,uid);requireManage(a,u.repoId);if(u.role==='supervisor'&&!a.root)fail(403,'只有总主管可删除主管');u.deletedAt=now;for(const t of s.tokens.filter(t=>t.userId===uid))t.revokedAt=now;for(const acc of s.accounts)acc.grants=acc.grants.filter(v=>v!==uid);}repoId=s.users.find(u=>u.id===ids[0]).repoId;detail={ids};
 }else if(b.action==='account.save'){
 const old=b.id?get(s.accounts,b.id):null;if(old)repoId=old.repoId;get(s.repos,repoId);requireManage(a,repoId);const acc=old||{id:id(),repoId,grants:[],createdAt:now};acc.name=text(b.name,100);if(b.url)acc.secret=await encrypt(url(b.url),env);if(!acc.secret)fail(400,'请输入账号 URL');if(!old)s.accounts.push(acc);detail={accountId:acc.id,name:acc.name};privateData={secret:acc.secret};
 }else if(b.action==='account.archive'){
 const ids=Array.isArray(b.ids)?b.ids:[b.id];if(!ids.length||ids.length>200)fail(400,'请选择账号');for(const aid of ids){const acc=get(s.accounts,aid);requireManage(a,acc.repoId);repoId=acc.repoId;acc.deletedAt=now;}detail={ids};
 }else if(b.action==='grant.set'){
 if(!Array.isArray(b.accountIds)||b.accountIds.length>200||!Array.isArray(b.userIds))fail(400,'选择无效');
 const accounts=b.accountIds.map(i=>get(s.accounts,i));for(const acc of accounts){requireManage(a,acc.repoId);const targets=b.all?s.users.filter(u=>!u.deletedAt&&u.repoId===acc.repoId).map(u=>u.id):b.userIds;
 for(const uid of targets){const u=get(s.users,uid);if(u.repoId!==acc.repoId)fail(400,'账号和用户必须属于同一仓库');}
 acc.grants=b.clear?[]:b.remove?acc.grants.filter(i=>!targets.includes(i)):[...new Set([...acc.grants,...targets])];}repoId=accounts[0]?.repoId;detail={accountIds:b.accountIds,userIds:b.userIds,all:!!b.all,clear:!!b.clear,remove:!!b.remove};
 }else if(b.action==='token.create'){
 const u=get(s.users,b.userId);repoId=u.repoId;requireManage(a,repoId);if(u.role==='supervisor'&&!a.root)fail(403,'不能签发主管链接');
 if(!Array.isArray(b.scopes)||b.scopes.some(x=>!['edit','copy','manage'].includes(x)))fail(400,'权限范围无效');if(b.scopes.includes('manage')&&!a.root)fail(403,'只有总主管可签发管理链接');
 const secret=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');const t={id:id(),userId:u.id,label:text(b.label||u.name,100),repoIds:[repoId],scopes:b.scopes,hash:await hash(secret),createdAt:now};s.tokens.push(t);result={token:secret};detail={tokenId:t.id,label:t.label,scopes:t.scopes};
 }else if(b.action==='token.revoke'){
 const t=get(s.tokens,b.id);for(const r of t.repoIds)requireManage(a,r);if(t.scopes.includes('manage')&&!a.root)fail(403,'只有总主管可撤销管理链接');t.revokedAt=now;repoId=t.repoIds[0];detail={tokenId:t.id,label:t.label};
 }else fail(400,'不支持的操作');
 const event={id:id(),seq:s.version+1,time:now,actor:a.name,actorId:a.id,action:b.action,repoId,visibility,detail,...(privateData?{privateData}:{}),previousHash:s.events.at(-1)?.hash||null};event.hash=await hash(JSON.stringify(event));s.events.push(event);s.version++;
 const saved=await env.BUCKET.put(KEY,JSON.stringify(s),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(!saved)fail(409,'保存时有其他成员更新，请刷新后重试');
 if(visibility==='public'&&env.GITHUB_TOKEN&&env.GITHUB_REPOSITORY)ctx.waitUntil(github(event,env).catch(()=>{}));
 return json({ok:true,version:s.version,...result});
 }catch(e){return json({error:e.status?e.message:'服务暂时不可用，请稍后重试'},e.status||500)}}};

export default {async fetch(request,env,ctx){
 const origin=request.headers.get('origin');const allowed=!!env.PUBLIC_ORIGIN&&origin===env.PUBLIC_ORIGIN;
 if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600',Vary:'Origin'}:{}});
 const response=await handler.fetch(request,env,ctx);if(!allowed)return response;
 const out=new Response(response.body,response);out.headers.set('Access-Control-Allow-Origin',origin);out.headers.set('Vary','Origin');return out;
}};

export { fail, id, hash, encrypt, decrypt };

async function repositoryRoute(request,env){if(!env.BOARD_SYNC_KEY||request.headers.get('authorization')!=='Bearer '+env.BOARD_SYNC_KEY)fail(403,'仅仓库同步服务可使用此接口');const {s,etag}=await load(env);const p=new URL(request.url).pathname;if(p==='/api/repository/export'&&request.method==='GET'){const state=snapshot(s,{id:'anonymous',name:'访客',root:false,edit:false,manage:false,users:[]},env);state.snapshotAt=new Date().toISOString();return json({events:s.events.filter(e=>e.visibility==='public').map(({privateData,...e})=>e),state})}if(p==='/api/repository/ack'&&request.method==='POST'){const b=await request.json();if(!Number.isInteger(b.version)||b.version<0||b.version>s.version||!/^[a-f0-9]{40}$/.test(b.commit))fail(400,'同步确认无效');const response=await fetch('https://raw.githubusercontent.com/trlstdin/team-noticeboard/'+b.commit+'/board-data/version.json',{headers:{Accept:'application/vnd.github.raw+json','User-Agent':'TeamNoticeboard'}});if(!response.ok)fail(502,'无法核验 GitHub 提交');const value=await response.json();if(value.version!==b.version)fail(409,'仓库版本与确认不符');s.repositorySync={version:b.version,commit:b.commit,at:new Date().toISOString()};const written=await env.BUCKET.put(KEY,JSON.stringify(s),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(!written)fail(409,'同步期间有更新，下一轮会继续');return json({ok:true})}fail(404,'Not found')}

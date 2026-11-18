import { fail, id, hash, encrypt, decrypt } from './index.js';
// GitHub credentials stay server-side; site sessions carry opaque identifiers.
async function ghRequest(env,path,accessToken,options={}){const send=env.GH_FETCH||fetch;const response=await send('https://api.github.com'+path,{...options,headers:{Accept:'application/vnd.github+json','User-Agent':'TeamNoticeboard','X-GitHub-Api-Version':'2022-11-28',...(accessToken?{Authorization:'Bearer '+accessToken}:{}),...options.headers}});if(response.status===404||response.status===401)return null;if(response.status===403&&path.startsWith('/user/memberships/orgs/'))return null;if(!response.ok)fail(response.status===403?503:502,'GitHub 权限查询失败，请稍后重试');return response.status===204?true:response.json()}
function ghRepo(value){let u;try{u=new URL(value)}catch{fail(400,'仓库地址无效')}const parts=u.pathname.replace(/\.git$/,'').split('/').filter(Boolean);if(u.hostname!=='github.com'||parts.length!==2||parts.some(p=>!/^[-.\w]+$/.test(p)))fail(400,'请输入 https://github.com/组织或用户/仓库 地址');return {owner:parts[0],repo:parts[1]}}
async function ghProfile(env,login){if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(login))fail(400,'请输入真实 GitHub 用户名');const user=await ghRequest(env,'/users/'+encodeURIComponent(login));if(!user||user.type!=='User')fail(400,'GitHub 用户不存在');return {githubId:user.id,githubLogin:user.login,name:user.login}}
async function saveSession(env,key,value){await env.BUCKET.put('auth/'+await hash(key),JSON.stringify(value),{httpMetadata:{contentType:'application/json'}})}
async function githubIdentity(raw,request,env,s){if(!raw)return null;const object=await env.BUCKET.get('auth/'+await hash(raw));if(!object)return null;const session=await object.json();if(session.revokedAt||session.expiresAt<Date.now())return null;let access=await decrypt(session.secret,env);
 if(session.accessExpiresAt&&session.accessExpiresAt<Date.now()+60000){if(!session.refreshSecret)return null;const response=await (env.GH_FETCH||fetch)('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'TeamNoticeboard'},body:new URLSearchParams({client_id:githubClientId(env),grant_type:'refresh_token',refresh_token:await decrypt(session.refreshSecret,env)})});const token=await response.json();if(!token.access_token)return null;access=token.access_token;session.secret=await encrypt(access,env);if(token.refresh_token)session.refreshSecret=await encrypt(token.refresh_token,env);session.accessExpiresAt=Date.now()+token.expires_in*1000;await saveSession(env,raw,session)}
 const organization=(env.GITHUB_ORGANIZATION||'alistrode').toLowerCase();const fresh=request.method!=='GET'||!session.checkedAt||Date.now()-session.checkedAt>60000||session.checkedVersion!==s.repos.length||session.checkedOrganization!==organization;
 if(fresh){const user=await ghRequest(env,'/user',access);if(!user||user.id!==session.githubId)return null;session.login=user.login;session.roles={};const supervisorUser=isGithubSupervisor(user,env);const membership=supervisorUser?null:await ghRequest(env,'/user/memberships/orgs/'+encodeURIComponent(organization),access);session.organizationMember=membership?.state==='active';for(const r of s.repos.filter(r=>!r.deletedAt))session.roles[r.id]={role:supervisorUser?'supervisor':session.organizationMember?'editor':'viewer',member:session.organizationMember};session.checkedOrganization=organization;session.checkedAt=Date.now();session.checkedVersion=s.repos.length;await saveSession(env,raw,session)}
 const supervisor=isSupervisorId(session.githubId);const users=[];for(const r of s.repos.filter(r=>!r.deletedAt)){const assigned=s.users.filter(u=>u.repoId===r.id&&u.githubId===session.githubId);if(assigned.some(u=>u.deletedAt)&&!supervisor)continue;const role=session.roles[r.id]?.role||'viewer';const actual=assigned.filter(u=>!u.deletedAt);if(actual.length)users.push(...actual.map(u=>({...u,role})));else if(role!=='viewer')users.push({id:'github:'+session.githubId+':'+r.id,repoId:r.id,name:session.login,githubId:session.githubId,githubLogin:session.login,role})}
 const policy=s.organizationMembers?.find(m=>String(m.githubId)===String(session.githubId));const blocked=!supervisor&&policy?.accessEnabled===false;
 return {supervisor:!!supervisor,id:'github:'+session.githubId,name:session.login,githubId:session.githubId,githubLogin:session.login,users:blocked?[]:users,edit:!!supervisor||session.organizationMember===true&&!blocked,manage:!!supervisor,signedIn:true,organizationMember:session.organizationMember===true&&!blocked,githubOrganizationMember:session.organizationMember===true,canIssueMemberLinks:!supervisor&&session.organizationMember===true&&!blocked&&policy?.canIssueLinks!==false,accessToken:access,sessionKey:raw};
}
// Public application identifier, not a credential. No application secret is used.
function githubClientId(env){return env.GITHUB_CLIENT_ID||'Ov23liS0697dsfZdr4JL'}
function isSupervisorId(value){return [215798043,311221020].includes(Number(value))}
function isGithubSupervisor(user){return isSupervisorId(user.id)}
function deviceResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})}
function deviceCookies(request){return (request.headers.get('cookie')||'').split(';').map(v=>/^board_github_device_([a-f0-9]{64})=([a-f0-9]{64})$/.exec(v.trim())).filter(Boolean).map(v=>({id:v[1],binding:v[2]}))}
function deviceCookie(request,id){return deviceCookies(request).find(v=>v.id===id)?.binding||''}
function randomSession(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('')}
function githubFrontend(request,env){const origin=new URL(request.url).origin,target=new URL(env.FRONTEND_URL||origin);if(target.protocol!=='https:'||![origin,env.PUBLIC_ORIGIN].includes(target.origin))fail(503,'登录返回地址配置无效');return target}
async function githubAuthRoute(request,env){
 const requestUrl=new URL(request.url),send=env.GH_FETCH||fetch;
 if(requestUrl.pathname==='/auth/github'){
  if(request.method!=='GET')fail(405,'不支持的请求方式');

  const response=await send('https://github.com/login/device/code',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'TeamNoticeboard'},body:new URLSearchParams({client_id:githubClientId(env),scope:'read:user read:org'})});
  if(!response.ok)fail(502,'GitHub 登录暂时不可用');const token=await response.json();
  if(!token.device_code||!token.user_code||!/^[A-Z0-9-]{4,20}$/.test(token.user_code))fail(503,'GitHub 登录尚未启用，请稍后重试');
  const verification=new URL(token.verification_uri);if(verification.origin!=='https://github.com'||verification.pathname!=='/login/device')fail(502,'GitHub 返回了无效的授权地址');
  githubFrontend(request,env);const flow=randomSession(),binding=randomSession(),interval=Math.max(5,Math.min(60,Number(token.interval)||5));
  await env.BUCKET.put('device-login/'+await hash(flow),JSON.stringify({bindingHash:await hash(binding),secret:await encrypt(token.device_code,env),userCode:token.user_code,expiresAt:Date.now()+Math.min(900,Number(token.expires_in)||900)*1000,interval,nextPollAt:Date.now()+interval*1000}));
  verification.searchParams.set('user_code',token.user_code);
  const html=`<!doctype html><html lang="zh-CN">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub 登录</title>
<style>body{background:#0c1725;color:#d4e5f4;font:16px system-ui;max-width:34rem;margin:12vh auto;padding:24px;line-height:1.7}a{color:#65d6bc}code{display:block;font-size:32px;margin:20px 0;letter-spacing:3px}button,a.action{background:#65d6bc;color:#0c1725;border:0;padding:12px 18px;border-radius:8px;text-decoration:none}button:disabled{opacity:.55}</style>
<h1>GitHub 登录</h1>
<p>在新标签页中确认以下代码并授权，再切回这个标签页完成登录。</p>
<code>${token.user_code}</code>
<a class="action" href="${verification.href.replace(/&/g,'&amp;')}" target="_blank" rel="noopener noreferrer">前往 GitHub</a>
<button id="continue" type="button">我已授权，继续登录</button>
<p id="status" role="status">等待 GitHub 授权…</p>
<a id="return" hidden>返回告示板</a>
<a href="/auth/github">重新登录</a>
<script>
const flow=${JSON.stringify(flow)};
const message=document.getElementById('status');
const check=document.getElementById('continue');
const returnLink=document.getElementById('return');
let delay=${interval*1000},timer,inFlight=false,finished=false;
async function poll(){
 if(finished||inFlight)return;
 clearTimeout(timer);
 inFlight=true;
 check.disabled=true;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/auth/github/device/poll',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flow}),
   credentials:'same-origin',cache:'no-store',signal:controller.signal
  });
  if(response.status===429||response.status>=500)throw new Error('temporary');
  const result=await response.json();
  if(!response.ok){
   finished=true;
   message.textContent=result.error||'登录未完成，请重新登录。';
   return;
  }
  if(result.session){
   finished=true;
   message.textContent='GitHub 已授权，正在返回告示板…';
   const destination=new URL(result.frontend);
   destination.hash='github-session='+result.session;
   returnLink.href=destination.href;
   returnLink.hidden=false;
   location.replace(destination.href);
   return;
  }
  message.textContent='等待 GitHub 确认授权…';
  delay=Math.max(5000,(result.interval||5)*1000);
 }catch(error){
  message.textContent='连接暂时中断，正在重试…';
  delay=Math.min(30000,delay*2);
 }finally{
  clearTimeout(timeout);
  inFlight=false;
  check.disabled=finished;
  if(!finished)timer=setTimeout(poll,delay);
 }
}
check.onclick=()=>{if(!finished&&!inFlight){message.textContent='正在核对 GitHub 授权…';poll()}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
timer=setTimeout(poll,delay);
</script></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'board_github_device_'+flow+'='+binding+'; Path=/auth/github; HttpOnly; Secure; SameSite=Strict; Max-Age=900','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 }
 if(requestUrl.pathname!=='/auth/github/device/poll')fail(404,'Not found');
 if(request.method!=='POST')fail(405,'不支持的请求方式');
 const origin=request.headers.get('origin');if(origin&&origin!==requestUrl.origin)fail(403,'不允许跨站登录操作');
 const raw=await request.text();if(raw.length>300)fail(413,'请求过大');let body;try{body=JSON.parse(raw)}catch{fail(400,'请求格式错误')}
 const flowId=body.flow;if(typeof flowId!=='string'||!/^[a-f0-9]{64}$/.test(flowId))fail(403,'登录会话不匹配，请重新登录');const binding=deviceCookie(request,flowId);if(!binding)fail(403,'登录会话不匹配，请重新登录');
 const key='device-login/'+await hash(flowId),object=await env.BUCKET.get(key);if(!object)fail(410,'登录已过期，请重试');const flow=await object.json();if(flow.bindingHash!==await hash(binding))fail(403,'登录会话不匹配，请重新登录');if(flow.expiresAt<=Date.now())fail(410,'登录已过期，请重试');
 const frontend=githubFrontend(request,env).href;
 if(flow.doneSession)return deviceResponse({session:await decrypt(flow.doneSession,env),frontend});
 if(flow.nextPollAt>Date.now())return deviceResponse({pending:true,interval:flow.interval});
 if(!object.etag)fail(503,'登录状态暂时不可用');
 const reserved=await env.BUCKET.put(key,JSON.stringify({...flow,nextPollAt:Date.now()+30000}),{onlyIf:{etagMatches:object.etag}});if(!reserved)return deviceResponse({pending:true,interval:flow.interval});
 if(!flow.grant){
  let response;try{response=await send('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'TeamNoticeboard'},body:new URLSearchParams({client_id:githubClientId(env),device_code:await decrypt(flow.secret,env),grant_type:'urn:ietf:params:oauth:grant-type:device_code'})})}catch{fail(502,'GitHub 连接暂时中断，请重试')}
  if(!response.ok)fail(502,'GitHub 登录暂时不可用');const token=await response.json();
  if(token.error==='authorization_pending'||token.error==='slow_down'){if(token.error==='slow_down')flow.interval+=5;flow.nextPollAt=Date.now()+flow.interval*1000;await env.BUCKET.put(key,JSON.stringify(flow));return deviceResponse({pending:true,interval:flow.interval})}
  if(!token.access_token){await env.BUCKET.put(key,JSON.stringify({...flow,expiresAt:0}));fail(403,token.error==='access_denied'?'GitHub 授权已取消':'GitHub 授权已过期，请重试')}
  flow.grant={secret:await encrypt(token.access_token,env),refreshSecret:token.refresh_token?await encrypt(token.refresh_token,env):null,accessExpiresAt:token.expires_in?Date.now()+token.expires_in*1000:null};
  delete flow.secret;
  flow.nextPollAt=Date.now()+30000;
  await env.BUCKET.put(key,JSON.stringify(flow));
 }
 const user=await ghRequest(env,'/user',await decrypt(flow.grant.secret,env));
 if(!user?.id||!user.login)fail(403,'无法核对 GitHub 身份');
 const session=randomSession();
 await saveSession(env,session,{...flow.grant,githubId:user.id,login:user.login,expiresAt:Date.now()+14*86400000});
 delete flow.grant;flow.doneSession=await encrypt(session,env);await env.BUCKET.put(key,JSON.stringify(flow));
 const result=deviceResponse({session,frontend});result.headers.set('Set-Cookie','board_session='+session+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1209600');return result;
}
export { isSupervisorId, ghRequest, ghRepo, ghProfile, githubIdentity, githubAuthRoute };

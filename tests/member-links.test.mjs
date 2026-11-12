import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import native,{hash as nativeHash,encrypt as nativeEncrypt} from '../worker/index.js';
import interpreted,{hash as interpretedHash,encrypt as interpretedEncrypt} from './interpreted-backend.mjs';
class Bucket{
 constructor(){this.records=new Map();this.revs=new Map();}
 async get(k){const value=this.records.get(k),etag=String(this.revs.get(k)||0);return value?{etag,json:async()=>JSON.parse(value)}:null;}
 async put(k,value,o={}){const rev=String(this.revs.get(k)||0);if(o.onlyIf?.etagMatches!==undefined&&o.onlyIf.etagMatches!==rev||o.onlyIf?.etagDoesNotMatch==='*'&&this.records.has(k))return null;this.records.set(k,value);this.revs.set(k,Number(rev)+1);return {etag:String(Number(rev)+1)};}
}
async function app(worker,hash,encrypt){
 const env={BUCKET:new Bucket(),DATA_KEY:'test-member-encryption',ROOT_GITHUB_ID:'1'};
 const identities={root:{id:1,login:'owner'},member:{id:42,login:'member'},other:{id:43,login:'other'},outside:{id:99,login:'outside'}};
 env.GH_FETCH=async(url,options={})=>{const key=options.headers?.Authorization?.replace('Bearer fixture-','');const who=identities[key];if(url.endsWith('/user'))return Response.json(who);if(url.includes('/memberships/'))return ['member','other'].includes(key)?Response.json({state:'active',role:'member'}):new Response('{}',{status:404});const login=url.split('/').at(-1);return Response.json({...Object.values(identities).find(u=>u.login===login),type:'User'});};
 for(const [key,who] of Object.entries(identities))await env.BUCKET.put('auth/'+await hash(key),JSON.stringify({githubId:who.id,login:who.login,secret:await encrypt('fixture-'+key,env),expiresAt:Date.now()+1000000}));
 const call=async(path,body,token='root')=>{const res=await worker.fetch(new Request('https://board.test/api/'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json',origin:'https://board.test'}:{})},body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});return {status:res.status,body:await res.json()};};
 const state=async(token='root')=>(await call('state',null,token)).body;
 const change=async(data,token='root')=>call('change',{version:(await state(token)).version,...data},token);
 await change({action:'repo.save',name:'Project',url:'https://github.com/example/project'});const repoId=(await state()).repos[0].id;
 return {env,call,state,change,repoId};
}
for(const [name,worker,hash,encrypt] of [['native',native,nativeHash,nativeEncrypt],['interpreted',interpreted,interpretedHash,interpretedEncrypt]]){

 test(name+': stale pages merge unrelated changes and show only actual item conflicts',async()=>{
  const a=await app(worker,hash,encrypt);
  await a.change({action:'task.save',repoId:a.repoId,title:'Original',body:'Old body',proposer:'owner',column:6});
  const original=(await a.state()).tasks[0],oldVersion=(await a.state()).version;
  const save=(base,extra)=>a.call('change',{action:'task.save',...base,base,version:oldVersion,...extra});
  assert.equal((await save(original,{title:'Server title',requestId:'first-edit'})).status,200);
  assert.equal((await save(original,{body:'Disjoint body',requestId:'disjoint-edit'})).status,200);
  let current=(await a.state()).tasks[0];assert.equal(current.title,'Server title');assert.equal(current.body,'Disjoint body');
  const conflict=await save(original,{title:'My title',requestId:'conflicting-edit'});
  assert.equal(conflict.status,409);assert.equal(conflict.body.code,'ITEM_CONFLICT');assert.equal(conflict.body.conflict.mine.title,'My title');assert.equal(conflict.body.conflict.theirs.title,'Server title');
  assert.equal((await save(current,{title:'My title',requestId:'conflicting-edit'})).status,200);
  const version=(await a.state()).version;
  assert.equal((await save((await a.state()).tasks[0],{})).body.noChange,true);assert.equal((await a.state()).version,version);
  await a.change({action:'task.save',repoId:a.repoId,title:'Unrelated',body:'',proposer:'owner',column:6});
  current=(await a.state()).tasks.find(t=>t.id===original.id);
  assert.equal((await a.call('change',{action:'task.pin',id:original.id,pinned:true,baseRevision:current.revision,version:oldVersion})).status,200);
  const delta=(await a.call('state?since='+version)).body;assert.equal(delta.delta,true);assert.ok(delta.tasks.some(t=>t.title==='Unrelated'));
 });
 test(name+': retries identify one committed task and keep issued secrets encrypted',async()=>{
  const a=await app(worker,hash,encrypt),payload={action:'task.save',repoId:a.repoId,title:'Exactly once',proposer:'owner',column:6,requestId:'one-create',version:0};
  const responses=await Promise.all([a.call('change',payload),a.call('change',payload)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(responses[0].body.taskId,responses[1].body.taskId);assert.equal((await a.state()).tasks.length,1);
  const known=await a.call('operation?id=one-create');assert.equal(known.body.state,'completed');assert.equal(known.body.taskId,responses[0].body.taskId);
  assert.equal((await a.call('change',{...payload,title:'Wrong reuse'})).status,409);
  await a.state('member');const issue={action:'member.link.create',memberId:42,requestId:'one-link'};
  const first=await a.change(issue),second=await a.change(issue);assert.equal(first.status,200);assert.equal(first.body.token,second.body.token);assert.equal((await a.call('operation?id=one-link')).body.token,first.body.token);
  assert.equal(a.env.BUCKET.records.get('noticeboard/journal-v1.json').includes(first.body.token),false);
  assert.equal((await a.call('operation?id=one-link',null,'outside')).status,403);
 });
 test(name+': member directory selections bind the actual claimant and account renewals do not churn versions',async()=>{
  const a=await app(worker,hash,encrypt);await a.state('member');await a.state('other');
  const d=await a.call('directory');assert.ok(d.body.members.some(m=>m.login==='member'));assert.ok(d.body.repositories.some(r=>r.url==='https://github.com/example/project'));
  assert.equal((await a.call('directory',null,'')).status,403);
  const created=await a.change({action:'task.save',repoId:a.repoId,title:'Assigned',proposer:'member',assignee:'other',peopleValidated:true,column:6});assert.equal(created.status,200);
  const t=(await a.state()).tasks[0];assert.equal(t.assigneeId,43);assert.equal(t.proposerId,42);assert.equal(t.pointClaimant,'github:43');
  const sync=entries=>a.call('cast/sync',{sourceId:'same-source',entries});
  assert.equal((await sync([{name:'A',environmentId:'A',url:'https://example.com/account-a'}])).status,200);
  await sync([{name:'B',environmentId:'B',url:'https://example.com/account-b'}]);const version=(await a.state()).version;
  await sync([{name:'A',environmentId:'A',url:'https://example.com/account-a'}]);await sync([{name:'B',environmentId:'B',url:'https://example.com/account-b'}]);
  const state=await a.state();assert.equal(state.version,version);assert.equal(state.accounts.length,2);
  const cursor=state.cursor;assert.equal((await a.call('updates?wait=0&cursor='+encodeURIComponent(cursor))).body.changed,false);
 });
 test(name+': archived tasks restore their identity, content and placement with edit permission',async()=>{
  const a=await app(worker,hash,encrypt);
  await a.change({action:'task.save',repoId:a.repoId,title:'Restore me',body:'Original content',proposer:'owner',column:0});
  const original=(await a.state()).tasks[0];
  await a.change({action:'task.archive',id:original.id});assert.equal((await a.state()).tasks.length,0);
  assert.equal((await a.change({action:'task.restore',id:original.id},'outside')).status,403);
  assert.equal((await a.change({action:'task.restore',id:original.id})).status,200);
  const restored=(await a.state()).tasks[0];
  for(const field of ['id','historyNumber','title','body','column','rank','createdAt'])assert.equal(restored[field],original[field]);
 });
 test(name+': verified members issue permanent member links without gaining supervisor rights',async()=>{
  const a=await app(worker,hash,encrypt);const m=await a.state('member');assert.equal(m.actor.canIssueMemberLinks,true);assert.deepEqual(m.organizationMembers,[]);
  assert.equal((await a.state()).organizationMembers[0].verified,true);
  const issued=await a.change({action:'member.link.create'},'member');assert.equal(issued.status,200);assert.equal(issued.body.expiresAt,null);const token=issued.body.token;
  let linked=await a.state(token);assert.equal(linked.actor.root,false);assert.equal(linked.actor.manage,false);assert.equal(linked.actor.edit,true);assert.equal(linked.actor.organizationMember,true);assert.equal(linked.actor.canIssueMemberLinks,true);assert.ok(!linked.views.includes('manage'));assert.deepEqual(linked.users,[]);assert.equal(linked.memberLinks.length,1);assert.equal(linked.memberLinks[0].hash,undefined);
  assert.equal((await a.change({action:'task.save',repoId:a.repoId,title:'Member task',body:'test',proposer:'member',column:0},token)).status,200);
  await a.change({action:'account.save',name:'Default account',url:'https://example.com/member-account'});linked=await a.state(token);assert.equal(linked.accounts.length,1);assert.equal((await a.call('copy',{id:linked.accounts[0].id},token)).status,200);
  assert.equal((await a.change({action:'member.update',memberId:42,accessEnabled:true},token)).status,403);
  assert.equal((await a.change({action:'member.link.create',memberId:43},'member')).status,403);
  assert.equal((await a.call('supervisor-link',{},token)).status,403);
  assert.equal((await a.change({action:'user.save',repoId:a.repoId,name:'outside',role:'supervisor'},token)).status,403);
  const exchanged=await a.call('session',{token},'');assert.equal(exchanged.status,200);assert.equal((await a.state(exchanged.body.session)).actor.edit,true);
  const clock=Date.now;try{Date.now=()=>clock()+100*365*86400000;assert.equal((await a.state(token)).actor.edit,true);}finally{Date.now=clock;}
  const stored=JSON.parse(a.env.BUCKET.records.get('noticeboard/journal-v1.json'));assert.equal(stored.tokens[0].hash,await hash(token));assert.equal(JSON.stringify(stored.events).includes(token),false);
  const anon=await a.state('');assert.deepEqual(anon.memberLinks,[]);assert.deepEqual(anon.organizationMembers,[]);assert.equal(anon.actor.edit,false);
  await a.state('other');assert.deepEqual((await a.state('other')).memberLinks,[]);
 });
 test(name+': signing controls, member cancellation and link revocation apply to existing sessions immediately',async()=>{
  const a=await app(worker,hash,encrypt);await a.state('member');const issued=await a.change({action:'member.link.create'},'member'),token=issued.body.token;let parent=(await a.state(token)).memberLinks[0];const oldSession=(await a.call('session',{token},'')).body.session;
  await a.change({action:'user.save',repoId:a.repoId,name:'member',role:'editor'});const user=(await a.state()).users.find(u=>u.githubId===42);const legacy=(await a.change({action:'token.create',userId:user.id,scopes:['edit','copy']})).body.token;
  assert.equal((await a.state(legacy)).actor.edit,true);
  await a.change({action:'member.update',memberId:42,canIssueLinks:false});assert.equal((await a.state(legacy)).actor.edit,false);assert.equal((await a.change({action:'token.create',userId:user.id,scopes:['edit','copy']})).status,403);
  assert.equal((await a.state('member')).actor.canIssueMemberLinks,false);assert.equal((await a.state(token)).actor.canIssueMemberLinks,false);assert.equal((await a.state(token)).actor.edit,false);assert.equal((await a.state(oldSession)).actor.edit,false);assert.equal((await a.change({action:'member.link.create',memberId:42})).status,403);
  assert.equal((await a.change({action:'member.link.create'},'member')).status,403);assert.equal((await a.change({action:'member.link.create'},token)).status,403);
  await a.change({action:'member.update',memberId:42,canIssueLinks:true});assert.equal((await a.state(token)).actor.edit,false);const current=(await a.change({action:'member.link.create'},'member')).body.token;parent=(await a.state(current)).memberLinks.find(t=>t.active);const child=(await a.change({action:'member.link.create'},current)).body.token;const session=(await a.call('session',{token:child},'')).body.session;
  assert.equal((await a.change({action:'token.update',id:parent.id,scopes:['manage']},token)).status,403);
  assert.equal((await a.change({action:'member.link.revoke',id:parent.id})).status,200);assert.equal((await a.state(child)).actor.edit,false);assert.equal((await a.state(session)).actor.edit,false);assert.equal((await a.state(token)).actor.edit,false);
  const fresh=(await a.change({action:'member.link.create'},'member')).body.token;const restored=(await a.call('session',{token:fresh},'')).body.session;
  await a.change({action:'member.update',memberId:42,accessEnabled:false});
  for(const t of ['member',fresh,restored]){const s=await a.state(t);assert.equal(s.actor.edit,false);assert.equal(s.actor.canIssueMemberLinks,false);assert.equal(s.actor.organizationMember,false);assert.deepEqual(s.accounts,[]);}
  assert.equal((await a.change({action:'member.link.create'},'member')).status,403);assert.equal((await a.call('session',{token:fresh},'')).status,403);
  await a.change({action:'member.update',memberId:42,accessEnabled:true});assert.equal((await a.state('member')).actor.edit,true);assert.equal((await a.state(fresh)).actor.edit,false);assert.equal((await a.state(restored)).actor.edit,false);
 });
 test(name+': a policy entry does not prove organization membership, and stale mutations cannot overwrite controls',async()=>{
  const a=await app(worker,hash,encrypt);await a.change({action:'member.update',login:'outside',accessEnabled:true,canIssueLinks:true});assert.equal((await a.state('outside')).actor.canIssueMemberLinks,false);assert.equal((await a.change({action:'member.link.create',memberId:99})).status,403);
  await a.change({action:'member.update',login:'member',accessEnabled:false,canIssueLinks:false});const s=await a.state('member');assert.equal(s.actor.edit,false);assert.equal(s.actor.canIssueMemberLinks,false);const registered=(await a.state()).organizationMembers.find(m=>m.githubId===42);assert.equal(registered.verified,true);assert.equal(registered.accessEnabled,false);assert.equal(registered.canIssueLinks,false);
  const old=(await a.state()).version;await a.change({action:'member.update',memberId:42,accessEnabled:true});assert.equal((await a.call('change',{action:'member.update',memberId:42,accessEnabled:false,base:{accessEnabled:false},version:old})).status,409);assert.equal((await a.state('member')).actor.edit,true);
 });
}
test('the exact user policy is visible and member controls distinguish access from signing',async()=>{
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');assert.ok(html.includes('建议组织成员可以也可以签发组织成员的永久链接。。。。但主管可以后台取消组织成员权限，自然权限和签发权限都可以后台取消'));
 const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');const nodes=new Map();const state={actor:{root:true,canIssueMemberLinks:false},organizationMembers:[{githubId:42,githubLogin:'<member>',accessEnabled:true,canIssueLinks:false,verified:true}],memberLinks:[]};
 const context=vm.createContext({state,view:'manage',esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),$:s=>{if(!nodes.has(s))nodes.set(s,{});return nodes.get(s)},$$:()=>[]});
 vm.runInContext(app.slice(app.indexOf('function renderMemberAccess('),app.indexOf('function orderedRepos(')),context);context.renderMemberAccess();assert.equal(nodes.get('#member-access').hidden,false);assert.match(nodes.get('#organization-members').innerHTML,/停用成员权限/);assert.match(nodes.get('#organization-members').innerHTML,/开启签发权限/);assert.match(nodes.get('#organization-members').innerHTML,/&lt;member&gt;/);
 state.actor={root:false,organizationMember:true,canIssueMemberLinks:true};context.renderMemberAccess();assert.equal(nodes.get('#member-link').hidden,false);assert.equal(nodes.get('#organization-members').innerHTML,'');assert.equal(nodes.get('#add-member-policy').hidden,true);
});

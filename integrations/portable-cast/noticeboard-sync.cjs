'use strict';
// Publish only this portable manager's active cast links into the existing account pool.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const runtimeRequire=require('node:module').createRequire(path.join(__dirname,'runtime/package.json'));
const {HttpsProxyAgent}=runtimeRequire('https-proxy-agent');
const {atomic,read}=require('./state-store.cjs'),ownership=require('./manager-ownership.cjs');
const ORIGIN='https://team-noticeboard-rebuilt.loneivy1.chatgpt.site';
function create({suite,home,log,start,link}){
 const file=path.join(home,'noticeboard-publisher.json');let cfg=read(file,{});
 if(cfg.enabled!==true)return {observe(){},status:()=>({enabled:false}),async close(){}};
 const control=read(path.join(home,'control.json'),{});
 cfg.sourceId ||= crypto.createHash('sha256').update(fs.realpathSync(suite)).update(String(control.key)).digest('hex');cfg.seen ||= {};
 const unknownSince=new Map();
 let entries=[],lastSignature='',lastPublished='',lastAt=0,credentialAt=0,work=null,stopped=false,error=null,published=0,pending=false;
 const save=()=>atomic(file,cfg);
 async function command(address,method,params){
  const socket=new WebSocket(address);let timer;
  try{return await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('告示栏已有会话读取超时')),4000);socket.onopen=()=>socket.send(JSON.stringify({id:1,method,params}));socket.onerror=()=>reject(Error('告示栏已有会话连接失败'));socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id!==1)return;m.error||m.result?.exceptionDetails?reject(Error('告示栏已有会话读取失败')):resolve(m.result);};});}
  finally{clearTimeout(timer);socket.close();}
 }
 async function credentials(){
  if(cfg.credential&&performance.now()-credentialAt<30000)return;
  const manifest=read(path.join(home,'manager-browsers.json'),{}),registry=read(path.join(suite,'state/environment-registry.json'),{environments:[]});
  for(const browser of manifest.browsers||[]){
   if(!ownership.browser(suite,browser.root))continue;
   const profile=registry.environments.find(v=>v.id===browser.profileId);if(!profile?.port)continue;
   const response=await fetch('http://127.0.0.1:'+browser.port+'/json/list',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('告示栏浏览器标签读取失败');
   for(const tab of await response.json()){
    if(tab.type!=='page')continue;let address;try{address=new URL(tab.url)}catch{continue;}
    if(address.origin!==ORIGIN||!['/','/index.html'].includes(address.pathname))continue;
    const result=await command(tab.webSocketDebuggerUrl,'Runtime.evaluate',{expression:"(()=>{if(typeof sessionToken==='string'&&sessionToken)return sessionToken;return sessionStorage.getItem('board-session')||''})()",returnByValue:true,timeout:2000});
    let token=result.result?.value;
    if(!token){const result=await command(tab.webSocketDebuggerUrl,'Network.getCookies',{urls:[ORIGIN+'/']});token=result.cookies?.find(v=>v.name==='board_session')?.value;}
    if(typeof token==='string'&&token){cfg.credential=token;cfg.proxy='http://127.0.0.1:'+profile.port;credentialAt=performance.now();save();return;}
   }
  }
  credentialAt=performance.now();if(!cfg.credential)throw Error('告示栏尚无可复用的主管登录会话');
 }
 async function request(values){
  if(!cfg.credential||!/^http:\/\/127\.0\.0\.1:\d+$/.test(cfg.proxy||''))throw Error('告示栏现有授权或环境代理未就绪');
  const body=JSON.stringify({sourceId:cfg.sourceId,entries:values}),agent=new HttpsProxyAgent(cfg.proxy);
  try{return await new Promise((resolve,reject)=>{
   const req=https.request(ORIGIN+'/api/cast/sync',{method:'POST',agent,headers:{Authorization:'Bearer '+cfg.credential,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let raw='';res.setEncoding('utf8');res.on('data',chunk=>{raw+=chunk;if(raw.length>100000)req.destroy(Error('告示栏响应过大'));});res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200){const e=Error('告示栏投屏同步返回 '+res.statusCode);e.code='BOARD_HTTP_'+res.statusCode;if(res.statusCode===401||res.statusCode===403)credentialAt=-Infinity;return reject(e);}try{const data=JSON.parse(raw);if(data.ok!==true)throw Error('告示栏未确认投屏同步');resolve(data);}catch(e){reject(e);}});});
   req.setTimeout(8000,()=>req.destroy(Error('告示栏投屏同步超时')));req.on('error',reject);req.end(body);
  });}finally{agent.destroy();}
 }
 function kick(){
  if(stopped)return;if(work){pending=true;return;}
  work=(async()=>{try{await credentials();const current=entries.slice(),signature=JSON.stringify(current);const result=await request(current);lastPublished=signature;lastAt=Date.now();published=result.published.length;error=null;log.recover('noticeboard-sync');}
   catch(e){error=e.message;log.record('noticeboard-sync',e);}
  })().finally(()=>{work=null;if(pending&&!stopped){pending=false;kick();}});
 }
 function observe(rows){
  if(stopped)return;const present=new Set(),next=[];
  for(const row of rows){
   present.add(row.profileId);
   if(row.state==='error'||row.connectionState==='unknown'){
    if(!unknownSince.has(row.profileId))unknownSince.set(row.profileId,performance.now());
    if(performance.now()-unknownSince.get(row.profileId)<10000)next.push(...entries.filter(v=>v.environmentId===row.profileId));continue;
   }
   unknownSince.delete(row.profileId);if(row.sourceAvailable!==true)continue;
   const instance=String(row.browserInstance)+':'+row.windowId;
   if(cfg.seen[row.profileId]!==instance){start(row);cfg.seen[row.profileId]=instance;save();}
   const address=link(row);if(address)next.push({environmentId:row.profileId,name:'环境 '+row.number,url:address});
  }
  for(const id of Object.keys(cfg.seen))if(!present.has(id))delete cfg.seen[id];
  const signature=JSON.stringify(next);entries=next;
  if(signature!==lastSignature){lastSignature=signature;save();kick();}
  else if(!lastAt&&!work)kick();
 }
 const timer=setInterval(kick,5000);timer.unref();save();
 return {observe,status:()=>({enabled:true,published,lastAt,error,pending:!!work}),async close(){stopped=true;clearInterval(timer);if(work)await work;save();}};
}
module.exports={create};

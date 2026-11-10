import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function validateConfig(value) {
  const c={pollMs:5000,heartbeatMs:30000,modelTimeoutMs:600000,publicModel:'qwen-local',...value};
  const site=new URL(c.site),ollama=new URL(c.ollama||'http://127.0.0.1:11434');
  if(site.origin!=='https://team-noticeboard-rebuilt.loneivy1.chatgpt.site')throw Error('Only the existing noticeboard is supported');
  if(!['127.0.0.1','localhost','[::1]'].includes(ollama.hostname)||ollama.protocol!=='http:')throw Error('Ollama must use a local loopback address');
  if(typeof c.token!=='string'||!/^[a-f0-9]{64}$/.test(c.token))throw Error('A private 256-bit gateway token is required');
  if(typeof c.model!=='string'||!/qwen/i.test(c.model))throw Error('Configure the installed Qwen model');
  if(typeof c.workerId!=='string'||!c.workerId)throw Error('workerId is required');
  return {...c,site:site.origin,ollama:ollama.origin};
}
export async function completeWithQwen(config,messages,{fetchImpl=fetch,signal,json=true}={}) {
  if(!Array.isArray(messages)||!messages.length||messages.length>50||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(messages).length>60000)throw Error('Invalid messages');
  const r=await fetchImpl(config.ollama+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages,stream:false,...(json?{format:'json'}:{}),options:{temperature:0,num_ctx:8192,num_predict:1536},keep_alive:'10m'}),signal});
  if(!r.ok)throw Error('Qwen HTTP '+r.status);const value=await r.json();
  if(typeof value.message?.content!=='string'||!value.message.content.trim())throw Error('Qwen returned no content');
  if(value.done_reason==='length')throw Error('Qwen output was truncated');
  return {content:value.message.content,model:value.model||config.model,usage:{prompt_tokens:value.prompt_eval_count||0,completion_tokens:value.eval_count||0,total_tokens:(value.prompt_eval_count||0)+(value.eval_count||0)}};
}
export function createQwenGateway(config,{fetchImpl=fetch,stateDir,log=console.log}={}) {
  const c=validateConfig(config),dir=stateDir||path.resolve('state');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const activeFile=path.join(dir,'active-job.json'),status={model:c.model,publicModel:c.publicModel,ready:false,siteConnected:false,lastResult:null};let stopped=false,server,controller,lastHeartbeat=0;
  let active=null;try{active=JSON.parse(fs.readFileSync(activeFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  function save(){const temp=activeFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(active),{mode:0o600});fs.renameSync(temp,activeFile)}
  function clear(){active=null;fs.rmSync(activeFile,{force:true})}
  async function site(endpoint,body) {
    const r=await fetchImpl(c.site+'/api/points/gateway/'+endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Gateway '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Object.assign(Error('Site gateway HTTP '+r.status),{httpStatus:r.status});return r.json();
  }
  async function heartbeat() {
    const r=await fetchImpl(c.ollama+'/api/tags',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Ollama is not available');const data=await r.json();status.ready=!!data.models?.some(m=>m.name===c.model||m.model===c.model);
    if(!status.ready)throw Error('The configured Qwen model is not installed');await site('heartbeat',{workerId:c.workerId,model:c.model,ready:true});status.siteConnected=true;lastHeartbeat=Date.now();
  }
  async function tick() {
    if(Date.now()-lastHeartbeat>c.heartbeatMs)await heartbeat();
    if(!active){const result=await site('claim',{workerId:c.workerId});if(!result.job)return false;active={...result.job,phase:'claimed'};save();log(JSON.stringify({event:'claimed',id:active.id}));}
    // A process restart must not blindly repeat an inference of unknown outcome.
    if(active.phase==='inference_started'){active.result={error:true,model:c.model};active.phase='result_ready';save();}
    if(active.phase==='claimed'){
      controller=new AbortController();active.phase='inference_started';save();const job=active;
      const renew=setInterval(()=>site('renew',{id:job.id,requestId:job.requestId,leaseToken:job.leaseToken}).catch(e=>{if(e.httpStatus===409)controller?.abort()}),25000);
      const timer=setTimeout(()=>controller.abort(),c.modelTimeoutMs);
      try{active.result=await completeWithQwen(c,job.messages,{fetchImpl,signal:controller.signal,json:true})}catch{active.result={error:true,model:c.model}}
      finally{clearInterval(renew);clearTimeout(timer);controller=null}
      active.phase='result_ready';save();
    }
    try{const r=await site('result',{id:active.id,requestId:active.requestId,leaseToken:active.leaseToken,...active.result});status.lastResult={id:active.id,status:r.status,at:new Date().toISOString()};log(JSON.stringify({event:'finished',...status.lastResult}));clear();return true}
    catch(e){if(e.httpStatus===409){log(JSON.stringify({event:'stale_job',id:active.id}));clear();return false}throw e}
  }
  async function loop(){let backoff=c.pollMs;while(!stopped){try{await tick();backoff=c.pollMs}catch(e){status.siteConnected=false;status.lastError={httpStatus:e.httpStatus||null,code:e.cause?.code||e.code||e.name};log(JSON.stringify({event:'retry',delayMs:backoff,...status.lastError}));backoff=Math.min(30000,Math.max(c.pollMs,backoff*2))}await new Promise(resolve=>{const t=setTimeout(resolve,backoff);if(stopped){clearTimeout(t);resolve()}})}}
  function authorized(req){const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;return !!token&&/^[a-f0-9]{64}$/.test(token)&&token.length===c.token.length&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(c.token))}
  async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)throw Error('Request too large');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
  async function startApi(){
    server=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
      try{if(req.url==='/health'&&req.method==='GET'){send(200,{ok:true,...status});return}if(!authorized(req)){send(401,{error:'Authentication required'});return}
       if(req.url==='/v1/models'&&req.method==='GET'){send(200,{object:'list',data:[{id:c.publicModel,object:'model',owned_by:'local-qwen'}]});return}
       if(req.url==='/gateway/probe'&&req.method==='POST'){send(200,await site('probe',{}));return}
       if(req.url==='/v1/chat/completions'&&req.method==='POST'){const b=await body(req);if(b.stream||b.tools||b.model&&![c.model,c.publicModel].includes(b.model)){send(400,{error:'Only the configured Qwen model and non-streaming text are supported'});return}const r=await completeWithQwen(c,b.messages,{fetchImpl,signal:AbortSignal.timeout(c.modelTimeoutMs),json:b.response_format?.type==='json_object'});send(200,{id:'chatcmpl-'+crypto.randomUUID(),object:'chat.completion',created:Math.floor(Date.now()/1000),model:c.publicModel,choices:[{index:0,message:{role:'assistant',content:r.content},finish_reason:'stop'}],usage:r.usage});return}
       send(404,{error:'Not found'});
      }catch{send(502,{error:'Local Qwen request failed; check private gateway logs'})}
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address='http://127.0.0.1:'+server.address().port;fs.writeFileSync(path.join(dir,'endpoint.json'),JSON.stringify({address,model:c.model,pid:process.pid}),{mode:0o600});return address;
  }
  async function stop(){stopped=true;controller?.abort();if(server)await new Promise(resolve=>server.close(resolve))}
  return {tick,loop,startApi,stop,status,probe:()=>site('probe',{})};
}
export async function main(configFile) {
  if(!configFile)throw Error('Use: node gateway.mjs /private/path/gateway.json');const file=path.resolve(configFile),config=JSON.parse(fs.readFileSync(file,'utf8')),dir=path.dirname(file),lock=path.join(dir,'gateway.lock');
  try{fs.mkdirSync(lock,{mode:0o700})}catch{let pid;try{pid=JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8')).pid;process.kill(pid,0);throw Error('Gateway is already running')}catch(e){if(e.message==='Gateway is already running')throw e;fs.rmSync(lock,{recursive:true,force:true});fs.mkdirSync(lock,{mode:0o700})}}
  fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600});const gateway=createQwenGateway(config,{stateDir:dir});let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await gateway.stop();fs.rmSync(lock,{recursive:true,force:true})};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{console.log(JSON.stringify({event:'api_ready',address:await gateway.startApi(),model:config.model}));await gateway.loop()}finally{await stop()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv[2]).catch(()=>{console.error('Qwen gateway startup failed; inspect configuration and private state');process.exitCode=1});

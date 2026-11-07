import {readFile} from 'node:fs/promises';
const repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;if(!repo||!token)throw Error('GitHub Actions context required');
const base='https://api.github.com/repos/'+repo,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'noticeboard-publisher'};
async function call(path,options={}){const r=await fetch(base+path,{...options,headers});if(!r.ok)throw Error('GitHub publishing HTTP '+r.status);return r.json()}
const head=await call('/git/ref/heads/main');if(head.object.sha!==process.env.GITHUB_SHA){console.log('A newer main commit exists; its queued build will publish.');process.exit(0)}
const old=await call('/contents/index.html?ref=main'),content=await readFile('dist/pages/index.html');if(Buffer.from(old.content.replace(/\s/g,''),'base64').equals(content)){console.log('Generated UI already current.');process.exit(0)}
await call('/contents/index.html',{method:'PUT',body:JSON.stringify({message:'build: publish generated UI from '+process.env.GITHUB_SHA,branch:'main',sha:old.sha,content:content.toString('base64')})});console.log('Repository UI published.');

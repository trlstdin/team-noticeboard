import {readFile,appendFile} from 'node:fs/promises';
const repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;if(!repo||!token)throw Error('GitHub Actions context required');
const base='https://api.github.com/repos/'+repo,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'noticeboard-publisher'};
async function call(path,options={}){const r=await fetch(base+path,{...options,headers});if(!r.ok)throw Error('GitHub publishing HTTP '+r.status);return r.json()}
const head=await call('/git/ref/heads/main');if(head.object.sha!==process.env.GITHUB_SHA){const changes=await call('/compare/'+process.env.GITHUB_SHA+'...'+head.object.sha);if(changes.files.length>=300||changes.files.some(file=>/^(web\/|worker\/|scripts\/|package(?:-lock)?\.json$|DESIGN\.md$|\.openai\/)/.test(file.filename))){console.log('Newer runtime source exists; its queued build will publish.');process.exit(0)}}
const commit=await call('/git/commits/'+head.object.sha);const files=[['index.html','dist/pages/index.html'],['backend-release.json','dist/backend/backend-release.json']];const tree=[];
for(const [path,file] of files){const body=await readFile(file,'utf8');const blob=await call('/git/blobs',{method:'POST',body:JSON.stringify({content:body,encoding:'utf-8'})});tree.push({path,mode:'100644',type:'blob',sha:blob.sha})}
const snapshot=await call('/git/trees',{method:'POST',body:JSON.stringify({base_tree:commit.tree.sha,tree})});const publication=await call('/git/commits',{method:'POST',body:JSON.stringify({message:'build: publish UI and backend from '+process.env.GITHUB_SHA,tree:snapshot.sha,parents:[head.object.sha]})});await call('/git/refs/heads/main',{method:'PATCH',body:JSON.stringify({sha:publication.sha,force:false})});console.log('Repository UI and backend published atomically.');

if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'published=true\n');

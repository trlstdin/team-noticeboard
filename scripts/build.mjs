import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const html=await readFile('web/index.html','utf8');
const js=(await readFile('web/drag.js','utf8'))+'\n'+(await readFile('web/app.js','utf8'));const css=await readFile('web/style.css','utf8');
const config={frontendUrl:'https://trlstdin.github.io/team-noticeboard/'};
const page=html.replace('/* APP_CSS */',()=>css).replace('/* APP_JS */',()=>'window.BOARD_CONFIG='+JSON.stringify(config)+';\n'+js);
const auth=(await readFile('worker/github-auth.js','utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'');const server=auth+'\n'+(await readFile('worker/index.js','utf8')).replace(/^import .*?;\n/m,'').replace(/^export \{.*?\};?$/mg,'');const design=await readFile('DESIGN.md','utf8');
await writeFile('dist/server/index.js','const PAGE='+JSON.stringify(page)+';\nconst DESIGN_DOCUMENT='+JSON.stringify(design)+';\n'+server);
await cp('.openai/hosting.json','dist/.openai/hosting.json');
await mkdir('dist/pages',{recursive:true});const backend='https://team-noticeboard-trlstdin.taproom-61-rumples.chatgpt.site';
let publicSnapshot=null;try{publicSnapshot=JSON.parse(await readFile('public-state.json','utf8'));if(publicSnapshot.actor.edit||publicSnapshot.accounts.length||publicSnapshot.users.length||publicSnapshot.tokens.length)throw Error('Snapshot must contain public data only')}catch(e){if(e.code!=='ENOENT')throw e}
const staticPage=page.replace('window.BOARD_CONFIG='+JSON.stringify(config),()=> 'window.BOARD_CONFIG='+JSON.stringify({...config,apiBase:backend,static:true,publicSnapshot})).replace('href="/design.md"','href="./DESIGN.md"');
await writeFile('dist/pages/index.html',staticPage);await cp('DESIGN.md','dist/pages/DESIGN.md');if(publicSnapshot)await writeFile('dist/pages/public-state.json',JSON.stringify(publicSnapshot));
console.log('Built Worker and static frontend');

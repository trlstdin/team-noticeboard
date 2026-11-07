import ts from 'typescript';import {build} from 'esbuild';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {writeFile,mkdir} from 'node:fs/promises';
export async function buildBackendRelease(nativeCode){
 const code=ts.transpileModule(nativeCode.replace('export default','var __noticeboardBackend ='),{compilerOptions:{target:ts.ScriptTarget.ES5,module:ts.ModuleKind.None,downlevelIteration:true}}).outputText;
 let sourceCommit=process.env.GITHUB_SHA;try{sourceCommit||=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}catch{sourceCommit='local'}
 const release={schema:1,sourceCommit,sha256:createHash('sha256').update(code).digest('hex'),code};await mkdir('dist/backend',{recursive:true});await writeFile('dist/backend/backend-release.json',JSON.stringify(release));await writeFile('dist/backend/fallback.mjs','export default '+JSON.stringify(release)+';');
 await build({entryPoints:['worker/repository-loader.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',minify:true});
}

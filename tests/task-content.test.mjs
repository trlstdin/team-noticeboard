import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const expandedTasks='),app.indexOf('\nfunction renderAccounts()'));
function card(task){const context=vm.createContext({editing:true,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});vm.runInContext(source,context);return context.taskCard({id:'t',repoId:'r',title:'用户原文',body:'原文第一行\n原文第二行',...task},{id:'r',canEdit:true,url:'https://github.com/board/storage'})}
test('tasks start collapsed and summarize user text without inventing metadata',()=>{const html=card({});assert.match(html,/<details class="task-details" data-task-details="t">/);assert.match(html,/<p class="task-overview">原文第一行\n原文第二行<\/p>/);assert.ok(!html.includes('BUG 所在主机'));assert.ok(!html.includes('board/storage'));assert.ok(!html.includes('未填写'));assert.ok(!html.includes('待认领'));assert.ok(!html.includes('待完成'))});
test('only explicit task repository addresses and host appear in details, safely escaped',()=>{const html=card({host:'<主机>',repositoryUrl:'https://github.com/alistrode/project-manager',personalRepositoryUrl:'https://github.com/trlstdin/rororororo/tree/projects/project-manager'});assert.match(html,/BUG 所在主机：&lt;主机&gt;/);assert.ok(html.includes('https://github.com/alistrode/project-manager'));assert.ok(html.includes('tree/projects/project-manager'));assert.ok(!html.includes('board/storage'))});

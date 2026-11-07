// Run the actual permission suite against the interpreted engine, not a second implementation.
import {readFile} from 'node:fs/promises';
const target=new URL('./interpreted-backend.mjs',import.meta.url).href;
const source=(await readFile(new URL('./permissions.test.mjs',import.meta.url),'utf8')).replaceAll('../worker/index.js',target);
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
test('site serves UI from the deployed release without external fetches',async()=>{
 globalThis.PAGE='<html><head></head><body>release UI</body></html>';
 try{
 const env={UI_FETCH:async()=>{throw Error('Unexpected external UI request')}};
 const response=await worker.fetch(new Request('https://board.test/',{headers:{cookie:'board_session=private'}}),env,{});
 assert.equal(response.status,200);
 assert.match(await response.text(),/repository-release.*release UI/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 const api=await worker.fetch(new Request('https://board.test/api/auth/config'),env,{});
 assert.deepEqual(await api.json(),{github:true});
 }finally{delete globalThis.PAGE}
});

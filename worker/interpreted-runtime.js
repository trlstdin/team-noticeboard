import {Interpreter} from 'eval5';
export function instantiateBackend(code){
 const context={console,Promise,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,crypto,fetch,AbortSignal,atob,btoa,setTimeout,clearTimeout,Symbol,Map,Set,Date,JSON,Object,Number,String,Boolean,RegExp,Array,Error,Math,Infinity,NaN,parseInt,parseFloat,isNaN,encodeURIComponent,decodeURIComponent,escape,unescape};
 const interpreter=new Interpreter(context,{timeout:0});interpreter.evaluate(code);const handler=interpreter.evaluate('__noticeboardBackend');if(typeof handler?.fetch!=='function')throw Error('Invalid backend entry');return {handler,read:name=>interpreter.evaluate(name)};
}

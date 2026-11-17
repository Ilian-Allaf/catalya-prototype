import { test } from 'node:test';import assert from 'node:assert/strict';import { readFileSync,mkdtempSync } from 'node:fs';import { tmpdir } from 'node:os';import path from 'node:path';
import { extractAI } from '../src/server/agent';import { localExtract } from '../src/server/business';
process.env.CATALYA_DB=path.join(mkdtempSync(path.join(tmpdir(),'catalya-agent-tests-')),'test.db');
const text=readFileSync('examples/Demande_1.txt','utf8');
function response(name:string,args:unknown,id:string){return {id:'resp-'+id,object:'response',created_at:0,model:'openai/gpt-4.1-mini',status:'completed',output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:id,id:'fc-'+id,status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20,cost:0.0001}};}
test('Le Runner JS renvoie le résultat des outils, borne les appels et refuse les outils inconnus',async()=>{
 const original=globalThis.fetch,old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='fixture-not-a-secret';
 const requests:Record<string,unknown>[]=[];const e=localExtract(text);const {mode,mode_label,history_candidates,...submission}=e;
 try{
  const replies=[response('search_catalog',{query:'HDT-NM-100'},'1'),response('submit_request',submission,'2')];
  globalThis.fetch=async(input,init)=>{assert(String(input).startsWith('https://openrouter.ai/api/v1'));requests.push(JSON.parse(String(init?.body)));return Response.json(replies.shift()!);};
  const result=await extractAI(text);assert.equal(result.orchestrator,'openai-agents-js');assert.equal(result.lines[0].quantity,'8000');assert.equal(requests.length,2);assert.equal(requests[0].store,false);assert(JSON.stringify(requests[1]).includes('function_call_output'));
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(response('search_catalog',{query:'NiMo'},String(calls)));};await assert.rejects(()=>extractAI(text),/six tours/);assert.equal(calls,6);
  globalThis.fetch=async()=>Response.json(response('write_catalog',{query:'x'},'unknown'));await assert.rejects(()=>extractAI(text),/données exploitables/);
 }finally{globalThis.fetch=original;if(old)process.env.OPENROUTER_API_KEY=old;else delete process.env.OPENROUTER_API_KEY;}
});
test('Le SDK reçoit réellement les tours user-assistant-user et la question à laquelle répond oui',async()=>{
 const original=globalThis.fetch,old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='fixture-not-a-secret';
 const source=readFileSync('examples/Demande_4.txt','utf8'),e=localExtract(source),question='Notre offre standard est établie en EUR. Cette devise vous convient-elle ?',reply="oui l'euro convient";
 const {mode,mode_label,history_candidates,...submission}=e;submission.answered_questions=[{code:'currency',outcome:'confirmed',value:'EUR',evidence:reply,reply_index:0}];
 let sent:Record<string,unknown>|undefined;let calls=0;
 try{globalThis.fetch=async(_input,init)=>{const payload=JSON.parse(String(init?.body));sent??=payload;return Response.json(response('submit_request',submission,'conversation-'+(++calls)));};
  const result=await extractAI(source+'\nComplément client saisi par le commercial :\n'+reply,undefined,undefined,undefined,{messages:[{role:'user',content:source},{role:'assistant',content:question},{role:'user',content:reply}],replies:[reply],questions:[{code:'currency',question,audience:'client',owner:'Commercial'}],currentExtraction:e,processingDate:'2026-11-13'});
  const items=sent!.input as {role?:string;content:unknown}[];assert.deepEqual(items.filter(i=>i.role).map(i=>i.role),['user','assistant','user']);assert(JSON.stringify(items[1]).includes(question));assert(JSON.stringify(items[2]).includes(reply));assert.equal(result.answered_questions[0].value,'EUR');
 }finally{globalThis.fetch=original;if(old)process.env.OPENROUTER_API_KEY=old;else delete process.env.OPENROUTER_API_KEY;}
});

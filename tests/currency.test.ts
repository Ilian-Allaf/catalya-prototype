import { test } from 'node:test';import assert from 'node:assert/strict';import { mkdtempSync,readFileSync } from 'node:fs';import { tmpdir } from 'node:os';import path from 'node:path';
import { analyze } from '../src/server/workflow';import { localExtract,prepare,calculate } from '../src/server/business';import type { Extraction,Question } from '../src/lib/types';
process.env.CATALYA_DB=path.join(mkdtempSync(path.join(tmpdir(),'catalya-currency-')),'test.db');
const source=readFileSync('examples/Demande_4.txt','utf8'),processing_date='2026-11-13';
const question:Question={code:'currency',question:'Notre offre standard est établie en EUR. Cette devise vous convient-elle ?',audience:'client',owner:'Commercial'};
const start=()=>analyze({text:source,mode:'local',processing_date});
const reply=(p:{request_id:number;version:number},text:string)=>analyze({text,mode:'local',processing_date,reply:true,request_id:p.request_id,expected_version:p.version});
test('Accord EUR : la réponse exacte supprime la question sans résoudre CIF',async()=>{
 const first=await start();assert(first.quote.clarification.questions.some(q=>q.code==='currency'));
 const second=await reply(first.quote,"oui l'euro convient");assert.equal(second.quote.extraction.currency_requested,'EUR');assert(!second.quote.clarification.questions.some(q=>q.code==='currency'));assert(second.quote.blocks.some(b=>b.includes('CIF')));assert.equal(second.quote.total,'179117.00');
 const third=await reply(second.quote,'Merci.');assert.equal(third.quote.extraction.currency_requested,'EUR');assert(!third.quote.clarification.questions.some(q=>q.code==='currency'));
});
test('Un refus ultérieur persiste et ne ressuscite pas un ancien oui',async()=>{
 const first=await start(),second=await reply(first.quote,"oui l'euro convient"),third=await reply(second.quote,"Non, l'euro ne convient pas, nous souhaitons USD.");assert.equal(third.quote.extraction.currency_requested,'USD');
 const fourth=await reply(third.quote,'Merci.');assert.equal(fourth.quote.extraction.currency_requested,'USD');assert(!fourth.quote.clarification.questions.some(q=>q.code==='currency'));assert(fourth.quote.clarification.questions.some(q=>q.code==='currency-review'&&q.audience==='internal'));
});
function semantic(reply:string,answers:Extraction['answered_questions'],questions:Question[]=[question]){const e=localExtract(source);e.mode='ai';e.answered_questions=answers;e.gaps=['Devise USD à confirmer.','CIF : fret et assurance à confirmer.'];prepare(e,source,{originalText:source,replies:[reply],questions,processingDate:processing_date});return calculate(e,processing_date,source);}
test('La résolution IA repose sur une réponse sémantique ancrée, sans mot-clé euro requis',()=>{
 const text='Cela me va tout à fait.';const p=semantic(text,[{code:'currency',outcome:'confirmed',value:'EUR',evidence:text,reply_index:0}]);assert.equal(p.extraction.currency_requested,'EUR');assert(!p.clarification.questions.some(q=>q.code==='currency'));assert(p.blocks.some(b=>b.includes('CIF')));
});
test('Une preuve absente, tronquée, ou citée depuis le mail initial ne résout pas la devise',()=>{
 for(const answer of [{code:'currency',outcome:'confirmed' as const,value:'EUR',evidence:'oui',reply_index:0},{code:'currency',outcome:'confirmed' as const,value:'EUR',evidence:'Price basis: CIF Jubail Commercial Port, in USD.',reply_index:0},{code:'currency',outcome:'confirmed' as const,value:'EUR',evidence:'Non.',reply_index:99}])assert.equal(semantic('Non.',[answer]).extraction.currency_requested,'USD');
});
test('Un oui local ambigu ne résout pas plusieurs questions ni une action interne',()=>{
 const e=localExtract(source);prepare(e,source,{originalText:source,replies:['oui'],processingDate:processing_date,questions:[question,{code:'address',question:'Quelle adresse ?',audience:'client',owner:'Commercial'}]});assert.equal(e.currency_requested,'USD');
 const p=semantic('Oui.',[{code:'currency',outcome:'confirmed',value:'EUR',evidence:'Oui.',reply_index:0}],[]);assert.equal(p.extraction.currency_requested,'USD');
});

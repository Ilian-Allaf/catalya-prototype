import { mkdtempSync,readFileSync,mkdirSync,writeFileSync } from 'node:fs';import { tmpdir } from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import { analyze } from '../src/server/workflow';
process.env.CATALYA_DB=path.join(mkdtempSync(path.join(tmpdir(),'catalya-dialogue-')),'live.db');
const out=process.argv[2]||'eval-results/conversation-live';mkdirSync(out);
const source=readFileSync('examples/Demande_4.txt','utf8'),processing_date='2026-11-13';
async function main(){const records=[];
 for(const text of ["oui l'euro convient",'oui','Cela me va tout à fait.']){
  const first=await analyze({text:source,processing_date,mode:'ai'});
  assert(first.quote.clarification.questions.some(q=>q.code==='currency'));
  const second=await analyze({text,processing_date,mode:'ai',reply:true,request_id:first.quote.request_id,expected_version:first.quote.version});
  assert.equal(second.quote.extraction.currency_requested,'EUR');assert(!second.quote.clarification.questions.some(q=>q.code==='currency'));assert(second.quote.blocks.some(b=>b.includes('CIF')));assert.equal(second.quote.net,first.quote.net);assert(second.quote.extraction.ai_trace?.some(t=>t.tool==='conversation_context'));
  const third=await analyze({text:'Merci.',processing_date,mode:'ai',reply:true,request_id:second.quote.request_id,expected_version:second.quote.version});
  assert.equal(third.quote.extraction.currency_requested,'EUR');assert(!third.quote.clarification.questions.some(q=>q.code==='currency'));
  records.push({text,first,second,third});writeFileSync(path.join(out,'results.json'),JSON.stringify(records,null,2));console.log(JSON.stringify({reply:text,pass:true,currency:'EUR',no_repeated_currency_question:true,CIF_still_blocked:true,retained_after_thanks:true}));
  if(text==="oui l'euro convient"){
   const fourth=await analyze({text:"Finalement je n’accepte pas l’euro, je préfère USD.",processing_date,mode:'ai',reply:true,request_id:third.quote.request_id,expected_version:third.quote.version});
   assert.equal(fourth.quote.extraction.currency_requested,'USD');assert(!fourth.quote.clarification.questions.some(q=>q.code==='currency'));assert(fourth.quote.clarification.questions.some(q=>q.code==='currency-review'));
   const fifth=await analyze({text:'Merci.',processing_date,mode:'ai',reply:true,request_id:fourth.quote.request_id,expected_version:fourth.quote.version});assert.equal(fifth.quote.extraction.currency_requested,'USD');records.push({retraction:true,fourth,fifth});writeFileSync(path.join(out,'results.json'),JSON.stringify(records,null,2));console.log('Rétractation et maintien du refus vérifiés.');
  }
 }
 writeFileSync(path.join(out,'summary.json'),JSON.stringify({acceptance_variants:3,acceptance_passes:3,retraction_and_persistence:true,real_conversation_roles:true,original_email_does_not_override_answer:true,internal_blocks_preserved:true},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

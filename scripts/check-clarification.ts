import { mkdtempSync,readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import { createHash } from 'node:crypto';
import { analyze } from '../src/server/workflow';
process.env.CATALYA_DB=path.join(mkdtempSync(path.join(tmpdir(),'catalya-clarification-live-')),'live.db');
const out=process.argv[2]||'eval-results/clarification-fix-live';mkdirSync(out);
const text=readFileSync('examples/Demande_3.txt','utf8'),processing_date='2026-11-13';
async function main(){const records=[];let prior:{request_id:number;version:number}|undefined;
 for(let repetition=1;repetition<=3;repetition++){
  const first=await analyze({text,processing_date,mode:'ai',...(prior?{request_id:prior.request_id,expected_version:prior.version}:{})});
  assert(first.quote.clarification.questions.some(q=>q.code==='historical-confirmation'));assert(first.quote.clarification.questions.some(q=>q.code==='delivery-date'));
  const second=await analyze({text:'je confirme HYD-NI-50 pour 3200 kg, le 30 janvier',processing_date,mode:'ai',reply:true,request_id:first.quote.request_id,expected_version:first.quote.version});
  assert.equal(second.quote.extraction.delivery_date,'2027-01-30');assert.equal(second.quote.net,'174464.00');assert.deepEqual(second.quote.blocks,[]);assert.deepEqual(second.quote.clarification.questions,[]);assert.equal(second.quote.approver,null);
  const third=await analyze({text:'Merci.',processing_date,mode:'ai',reply:true,request_id:second.quote.request_id,expected_version:second.quote.version});
  assert.deepEqual(third.quote.blocks,[]);assert.equal(third.quote.extraction.delivery_date,'2027-01-30');assert.equal(third.quote.net,'174464.00');
  records.push({repetition,first,second,third});prior=third.quote;
  writeFileSync(path.join(out,'results.json'),JSON.stringify(records,null,2));console.log(JSON.stringify({repetition,pass:true,date:second.quote.extraction.delivery_date,net:second.quote.net,questions:second.quote.clarification.questions.length,retained_on_next_turn:true}));
 }
 const files=['src/server/clarification-state.ts','src/server/business.ts','src/server/workflow.ts','src/lib/types.ts'];writeFileSync(path.join(out,'summary.json'),JSON.stringify({scenario:'Demande historique, confirmation et date puis merci',repetitions:3,passes:3,year_inferred:'2027',approval_required:true,source_sha256:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

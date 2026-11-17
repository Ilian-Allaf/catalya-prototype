import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { runWorkspace,type SnapshotStore,type Stored } from '../src/server/cloud-workspace';
import { analyze,approve } from '../src/server/workflow';
import { document,download } from '../src/server/documents';
import { list,revision,AppError } from '../src/server/db';
const dataset=JSON.parse(readFileSync('evals/dataset.json','utf8'));
process.env.CATALYA_HOSTED='1';
class Store implements SnapshotStore{
 values=new Map<string,Stored>();
 async read(key:string){const value=this.values.get(key);return value?structuredClone(value):null;}
 async write(key:string,value:Stored['value'],etag?:string){if(this.values.get(key)?.etag!==etag)throw new AppError('Concurrent edit',409);this.values.set(key,{value:structuredClone(value),etag:String(Number(etag||0)+1)});}
}
const req=(id:string,method='GET')=>new Request('https://catalya.test/api/requests',{method,headers:{cookie:'catalya_session='+id.repeat(64)}});
test('Hébergement : isolation des visiteurs, restauration après exécution et Word durable',async()=>{
 const store=new Store();
 const p=await runWorkspace(req('a','POST'),async()=>{const {quote}=await analyze({text:dataset.cases[0].text,mode:'local',processing_date:dataset.processing_date});return quote;},store);
 assert.equal(p.net,'233120.00');
 assert.equal((await runWorkspace(req('b'),()=>list(),store)).length,0);
 await assert.rejects(()=>runWorkspace(req('b'),()=>revision(p.request_id),store),/introuvable/);
 await runWorkspace(req('a','POST'),()=>approve(p.request_id,p.version,'Cloud test'),store);
 await runWorkspace(req('a','POST'),()=>document(p.request_id,p.version),store);
 const saved=await runWorkspace(req('a'),()=>download(p.request_id,p.version),store);
 const zip=await JSZip.loadAsync(saved.buffer);assert((await zip.file('word/document.xml')!.async('string')).includes('233 120,00'));
 assert.equal((await runWorkspace(req('a'),()=>revision(p.request_id),store)).status,'devis_genere');
});
test('Hébergement : deux écritures concurrentes ne peuvent pas écraser le même état',async()=>{
 const store=new Store();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started=0;
 const change=()=>runWorkspace(req('c','POST'),async()=>{if(++started===2)release();await gate;return 'ok';},store);
 const results=await Promise.allSettled([change(),change()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('Hébergement : cookie absent et requête intersite refusés',async()=>{
 const store=new Store();await assert.rejects(()=>runWorkspace(new Request('https://catalya.test/api/requests'),()=>list(),store),/Rechargez/);
 await assert.rejects(()=>runWorkspace(new Request('https://catalya.test/api/requests',{method:'POST',headers:{cookie:'catalya_session='+'a'.repeat(64),origin:'https://other.test'}}),()=>list(),store),/Origine/);
});

import { reservePublicAI } from './cloud-workspace';
import { z } from 'zod';
import { database,revision,hash,now,event,PIPELINE,VERSION,AppError,messages,summary,events } from './db';
import { localExtract,prepare,calculate,validDate } from './business';
import { extractAI,type Usage } from './agent';
import type { AgentEvent,ChatMessage,Quote,Extraction } from '@/lib/types';
const date=z.string().refine(validDate,'Date invalide, utiliser AAAA-MM-JJ.');
export const analysisSchema=z.object({text:z.string().min(2).max(20000),processing_date:date,mode:z.enum(['ai','local']),request_id:z.number().int().positive().optional(),expected_version:z.number().int().positive().optional(),reply:z.boolean().default(false)});
export async function analyze(input:unknown,emit?:(event:AgentEvent)=>void,onUsage?:(u:Usage)=>void,signal?:AbortSignal,onRaw?:(e:Extraction)=>void){
 const body=analysisSchema.parse(input),db=database();let previous:Quote|undefined;
 if(body.request_id){previous=revision(body.request_id);if(previous.version!==body.expected_version)throw new AppError('Une nouvelle version existe. Rechargez le dossier.',409);}
 if(body.reply&&!previous)throw new AppError('Sélectionnez le dossier à compléter.');
 const prior:ChatMessage[]=body.reply&&previous?messages(previous.request_id,previous.version):[];
 const userTurns=prior.filter(m=>m.role==='user');
 const replyContext={replies:body.reply?[...userTurns.slice(1).map(m=>m.content),body.text]:[],originalText:body.reply?(userTurns[0]?.content||previous!.source):body.text,processingDate:body.processing_date,questions:previous?.clarification.questions,previousState:previous?.extraction.clarification_state};
 const source=body.reply?previous!.source+'\n\nComplément client saisi par le commercial :\n'+body.text:body.text;
 if(source.length<20||source.length>40000)throw new AppError('La demande doit contenir entre 20 et 40 000 caractères.');
 const digest=hash(source);
 if(!previous){const dup=db.prepare('SELECT id FROM requests WHERE source_hash=?').get(digest);if(dup){previous=revision(Number(dup.id));if(previous.pipeline_version===PIPELINE&&previous.source_hash===digest&&previous.processing_date===body.processing_date&&previous.extraction.mode===body.mode)return {quote:{...previous,events:events(previous.request_id)},messages:messages(previous.request_id,previous.version)};}}
 emit?.({type:'status',message:body.mode==='ai'?'Lecture de la demande et consultation des référentiels…':'Analyse locale de la demande…'});
 if(body.mode==='ai')await reservePublicAI();
 const e=body.mode==='ai'?await extractAI(source,emit,onUsage,signal,body.reply&&previous?{messages:[...prior,{role:'user',content:body.text}],replies:replyContext.replies,questions:previous.clarification.questions,previousState:previous.extraction.clarification_state,currentExtraction:previous.extraction,processingDate:body.processing_date}:undefined):localExtract(source);
 onRaw?.(structuredClone(e));
 if(body.mode==='ai'){
  for(const f of ['received_date','delivery_date'] as const)if(e[f]&&/[T ]/.test(e[f]!))e[f]=e[f]!.slice(0,10);
  const baseline=localExtract(source);
  // Header fields have a deterministic source; do not ask for a value already explicit.
  if(!e.contact&&baseline.contact)e.contact=baseline.contact;
  if(!e.received_date&&baseline.received_date)e.received_date=baseline.received_date;
  for(const key of ['requested_discount','agreement','export_requested'] as const)if(baseline[key])e[key]=baseline[key];
  if(baseline.currency_requested==='USD')e.currency_requested='USD';if(baseline.delivery_date){e.delivery_date=baseline.delivery_date;e.exclusive_deadline=baseline.exclusive_deadline;}e.flexible=baseline.flexible;
  if(baseline.history_candidates?.length)e.gaps.push('Référence et quantité historiques à confirmer par le client.');
 }
 emit?.({type:'status',message:'Contrôle des données, calcul des prix et préparation du dossier…'});
 prepare(e,source,replyContext);
 if(body.mode==='ai')for(const line of e.lines)if(!source.includes(line.evidence))e.gaps.push('Extrait justificatif IA non retrouvé mot pour mot dans la demande.');
 const p=calculate(e,body.processing_date,source);p.source_hash=digest;p.pipeline_version=PIPELINE;
 if(signal?.aborted)throw new AppError('Analyse annulée.',499);
 // No database transaction is held across model calls. Compare again at commit.
 db.exec('BEGIN IMMEDIATE');try{
  let id:number,version:number;
  if(previous){const latest=revision(previous.request_id);if(latest.version!==previous.version)throw new AppError('Une nouvelle version existe. Rechargez le dossier.',409);id=latest.request_id;version=latest.version+1;}
  else {const dup=db.prepare('SELECT id FROM requests WHERE source_hash=?').get(digest);if(dup)throw new AppError('Cette demande vient d’être enregistrée. Rechargez les dossiers.',409);id=Number(db.prepare('INSERT INTO requests(source_hash,created_at) VALUES(?,?)').run(digest,now()).lastInsertRowid);version=1;}
  p.request_id=id;p.version=version;
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(id,version,source,JSON.stringify(p),p.status,null);
  const transcript:ChatMessage[]=[...prior,{role:'user',content:body.text},{role:'assistant',content:summary(p),version}];
  db.prepare('INSERT INTO conversations VALUES(?,?,?)').run(id,version,JSON.stringify(transcript));
  event(id,version,'analyse','commercial-demo',{mode:body.mode,tariff:VERSION,approval_reset:version>1,orchestrator:e.orchestrator||'local',clarification_resolutions:e.clarification_state?.resolutions||[]});
  db.exec('COMMIT');return {quote:{...p,events:events(id)},messages:transcript};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function approve(id:number,version:number,actor:string){if(actor.trim().length<3||actor.length>80)throw new AppError('Indiquez le nom du validateur (3 à 80 caractères).');const db=database();db.exec('BEGIN IMMEDIATE');try{const p=revision(id);if(p.version!==version)throw new AppError('Version modifiée. Rechargez le dossier.',409);if(p.blocks.length)throw new AppError('Des validations métier restent ouvertes. Génération bloquée.',409);if(!['approuve','devis_genere'].includes(p.status)){db.prepare('UPDATE revisions SET status=?,approver=? WHERE request_id=? AND version=?').run('approuve',actor.trim(),id,version);event(id,version,'approbation',actor.trim(),{local_demo_identity:true});}db.exec('COMMIT');return {...revision(id),events:events(id)};}catch(e){db.exec('ROLLBACK');throw e;}}

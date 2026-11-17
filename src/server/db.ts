import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync,mkdirSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Client,Product,History,Quote,AuditEvent,ChatMessage } from '@/lib/types';
export const VERSION='CAT-2026-11-kit-v1';
export const PIPELINE='nextjs-conversation-v3';
export const ROOT=process.cwd();
export function hash(text:string|Buffer){return createHash('sha256').update(text).digest('hex');}
export function now(){return new Date().toISOString();}
export const workspaceDatabase=new AsyncLocalStorage<DatabaseSync>();
let singleton:DatabaseSync|undefined;
export function database(){
 const scoped=workspaceDatabase.getStore();if(scoped)return scoped;
 if(singleton)return singleton;
 singleton=createDatabase(process.env.CATALYA_DB||(process.env.VERCEL?':memory:':path.join(ROOT,'runtime/catalya.db')));return singleton;
}
export function createDatabase(target=':memory:'){
 if(target!==':memory:')mkdirSync(path.dirname(target),{recursive:true});
 const db=new DatabaseSync(target);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;
 CREATE TABLE IF NOT EXISTS tariff_versions(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,imported_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS products(version TEXT REFERENCES tariff_versions(id),ref TEXT,payload TEXT NOT NULL,PRIMARY KEY(version,ref));
 CREATE TABLE IF NOT EXISTS clients(code TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,client TEXT,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,source_hash TEXT UNIQUE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS revisions(request_id INTEGER REFERENCES requests(id),version INTEGER,source TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,approver TEXT,PRIMARY KEY(request_id,version));
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,request_id INTEGER REFERENCES requests(id),version INTEGER,happened_at TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,details TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(request_id INTEGER,version INTEGER,content TEXT NOT NULL,PRIMARY KEY(request_id,version));
 CREATE TABLE IF NOT EXISTS conversations(request_id INTEGER REFERENCES requests(id),version INTEGER,messages TEXT NOT NULL,PRIMARY KEY(request_id,version));`);
 const raw=readFileSync(path.join(ROOT,'data/referentiel.json'));const digest=hash(raw);
 const current=db.prepare('SELECT source_hash FROM tariff_versions WHERE id=?').get(VERSION);
 if(current&&current.source_hash!==digest){db.close();throw new Error('Référentiel modifié : créer une nouvelle version tarifaire.');}
 if(!current){
  const data=JSON.parse(raw.toString()) as {catalogue:Record<string,Product>;clients:Record<string,Client>};
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT INTO tariff_versions VALUES(?,?,?)').run(VERSION,digest,now());
   for(const [ref,p] of Object.entries(data.catalogue)){if(p['Prix catalogue (€/kg)']<=0||p['Poids par unité (kg)']<=0)throw new Error('Catalogue invalide');db.prepare('INSERT INTO products VALUES(?,?,?)').run(VERSION,ref,JSON.stringify(p));}
   for(const [name,c] of Object.entries(data.clients))db.prepare('INSERT INTO clients VALUES(?,?,?)').run(c['Code client'],name,JSON.stringify(c));
   for(const h of JSON.parse(readFileSync(path.join(ROOT,'data/historique.json'),'utf8')) as History[])db.prepare('INSERT OR IGNORE INTO history VALUES(?,?,?)').run(h['N° devis'],h.Client,JSON.stringify(h));
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');db.close();throw e;}
 }
 return db;
}
export function reference(){const db=database();return {
 catalog:Object.fromEntries(db.prepare('SELECT ref,payload FROM products WHERE version=?').all(VERSION).map(r=>[r.ref,JSON.parse(String(r.payload))])) as Record<string,Product>,
 clients:Object.fromEntries(db.prepare('SELECT name,payload FROM clients').all().map(r=>[r.name,JSON.parse(String(r.payload))])) as Record<string,Client>
};}
export function history(client:string,family?:string|null){return database().prepare('SELECT payload FROM history WHERE client=?').all(client).map(r=>JSON.parse(String(r.payload)) as History).filter(h=>h.Statut==='Gagné'&&(!family||norm(h['Famille produit']).includes(norm(family)))).sort((a,b)=>(b['Date commande']||'').localeCompare(a['Date commande']||'')).slice(0,3);}
export function norm(s:unknown){return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
export class AppError extends Error{constructor(message:string,public status=422){super(message);}}
export function revision(id:number,version?:number):Quote{const r=database().prepare('SELECT * FROM revisions WHERE request_id=? '+(version!==undefined?'AND version=?':'ORDER BY version DESC LIMIT 1')).get(...(version!==undefined?[id,version]:[id]));if(!r)throw new AppError('Dossier introuvable.',404);return {...JSON.parse(String(r.payload)),request_id:id,version:Number(r.version),status:r.status,approver:r.approver};}
export function list(){return database().prepare('SELECT id FROM requests ORDER BY id DESC LIMIT 50').all().map(r=>revision(Number(r.id)));}
export function event(id:number,version:number,action:string,actor:string,details:unknown){database().prepare('INSERT INTO events(request_id,version,happened_at,action,actor,details) VALUES(?,?,?,?,?,?)').run(id,version,now(),action,actor,JSON.stringify(details));}
export function events(id:number){return database().prepare('SELECT * FROM events WHERE request_id=? ORDER BY id').all(id) as unknown as AuditEvent[];}
export function messages(id:number,version:number):ChatMessage[]{const r=database().prepare('SELECT messages FROM conversations WHERE request_id=? AND version=?').get(id,version);if(r)return JSON.parse(String(r.messages));const p=revision(id,version);return [{role:'user',content:p.source},{role:'assistant',content:summary(p),version:p.version}];}
export function summary(p:Quote){const decision=p.extraction.clarification_state?.resolutions.find(r=>r.field==='currency');const acknowledgement=decision?.value==='EUR'?'Votre accord pour une offre en EUR est bien pris en compte.\n\n':decision?.value==='USD'?'Votre demande en USD est bien conservée. Elle doit être traitée par le responsable commercial.\n\n':'';if(p.blocks.length)return acknowledgement+( p.clarification.client_message?`J’ai conservé les informations connues. Pour finaliser le devis, voici les points à préciser :\n\n${p.clarification.questions.filter(q=>q.audience==='client').map(q=>'• '+q.question).join('\n')}\n\nLe brouillon de message est disponible dans le dossier. Le devis reste bloqué.`:`Le besoin est analysé. ${p.clarification.questions.filter(q=>q.audience==='internal').map(q=>q.question).join(' ')}\n\nLes validations internes restent nécessaires avant de produire le devis.`);return acknowledgement+ `Le devis est prêt pour votre revue. ${p.rows.map(r=>r.reference+' : '+r.quantity_kg+' kg').join(', ')}.\n\nNet HT : ${Number(p.net).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}. Vérifiez les sources et les conditions, puis validez cette version pour générer le document Word.`;}

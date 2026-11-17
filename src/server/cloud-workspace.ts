import { get,put,BlobPreconditionFailedError } from '@vercel/blob';
import { AppError,createDatabase,workspaceDatabase } from './db';
import type { DatabaseSync,SQLInputValue } from 'node:sqlite';

export const SESSION_COOKIE='catalya_session';
export const hosted=()=>process.env.CATALYA_HOSTED==='1'||process.env.VERCEL==='1';
const tables=['requests','revisions','events','conversations','documents'] as const;
export type Snapshot={format:1;tables:Record<string,Record<string,SQLInputValue>[]>};
export type Stored={value:Snapshot;etag:string};
export interface SnapshotStore{
 read(key:string):Promise<Stored|null>;
 write(key:string,value:Snapshot,etag?:string):Promise<void>;
}
export const blobStore:SnapshotStore={
 async read(key){const r=await get(key,{access:'private',useCache:false});if(!r)return null;if(!r.stream)throw new Error('Empty snapshot response');return {value:await new Response(r.stream).json(),etag:r.blob.etag};},
 async write(key,value,etag){try{await put(key,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:!!etag,ifMatch:etag,contentType:'application/json',ttlDays:7});}catch(e){if(e instanceof BlobPreconditionFailedError||e instanceof Error&&e.name==='BlobAlreadyExistsError')throw new AppError('Le dossier a changÃ© dans un autre onglet. Rechargez-le avant de rÃ©essayer.',409);throw e;}}
};
export function exportSnapshot(db:DatabaseSync):Snapshot{return {format:1,tables:Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]))};}
export function importSnapshot(db:DatabaseSync,snapshot:Snapshot){
 if(snapshot.format!==1)throw new Error('Unsupported workspace snapshot');
 db.exec('BEGIN IMMEDIATE');try{for(const table of tables){const rows=snapshot.tables[table]||[];const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name));
  const insert=db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  for(const row of rows)insert.run(...columns.map(c=>row[c]??null));
 }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
export function sessionId(request:Request){const cookie=request.headers.get('cookie')||'';const id=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);if(!id||!/^[a-f0-9]{64}$/.test(id))throw new AppError('Rechargez la page pour initialiser votre espace de dÃ©monstration.',401);return id;}
export async function runWorkspace<T>(request:Request,operation:()=>Promise<T>|T,store:SnapshotStore=blobStore):Promise<T>{
 if(!hosted())return operation();
 if(request.method!=='GET'){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new AppError('Origine de la requÃªte refusÃ©e.',403);}
 const key=`sessions/${sessionId(request)}.json`,saved=await store.read(key),db=createDatabase();
 try{if(saved)importSnapshot(db,saved.value);return await workspaceDatabase.run(db,async()=>{
  const result=await operation();
  if(request.method!=='GET'&&!(result instanceof Response&&result.status>=400)){
   const snapshot=exportSnapshot(db);if(JSON.stringify(snapshot).length>2_000_000)throw new AppError('Votre espace de dÃ©monstration est plein. Ouvrez une nouvelle session.',413);
   await store.write(key,snapshot,saved?.etag);
  }
  if(result instanceof Response)result.headers.set('Cache-Control','private, no-store');
  return result;
 });}finally{db.close();}
}

// A persistent global ceiling bounds API spending even when visitors reset cookies.
export async function reservePublicAI(){
 if(!hosted())return;
 const key=`quota/${new Date().toISOString().slice(0,10)}.json`,r=await get(key,{access:'private',useCache:false});
 const count=r?.stream?Number((await new Response(r.stream).json()).count):0;
 const limit=Number(process.env.PUBLIC_AI_DAILY_LIMIT||'100');
 if(!Number.isFinite(count)||count>=limit)throw new AppError('Le quota IA de la dÃ©monstration est atteint pour aujourdâ€™hui. Le mode local reste disponible.',429);
 try{await put(key,JSON.stringify({count:count+1}),{access:'private',addRandomSuffix:false,allowOverwrite:!!r,ifMatch:r?.blob.etag,contentType:'application/json',ttlDays:2});}
 catch(e){if(e instanceof BlobPreconditionFailedError||e instanceof Error&&e.name==='BlobAlreadyExistsError')throw new AppError('Une analyse dÃ©marre dÃ©jÃ . RÃ©essayez dans quelques instants.',429);throw e;}
}

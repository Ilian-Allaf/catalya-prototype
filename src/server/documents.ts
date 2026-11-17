import JSZip from 'jszip';
import { DOMParser,XMLSerializer } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Decimal from 'decimal.js';
import { AppError,database,revision,event,ROOT,events } from './db';
import type { Quote } from '@/lib/types';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type XmlElement=ReturnType<ReturnType<DOMParser['parseFromString']>['createElement']>;
const fmt=(x:string|number)=>new Decimal(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,' ').replace('.',',');
function replace(root:XmlElement,map:Record<string,string>){for(const p of Array.from(root.getElementsByTagNameNS(W,'p'))){const ts=Array.from(p.getElementsByTagNameNS(W,'t'));const old=ts.map(t=>t.textContent||'').join('');const value=old.replace(/\{\{([^}]+)\}\}/g,(m,key)=>map[key]??m);if(value!==old&&ts.length){ts[0].textContent=value;ts.slice(1).forEach(t=>t.textContent='');}}}
export async function generateBuffer(p:Quote,number:string){
 if(p.blocks.length)throw new AppError('Le dossier comporte des validations ouvertes.',409);
 if(p.export||p.client?.Segment==='Grand compte')throw new AppError('Génération standard uniquement. Les autres modèles nécessitent les validations métier.');
 const zip=await JSZip.loadAsync(readFileSync(path.join(ROOT,'templates/Modele_devis_standard.docx')));const entry=zip.file('word/document.xml');if(!entry)throw new AppError('Modèle Word invalide.');
 const doc=new DOMParser().parseFromString(await entry.async('string'),'application/xml');const root=doc.documentElement;if(!root)throw new AppError('Modèle Word invalide.');
 for(const row of Array.from(root.getElementsByTagNameNS(W,'tr'))){if(!row.textContent?.includes('{{reference}}'))continue;for(const r of p.rows){const clone=row.cloneNode(true) as XmlElement;replace(clone,{reference:r.reference,designation:r.description,quantite_kg:fmt(r.quantity_kg),prix_unitaire:fmt(r.unit_price),montant_brut:fmt(r.gross)});row.parentNode!.insertBefore(clone,row);}row.parentNode!.removeChild(row);}
 const today=new Date(),until=new Date(today.getTime()+30*86400000),date=(d:Date)=>d.toLocaleDateString('fr-FR',{timeZone:'UTC'}),e=p.extraction,c=p.client!;
 const recipient=p.source.match(/^(?:À|To)\s*:\s*([^<\n]+)\s*<([^>]+)>/m);const base=new Decimal(p.gross).plus(p.surcharge);
 replace(root,{numero_devis:number,date_devis:date(today),date_validite:date(until),client_nom:e.client!,client_adresse:e.address!,client_contact:e.contact!,commercial_nom:c['Commercial référent'],commercial_email:recipient?.[2]||'commercial@catalya.example',date_demande:date(new Date(e.received_date!)),montant_brut_total:fmt(p.gross),taux_majoration_urgence:p.rush_rate,montant_majoration:fmt(p.surcharge),taux_remise_volume:p.volume_rate,montant_remise_volume:fmt(base.times(p.volume_rate).div(100).toString()),taux_remise_delai:p.delay_rate,montant_remise_delai:fmt(base.times(p.delay_rate).div(100).toString()),montant_net_ht:fmt(p.net),taux_tva:p.vat_rate,montant_tva:fmt(p.vat),montant_ttc:fmt(p.total),delai_livraison:`${p.lead_weeks} semaines à compter de la commande, sous confirmation de disponibilité.`,remarques:'Offre de démonstration Catalya. Transport facturé au réel. Tarif '+p.tariff_version+'.'});
 const xml=new XMLSerializer().serializeToString(doc);if(xml.includes('{{'))throw new AppError('Variable non remplie dans le devis.');zip.file('word/document.xml',xml);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
export async function document(id:number,version:number){
 const p=revision(id);if(p.version!==version||!['approuve','devis_genere'].includes(p.status))throw new AppError('Validez la version courante avant génération.',409);
 const number=`CAT-DEMO-${String(id).padStart(4,'0')}-V${version}`,db=database();
 if(p.status!=='devis_genere'||!db.prepare('SELECT 1 FROM documents WHERE request_id=? AND version=?').get(id,version)){
  const buffer=await generateBuffer(p,number);db.exec('BEGIN IMMEDIATE');try{
   const latest=revision(id);if(latest.version!==version||!['approuve','devis_genere'].includes(latest.status))throw new AppError('Le dossier a changé pendant la génération. Rechargez-le.',409);
   db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?)').run(id,version,buffer.toString('base64'));
   db.prepare('UPDATE revisions SET status=? WHERE request_id=? AND version=?').run('devis_genere',id,version);
   event(id,version,'generation',p.approver!,{number,date:new Date().toISOString().slice(0,10)});db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {url:`/api/requests/${id}/download?version=${version}`,number,quote:{...revision(id),events:events(id)}};
}
export function download(id:number,version:number){
 const p=revision(id,version);if(p.status!=='devis_genere')throw new AppError('Document non généré pour cette version.',409);
 const row=database().prepare('SELECT content FROM documents WHERE request_id=? AND version=?').get(id,version);
 if(!row)throw new AppError('Document absent. Relancez la génération.',404);
 return {buffer:Buffer.from(String(row.content),'base64'),name:`CAT-DEMO-${String(id).padStart(4,'0')}-V${version}.docx`};
}

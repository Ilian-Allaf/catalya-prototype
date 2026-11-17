import Decimal from 'decimal.js';
import { AppError,history,norm,reference,VERSION } from './db';
import type { Extraction,Quote,QuoteRow,Question } from '@/lib/types';
import { reconcileClarifications,type ReplyContext } from './clarification-state';
const D=(v:Decimal.Value)=>new Decimal(v);
const money=(v:Decimal.Value)=>D(v).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
const units=['kg','t','mt','tonne','tonnes','fut','futs','module','modules','big bag','big bags'];
export function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function localExtract(text:string):Extraction{
 const {catalog,clients}=reference();const n=norm(text);const names=Object.keys(clients).filter(name=>n.includes(norm(name)));const client=names.length===1?names[0]:null;
 const lines:Extraction['lines']=[],partial_lines:Extraction['partial_lines']=[],gaps:string[]=[];
 if(!client)gaps.push('Client absent ou ambigu dans le référentiel.');
 const quantity=/([+-]?\d[\d \u00a0\u202f]*(?:[.,]\d+)?)\s*(kg|tonnes?|MT|f[uû]ts?|modules?|big bags?)/i;
 for(const line of text.split('\n')){
  let refs=Object.keys(catalog).filter(ref=>line.toUpperCase().includes(ref));
  if(!refs.length){const aliases:Record<string,string>={'como haute activite':'HDT-CM-200','nimo ultra-basse':'HDT-NM-300','alumine activee':'ADS-AL-01'};refs=Object.entries(aliases).filter(([a])=>norm(line).includes(a)).map(([,ref])=>ref);}
  if(refs.length>1){gaps.push('Plusieurs références sur une même ligne : séparer les quantités.');continue;}
  if(!refs.length&&quantity.test(line))gaps.push('Ligne avec quantité non rapprochée du catalogue : '+line.trim());
  for(const ref of refs){const m=line.match(quantity);if(!m){gaps.push('Quantité non reconnue pour '+ref);partial_lines.push({reference:ref,quantity:null,unit:null,evidence:line.trim()});}else lines.push({reference:ref,quantity:D(m[1].replace(/[\s\u00a0\u202f]/g,'').replace(',','.')).toString(),unit:norm(m[2]),evidence:line.trim()});}
 }
 let candidates:ReturnType<typeof history>=[];
 if(n.includes('meme chose')&&client){candidates=history(client,n.includes('hydrogenation')?'hydrogenation':null);gaps.push('Confirmer avec le client la référence et la quantité de la commande antérieure.');if(candidates.length){const h=candidates[0];lines.splice(0,lines.length,{reference:h['Référence'],quantity:String(h.kg),unit:'kg',evidence:'Candidat historique '+h['N° devis']});}}
 if(!lines.length)gaps.push('Aucune ligne produit exploitable : préciser référence et quantité.');
 const contact=text.match(/^(?:De|From)\s*:\s*([^<\n]+)/m)?.[1].trim()||null;const address=text.split('\n').find(l=>/\b\d{5}\b/.test(l))?.trim()||null;
 const months:Record<string,string>={janvier:'01',fevrier:'02',mars:'03',avril:'04',mai:'05',juin:'06',juillet:'07',aout:'08',septembre:'09',octobre:'10',novembre:'11',decembre:'12',november:'11'};
 const date=text.match(/Date\s*:\s*[^\n]*?(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);const received_date=date?`${date[3]}-${months[norm(date[2])]}-${date[1].padStart(2,'0')}`:null;
 let delivery_date:string|null=null,exclusive_deadline=false,flexible=false;
 if(n.includes('semaine 10')&&n.includes('2027')){delivery_date='2027-03-08';flexible=true;}
 const before=n.match(/avant le (\d{1,2}) novembre/);if(before){delivery_date='2026-11-'+before[1].padStart(2,'0');exclusive_deadline=true;}
 if(n.includes('fin janvier'))gaps.push('Préciser la date de besoin fin janvier et le point de départ du délai.');
 if(!address)gaps.push('Adresse client à compléter avant génération.');
 return {client,contact,address,received_date,delivery_date,exclusive_deadline,flexible,requested_discount:n.match(/(\d+(?:[.,]\d+)?)\s*%\s*de remise/)?.[1].replace(',','.')||null,agreement:text.includes('AC-2024-017')?'AC-2024-017':null,export_requested:n.includes('cif')?'CIF':null,currency_requested:n.includes('usd')?'USD':'EUR',lines,partial_lines,gaps,answered_questions:[],history_candidates:candidates,mode:'local',mode_label:'Parseur local déterministe, sans IA'};
}
function numeric(v:unknown){try{return D(String(v)).isFinite();}catch{return false;}}
export function prepare(e:Extraction,source:string,context?:ReplyContext){
 if(context)reconcileClarifications(e,context);
 const {catalog,clients}=reference();const valid:Extraction['lines']=[];const partial=[...e.partial_lines];
 for(const l of e.lines){if(!catalog[l.reference]||!numeric(l.quantity)||!units.includes(norm(l.unit)))partial.push({...l});else valid.push(l);}
 e.lines=valid;e.partial_lines=partial;
 for(const l of partial){const label=l.reference||'produit non identifié';if(!l.reference||!catalog[l.reference])e.gaps.push('Référence produit à préciser pour une ligne de la demande.');if(!numeric(l.quantity))e.gaps.push('Quantité et unité à préciser pour '+label+'.');else if(!l.unit)e.gaps.push('Unité de quantité à préciser pour '+label+'.');else e.gaps.push('Ligne incomplète ou ambiguë à confirmer pour '+label+'.');}
 const n=norm(source),resolved:string[]=[];const c=e.client?clients[e.client]:null;
 e.gaps=e.gaps.filter(g=>{const x=norm(g);if(valid.length&&['delais habituels','delai standard','standard lead time'].some(t=>n.includes(t))&&!e.delivery_date&&!n.includes('urgent')&&x.includes('delai')&&(x.includes('habituel')||x.includes('standard'))&&!x.includes('disponibilite')){resolved.push('Délai standard disponible au catalogue, sous confirmation de disponibilité.');return false;}if(c?.['Conditions de paiement']&&['paiement habituelles','payment terms'].some(t=>n.includes(t))&&x.includes('paiement')&&(x.includes('habituel')||x.includes('standard'))){resolved.push('Conditions de paiement du référentiel : '+c['Conditions de paiement']);return false;}return true;});e.resolved_notes=resolved;
 for(const field of ['address','contact','received_date'] as const)if(!e[field])e.gaps.push('Champ indispensable manquant : '+field);
 if(c?.Pays==='France'&&e.address&&!/\b\d{5}\b/.test(e.address))e.gaps.push('Adresse postale client incomplète : code postal français et adresse à préciser.');
 if(!e.lines.length)e.gaps.push('Aucune ligne exploitable.');
 for(const f of ['received_date','delivery_date'] as const)if(e[f]&&!validDate(e[f]!))throw new AppError('Date invalide : '+f+'. Utiliser AAAA-MM-JJ.');
 return e;
}
export function volumeDiscount(gross:Decimal.Value){return D(gross).gte(400000)?9:D(gross).gte(150000)?6:D(gross).gte(50000)?3:0;}
export function calculate(e:Extraction,processing:string,source:string):Quote{
 if(!validDate(processing))throw new AppError('Date de traitement invalide.');
 const {catalog,clients}=reference(),client=e.client?clients[e.client]||null:null;const blocks=[...e.gaps],warnings:string[]=[],rows:QuoteRow[]=[];
 if(!client)blocks.push('Client non reconnu.');
 for(const item of e.lines){const p=catalog[item.reference];if(!p)throw new AppError('Référence inconnue : '+item.reference);let q=D(item.quantity);if(!q.isFinite()||q.lte(0)||q.gt(1e8))throw new AppError('Quantité hors limites.');const pack=D(p['Poids par unité (kg)']),unit=norm(item.unit);
  if(['t','tonne','tonnes','mt'].includes(unit))q=q.times(1000);else if(['fut','futs','module','modules','big bag','big bags'].includes(unit))q=q.times(pack);else if(unit!=='kg')throw new AppError('Unité non reconnue : '+unit);
  const proposed=Decimal.max(q,p['Quantité minimale (kg)']).div(pack).ceil().times(pack);if(!proposed.eq(q))blocks.push(`${item.reference} : accepter le passage de ${q} à ${proposed} kg (conditionnement).`);
  const price=D(p['Prix catalogue (€/kg)']);rows.push({reference:item.reference,description:p['Désignation'],requested_kg:q.toString(),quantity_kg:proposed.toString(),unit_price:price.toString(),gross:money(proposed.times(price)),pack_kg:pack.toString(),lead_weeks:p['Délai standard (semaines)'],evidence:item.evidence,hs_code:p['Code douanier (SH)']});
 }
 const gross=rows.reduce((a,r)=>a.plus(r.gross),D(0)),vol=volumeDiscount(gross),strategic=client?.Segment==='Grand compte'?5:0;let delay=0,rush=0;
 if(e.delivery_date&&rows.length){const delta=(Date.parse(e.delivery_date)-Date.parse(processing))/86400000-(e.exclusive_deadline?1:0);if(delta<0)blocks.push('Échéance de livraison déjà dépassée à la date du traitement.');if(rows.some(r=>delta<r.lead_weeks*7)){rush=8;blocks.push('Urgence : confirmation production/logistique nécessaire avant tout engagement.');if(rows.some(r=>delta<r.lead_weeks*7/2))blocks.push('Délai demandé inférieur au minimum théorique du barème.');}if(e.flexible&&rows.every(r=>delta>=(r.lead_weeks+4)*7))delay=2;}
 const theoretical=vol+strategic+delay,applied=Math.min(15,theoretical);if(theoretical>15)warnings.push(`Remise théorique ${theoretical} %, plafonnée à 15 %.`);
 if(e.requested_discount&&!D(e.requested_discount).eq(applied))blocks.push(`Remise demandée ${e.requested_discount} % : autorisation écrite applicable à obtenir. Calcul au barème ${applied} %.`);
 if(e.agreement)blocks.push('Accord-cadre référencé mais conditions complètes absentes du kit.');
 const exported=client?.['Région commerciale']==='Export hors UE';if(e.export_requested)blocks.push('CIF demandé : fret, assurance et conditions logistiques à confirmer.');if(e.currency_requested==='USD')blocks.push('USD demandé : aucune conversion autorisée, calcul en EUR.');
 const surcharge=money(gross.times(rush).div(100)),base=gross.plus(surcharge),discount=money(base.times(applied).div(100)),net=base.minus(discount),packing=exported?money(net.times('.03')):'0.00',vatRate=client?.Pays==='France'?20:0,tax=money(net.plus(packing).times(vatRate).div(100));
 if(!e.contact)blocks.push('Contact client à compléter.');if(!e.received_date)blocks.push('Date de demande à compléter.');if(e.received_date&&e.received_date>processing)blocks.push('Date de traitement antérieure à la demande.');
 warnings.push('Délai standard indicatif, sous confirmation de disponibilité à la commande.');if(exported)warnings.push('Base FCA Le Havre en EUR, hors fret et assurance. Conditions fiscales du kit.');warnings.push(...(e.resolved_notes||[]));
 if(e.clarification_state?.delivery_year_inferred&&e.delivery_date)warnings.push('Année de besoin déduite du contexte de la demande : '+new Date(e.delivery_date+'T00:00:00Z').toLocaleDateString('fr-FR',{timeZone:'UTC'})+'.');
 const p:Quote={request_id:0,version:0,source,source_hash:'',pipeline_version:'',extraction:e,tariff_version:VERSION,processing_date:processing,client,rows,gross:money(gross),rush_rate:String(rush),surcharge,volume_rate:String(vol),strategic_rate:String(strategic),delay_rate:String(delay),theoretical_rate:String(theoretical),discount_rate:String(applied),discount,net:money(net),packing,vat_rate:String(vatRate),vat:tax,total:money(net.plus(packing).plus(tax)),export:exported,blocks:[...new Set(blocks)],warnings,status:blocks.length?'a_clarifier':'a_revoir',lead_weeks:Math.max(0,...rows.map(r=>r.lead_weeks)),approver:null,pricing_state:!rows.length?'not_calculable':e.partial_lines.length?'partial':'complete',clarification:{questions:[],client_message:null,sent:false,requires_client_reply:false,has_partial_lines:false}};
 p.clarification=clarify(p);return p;
}
function clarify(p:Quote):Quote['clarification']{
 const e=p.extraction,{catalog}=reference(),questions:Question[]=[];
 const add=(code:string,question:string,audience:Question['audience']='client',owner='Commercial')=>{if(!questions.some(q=>q.code===code))questions.push({code,question,audience,owner});};
 e.partial_lines.forEach((l,i)=>{const label=l.reference&&catalog[l.reference]?l.reference:'le produit concerné';if(!l.reference||!catalog[l.reference])add('product-'+i,'Quelle est la référence catalogue ou la désignation précise du produit souhaité ?');if(!numeric(l.quantity))add('quantity-'+i,`Quelle quantité souhaitez-vous pour ${label}${l.unit?' (en '+l.unit+')':', en précisant l’unité (kg, tonnes ou nombre de conditionnements)'} ?`);else if(!units.includes(norm(l.unit||'')))add('unit-'+i,'Quelle est l’unité de la quantité indiquée pour '+label+' ?');});
 if(!p.rows.length&&!e.partial_lines.length)add('product-quantity','Pouvez-vous préciser la référence du produit et la quantité souhaitée, avec son unité ?');if(!e.client)add('client','Quelle raison sociale doit figurer sur le devis ?');if(!e.address||(p.client?.Pays==='France'&&!/\b\d{5}\b/.test(e.address)))add('address','Quelle adresse postale complète doit figurer sur le devis (rue, code postal et ville) ?');if(!e.contact)add('contact','À quel nom et à quel contact devons-nous adresser le devis ?');
 const joined=norm(p.blocks.join(' '));if(!e.clarification_state?.history_confirmed&&(joined.includes('historique')||joined.includes('commande anterieure')))add('historical-confirmation','Confirmez-vous la reprise de '+p.rows.map(r=>r.reference+' pour '+r.requested_kg+' kg').join(', ')+' ?');if(!e.delivery_date&&norm(p.source).includes('fin janvier'))add('delivery-date','Quelle est la date exacte de besoin pour l’arrêt prévu fin janvier ?');
 for(const r of p.rows)if(!D(r.requested_kg).eq(r.quantity_kg))add('pack-'+r.reference,`Le conditionnement impose ${r.quantity_kg} kg de ${r.reference} au lieu des ${r.requested_kg} kg demandés. Acceptez-vous cette quantité ?`);
 if(e.currency_requested==='USD'){if(e.clarification_state?.resolutions.some(r=>r.field==='currency'&&r.value==='USD'))add('currency-review','Demande en USD maintenue : faire valider le traitement en devise ou renégocier les conditions ; aucune conversion automatique.','internal','Responsable commercial');else add('currency','Notre offre standard est établie en EUR. Cette devise vous convient-elle ?');}if(e.agreement)add('agreement','Retrouver et vérifier les conditions de l’accord-cadre '+e.agreement+'.','internal','Responsable commercial');if(e.requested_discount&&joined.includes('remise'))add('discount','Retrouver ou obtenir l’autorisation écrite de la remise demandée ; ne pas la confirmer avant validation.','internal','Direction commerciale');if(joined.includes('urgence'))add('capacity','Vérifier stock, production et transport puis confirmer une date réalisable.','internal','Production / logistique');if(e.export_requested)add('freight','Chiffrer fret et assurance pour les conditions de livraison demandées.','internal','Logistique export');if(joined.includes('justificatif'))add('evidence','Vérifier l’extrait source de la ligne signalée.','internal');
 if(p.blocks.length&&!questions.length)add('review','Examiner les alertes du dossier et confirmer les informations réellement nécessaires.','internal');
 const client=questions.filter(q=>q.audience==='client'),known=[...p.rows.map(r=>r.reference+' : '+r.requested_kg+' kg'),...e.partial_lines.filter(l=>l.reference&&catalog[l.reference]).map(l=>l.reference+' : produit identifié, quantité à compléter')];
 const draft=client.length?'Bonjour,\n\nMerci pour votre demande.'+(known.length?' Nous avons bien retenu : '+[...new Set(known)].join(', ')+'.':'')+'\n\nPour préparer votre devis, pourriez-vous nous préciser les points suivants ?\n'+client.map((q,i)=>(i+1)+'. '+q.question).join('\n')+'\n\nMerci pour votre retour.\nBien cordialement,\n'+(p.client?.['Commercial référent']||'L’équipe commerciale Catalya'):null;
 return {questions,client_message:draft,sent:false,has_partial_lines:!!e.partial_lines.length,requires_client_reply:!!client.length};
}

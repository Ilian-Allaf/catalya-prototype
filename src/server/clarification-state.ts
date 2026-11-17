import Decimal from 'decimal.js';
import { norm,reference } from './db';
import type { Extraction,Question } from '@/lib/types';

export type ReplyContext={replies:string[];originalText:string;processingDate:string;questions?:Question[];previousState?:Extraction['clarification_state']};
const months:Record<string,number>={janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12};
const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const uncertain=(s:string)=>/\b(?:non|pas confirme|pas confirmees|pas certain|pas sur|peut etre|eventuellement|sous reserve|a confirmer)\b|\b(?:confirme|confirmons|valide|validons|souhaite|reprends)\s+(?:pas|plus)\b|\bne\b[^.!;\n]*\b(?:pas|plus)\b|\bn['’][^.!;\n]*\b(?:pas|plus)\b|\bou\b|\?/.test(norm(s));

/** Only real user turns supplied by the server are replies. Email text cannot forge them. */
export function replyLines(replies:string[]):Extraction['lines']{
 const {catalog}=reference();const result=new Map<string,Extraction['lines'][number]>();
 for(const reply of replies){
  const refs=Object.keys(catalog).filter(ref=>reply.toUpperCase().includes(ref));
  // Do not retain an earlier confirmation after a later rejection or uncertainty.
  if(uncertain(reply)){for(const ref of refs)result.delete(ref);if(!refs.length&&/reference|quantite|reprise|commande/.test(norm(reply)))result.clear();continue;}
  for(const clause of reply.split(/[;\n]/)){
   const matches=refs.filter(ref=>clause.toUpperCase().includes(ref));if(matches.length!==1)continue;
   const amounts=[...clause.matchAll(/([+-]?\d[\d \u00a0\u202f]*(?:[.,]\d+)?)\s*(kg|tonnes?|MT|f[uû]ts?|modules?|big bags?)\b/gi)];if(amounts.length!==1)continue;
   const m=amounts[0];const q=new Decimal(m[1].replace(/[\s\u00a0\u202f]/g,'').replace(',','.'));
   if(!q.isFinite()||q.lte(0)||q.gt(1e8))continue;
   result.set(matches[0],{reference:matches[0],quantity:q.toString(),unit:norm(m[2]),evidence:clause.trim()});
  }
 }
 return [...result.values()];
}

function datesIn(text:string,anchor:string){
 const n=norm(text);const values:{date:string;evidence:string;inferred:boolean}[]=[];
 const year=Number(anchor.slice(0,4));
 const add=(day:number,month:number,explicitYear:number|undefined,evidence:string)=>{
  let y=explicitYear??year;let date=`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  if(explicitYear===undefined&&valid(date)&&date<anchor){y++;date=`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
  if(valid(date))values.push({date,evidence,inferred:explicitYear===undefined});
 };
 for(const m of n.matchAll(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/g))add(Number(m[1]),months[m[2]],m[3]?Number(m[3]):undefined,m[0]);
 for(const m of n.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))add(Number(m[3]),Number(m[2]),Number(m[1]),m[0]);
 for(const m of n.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g))add(Number(m[1]),Number(m[2]),m[3]?Number(m[3]):undefined,m[0]);
 for(const m of n.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g))add(Number(m[1]),Number(m[2]),Number(m[3]),m[0]);
 return [...new Map(values.map(v=>[v.date,v])).values()];
}

export function reconcileClarifications(e:Extraction,context:ReplyContext){
 const original=norm(context.originalText),historical=original.includes('meme chose');
 const facts=replyLines(context.replies);
 const historyConfirmed=historical&&facts.length>0;
 if(historyConfirmed){e.lines=facts;e.partial_lines=[];}
 // Anchor an omitted year on the original request, not the date of a later retry.
 const anchor=e.received_date&&valid(e.received_date)?e.received_date:context.processingDate;
 let supplied:{date:string;evidence:string;inferred:boolean}|undefined;
 let dateUncertain=false;
 for(const reply of context.replies){const dates=datesIn(reply,anchor);if(!dates.length){if(/date|livraison|besoin/.test(norm(reply))&&uncertain(reply)){supplied=undefined;dateUncertain=true;}continue;}if(dates.length!==1||uncertain(reply)){supplied=undefined;dateUncertain=true;}else{supplied=dates[0];dateUncertain=false;}}
 if(supplied){e.delivery_date=supplied.date;e.exclusive_deadline=false;}
 if(dateUncertain){e.delivery_date=null;e.gaps.push('Préciser une date de besoin unique et confirmée.');}
 // A vague original date cannot become precise solely because the model guessed.
 const vagueJanuary=original.includes('fin janvier');
 if(vagueJanuary&&!supplied&&!datesIn(context.originalText.replace(/^Date\s*:[^\n]*$/gmi,''),anchor).length)e.delivery_date=null;
 const dateResolved=!!e.delivery_date&&valid(e.delivery_date);
 if(vagueJanuary&&!dateResolved)e.gaps.push('Préciser la date exacte de besoin fin janvier.');
 const priorCurrency=context.previousState?.resolutions.find(r=>r.field==='currency');
 let currencyDecision=priorCurrency;
 const canAnswerCurrency=!!priorCurrency||!!context.questions?.some(q=>q.code==='currency'&&q.audience==='client');
 const answers=[...e.answered_questions];
 // The explicit local mode supports a small, transparent set of literal replies.
 if(e.mode==='local'&&canAnswerCurrency)context.replies.forEach((reply,reply_index)=>{
  const n=norm(reply),mentions=/\b(?:eur|euro|euros)\b/.test(n),onlyCurrency=context.questions?.filter(q=>q.audience==='client').length===1&&context.questions?.find(q=>q.audience==='client')?.code==='currency';
  if(mentions||onlyCurrency&&/^(oui|non|d['’]accord|ok)[.! ]*$/.test(n)){
   if(/\bnon\b|\bpas\b|\brefuse|\bplus\b/.test(n))answers.push({code:'currency',outcome:'retracted',value:null,evidence:reply,reply_index});
   else if(!uncertain(reply)&&/convient|accepte|accord|\boui\b|\bok\b|fine|works/.test(n))answers.push({code:'currency',outcome:'confirmed',value:'EUR',evidence:reply,reply_index});
  }
 });
 for(const answer of answers.sort((a,b)=>a.reply_index-b.reply_index)){
  const reply=context.replies[answer.reply_index];
  if(!canAnswerCurrency||answer.code!=='currency'||!answer.evidence.trim()||reply?.trim()!==answer.evidence.trim())continue;
  if(answer.reply_index<(currencyDecision?.reply_index??-1))continue;
  if(answer.outcome==='confirmed'&&answer.value==='EUR')currencyDecision={field:'currency',value:'EUR',evidence:answer.evidence,reply_index:answer.reply_index};
  else if(answer.outcome==='retracted')currencyDecision={field:'currency',value:'USD',evidence:answer.evidence,reply_index:answer.reply_index};
 }
 const currency=currencyDecision?.value==='EUR'?currencyDecision:undefined;
 if(currency)e.currency_requested='EUR';
 else if(canAnswerCurrency&&norm(context.originalText).includes('usd'))e.currency_requested='USD';
 e.gaps=e.gaps.filter(g=>{
  const n=norm(g);
  const commercial=/remise|tarif|prix|accord|contrat|autorisation/.test(n);
  if(historyConfirmed&&!commercial&&/histori|commande (?:anterieure|precedente)|reference.*quantite.*confirm|confirm.*(?:reprise|reference|quantite)/.test(n))return false;
  if(dateResolved&&/date|fin janvier|annee/.test(n)&&/precis|confirm|exact|manquan|absen|ambigu|flou|besoin/.test(n)&&!/stock|production|faisabilite|transport|autorisation/.test(n))return false;
  if(currency&&/devise|\beur\b|euro|\busd\b/.test(n)&&!/fret|assurance|cif|stock|accord|contrat|autorisation/.test(n))return false;
  return true;
 });
 e.clarification_state={history_confirmed:historyConfirmed,delivery_date_resolved:dateResolved,delivery_year_inferred:!!supplied?.inferred,currency_confirmed:!!currency,resolutions:[...(historyConfirmed?facts.map(f=>({field:'historical_line',value:f.reference+' '+f.quantity+' '+f.unit,evidence:f.evidence})):[]),...(supplied?[{field:'delivery_date',value:supplied.date,evidence:supplied.evidence}]:[]),...(currencyDecision?[currencyDecision]:[])]};
 return e;
}

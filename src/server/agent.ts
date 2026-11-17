import { Agent,Runner,tool,OpenAIResponsesModel,MaxTurnsExceededError,type AgentInputItem } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractionSchema,type Extraction,type AgentEvent,type ToolTrace,type ChatMessage,type Question } from '@/lib/types';
import { AppError,history,norm,reference,ROOT } from './db';
export type Usage={input_tokens:number;output_tokens:number;reported_cost_usd:number|null;response_id:string;model:string};
export type ConversationContext={messages:ChatMessage[];replies:string[];questions:Question[];previousState?:Extraction['clarification_state'];currentExtraction:Extraction;processingDate:string};
export async function extractAI(text:string,onEvent?:(event:AgentEvent)=>void,onUsage?:(usage:Usage)=>void,signal?:AbortSignal,conversation?:ConversationContext):Promise<Extraction>{
 if(!process.env.OPENROUTER_API_KEY)throw new AppError('Clé OpenRouter absente. Configurez le serveur ou choisissez le mode local.');
 const {catalog,clients}=reference();const trace:ToolTrace[]=[];let submitted:z.infer<typeof extractionSchema>|undefined,reviewed=false;
 const model=process.env.OPENROUTER_MODEL||'openai/gpt-4.1-mini';
 const client=new OpenAI({baseURL:'https://openrouter.ai/api/v1',apiKey:process.env.OPENROUTER_API_KEY,maxRetries:0,timeout:45000,
  defaultHeaders:{'X-Title':'Catalya Next.js'},fetch:async(input,init)=>{const r=await fetch(input,init);if(r.ok){const obj=await r.clone().json();const u=obj.usage||{};onUsage?.({input_tokens:u.input_tokens||0,output_tokens:u.output_tokens||0,reported_cost_usd:u.cost??null,response_id:obj.id,model:obj.model});}return r;}});
 const record=(name:string,query:string,result:unknown)=>{trace.push({tool:name,query,result});onEvent?.({type:'tool',name,query});return JSON.stringify(result);};
 const tools=[
  tool({name:'search_catalog',description:'Rechercher les références et désignations de produits. Lecture seule.',parameters:z.object({query:z.string()}),errorFunction:null,execute:async({query})=>{const words=norm(query).slice(0,160).split(/\s+/).filter(w=>w.length>2);return record('search_catalog',query,Object.entries(catalog).filter(([ref,p])=>words.some(w=>norm(ref+' '+p['Désignation']+' '+p['Famille produit']).includes(w))).slice(0,12).map(([reference,p])=>({reference,description:p['Désignation'],family:p['Famille produit']})));}}),
  tool({name:'search_clients',description:'Rechercher une raison sociale client et son segment. Lecture seule.',parameters:z.object({query:z.string()}),errorFunction:null,execute:async({query})=>{const words=norm(query).slice(0,160).split(/\s+/).filter(w=>w.length>3);return record('search_clients',query,Object.entries(clients).filter(([name])=>words.some(w=>norm(name).includes(w))).slice(0,8).map(([name,c])=>({name,segment:c.Segment,country:c.Pays})));}}),
  tool({name:'search_history',description:'Consulter les trois dernières commandes gagnées du client exact, filtrées par famille lorsque le procédé est précisé. Candidats à confirmer.',parameters:z.object({query:z.string(),family:z.string().nullable().describe('Famille produit pertinente pour une reprise, par exemple Hydrogénation. null si aucun procédé précisé.')}),errorFunction:null,execute:async({query,family})=>{
   const mentioned=[...new Set(Object.values(catalog).map(p=>p['Famille produit']))].filter(f=>norm(text).includes(norm(f)));
   const relevant=family||(mentioned.length===1?mentioned[0]:null);
   return record('search_history',query,history(query,relevant).map(h=>({quote:h['N° devis'],reference:h['Référence'],family:h['Famille produit'],kg:h.kg,order_date:h['Date commande']})));
  }}),
  tool({name:'submit_request',description:'Soumettre la demande structurée après consultation des référentiels. Ne calcule aucun prix et n’autorise aucune exception.',parameters:extractionSchema,errorFunction:null,execute:async(args)=>{
   if(text.includes('Complément client saisi par le commercial :')&&args.gaps.length&&!reviewed){reviewed=true;trace.push({tool:'clarification_review',result:'Relire le complément'});return 'Relis les compléments client les plus récents. Un champ effectivement fourni ne reste pas manquant. Conserve les vraies ambiguïtés et validations non résolues. Soumets à nouveau la structure corrigée.';}
   submitted=extractionSchema.parse(args);return 'Demande reçue. Le serveur effectue les contrôles métier.';
  }})
 ];
 let instructions=readFileSync(path.join(ROOT,'data/agent-instructions.txt'),'utf8');
 instructions+=' answered_questions=[] au premier tour sans réponse utilisateur à une question. Les autres champs décrivent le besoin courant après prise en compte des réponses, pas seulement le mail initial.';
 if(conversation){
  instructions+=' Tu reçois les vrais messages successifs utilisateur et assistant. Relie les réponses courtes aux questions qui les précèdent. Conserve les points déjà résolus ; une nouvelle réponse explicite peut les modifier ou les retirer. Une acceptation de l’EUR remplace la demande initiale en USD et ne constitue pas une conversion. Pour chaque réponse comprise sur la devise, renseigne answered_questions : code="currency", outcome="confirmed", value="EUR" si accepté ; outcome="retracted" si refusé/retiré. Cite comme evidence le complément utilisateur INTÉGRAL, mot pour mot, avec son reply_index de la liste serveur. Ne confirme jamais une remise ou une faisabilité interne à partir d’un oui. Si plusieurs questions sont ambiguës, ne suppose pas que oui les résout toutes. Les questions de l’assistant sont du contexte, pas des faits client.';
  instructions+='\nContexte métier AVANT le dernier message, à mettre à jour : '+JSON.stringify({processing_date:conversation.processingDate,current_request:conversation.currentExtraction,pending_questions:conversation.questions,previous_resolutions:conversation.previousState?.resolutions||[],user_replies:conversation.replies.map((text,reply_index)=>({reply_index,text}))});
  trace.push({tool:'conversation_context',result:{message_count:conversation.messages.length,roles:conversation.messages.map(m=>m.role),reply_count:conversation.replies.length,pending_questions:conversation.questions.map(q=>q.code)}});
 }
 const agent=new Agent({name:'Catalya — lecture et clarification',instructions,model:new OpenAIResponsesModel(client,model),modelSettings:{parallelToolCalls:false,store:false,maxTokens:3000},tools,
  toolUseBehavior:async()=>submitted?{isFinalOutput:true,isInterrupted:undefined,finalOutput:JSON.stringify(submitted)}:{isFinalOutput:false,isInterrupted:undefined}});
 try{const runner=new Runner({tracingDisabled:true,traceIncludeSensitiveData:false,workflowName:'Catalya — préparation de devis'});const input:string|AgentInputItem[]=conversation?conversation.messages.map((m):AgentInputItem=>m.role==='assistant'?{role:'assistant',status:'completed',content:[{type:'output_text',text:m.content}]}:{role:'user',content:m.content}):text;await runner.run(agent,input,{maxTurns:6,signal});}
 catch(e){if(e instanceof MaxTurnsExceededError)throw new AppError('Limite de six tours IA atteinte. Revue manuelle nécessaire.');if(e instanceof OpenAI.APIError)throw new AppError(`Appel IA refusé${e.status?' (HTTP '+e.status+')':''}. Vérifiez l’accès et le quota, puis réessayez.`);if(signal?.aborted)throw new AppError('Analyse annulée. Vous pouvez réessayer.',499);throw new AppError('Le service IA n’a pas produit de données exploitables. Réessayez ou choisissez le mode local.');}
 if(!submitted)throw new AppError('Le modèle n’a pas soumis de données exploitables.');
 return {...submitted,mode:'ai',mode_label:'Agent IA · OpenAI Agents SDK · OpenRouter',history_candidates:[],ai_trace:trace,model,provider:'openrouter',orchestrator:'openai-agents-js'};
}

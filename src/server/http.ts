import { AppError } from './db';
import { ZodError } from 'zod';
export function failure(error:unknown){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status});if(error instanceof ZodError)return Response.json({error:'Données invalides : '+error.issues.map(i=>i.path.join('.')+' '+i.message).join('; ')},{status:422});return Response.json({error:'Opération impossible. Vérifiez les données puis réessayez.'},{status:500});}
export async function body(request:Request){const text=await request.text();if(text.length>60000)throw new AppError('La demande dépasse la taille autorisée.');try{return JSON.parse(text);}catch{throw new AppError('Requête JSON invalide.');}}
export function identifier(value:string){const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw new AppError('Identifiant invalide.',404);return id;}

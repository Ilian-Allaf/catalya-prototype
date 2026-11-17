import { readFileSync } from 'node:fs';import path from 'node:path';import { ROOT } from '@/server/db';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{number:string}>}){const {number}=await params;if(!/^[1-5]$/.test(number))return Response.json({error:'Demande introuvable.'},{status:404});return Response.json({text:readFileSync(path.join(ROOT,`examples/Demande_${number}.txt`),'utf8')});}

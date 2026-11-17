import { runWorkspace } from '@/server/cloud-workspace';
import { z } from 'zod';import { approve } from '@/server/workflow';import { failure,identifier,body } from '@/server/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{return await runWorkspace(request,async()=>{const {version}=z.object({version:z.number().int().positive()}).parse(await body(request));return Response.json(approve(identifier((await params).id),version,'Utilisateur de démonstration'));});}catch(e){return failure(e);}}

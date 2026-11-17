import { runWorkspace } from '@/server/cloud-workspace';
import { z } from 'zod';import { document } from '@/server/documents';import { failure,identifier,body } from '@/server/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{return await runWorkspace(request,async()=>{const {version}=z.object({version:z.number().int().positive()}).parse(await body(request));return Response.json(await document(identifier((await params).id),version));});}catch(e){return failure(e);}}

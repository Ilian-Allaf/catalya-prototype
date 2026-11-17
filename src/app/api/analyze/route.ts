import { runWorkspace } from '@/server/cloud-workspace';
import { analyze } from '@/server/workflow';import { failure,body } from '@/server/http';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){try{return await runWorkspace(request,async()=>{return Response.json(await analyze(await body(request),undefined,undefined,request.signal));});}catch(e){return failure(e);}}

import { runWorkspace } from '@/server/cloud-workspace';
import { list } from '@/server/db';import { failure } from '@/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{return await runWorkspace(request,async()=>{return Response.json(list());});}catch(e){return failure(e);}}

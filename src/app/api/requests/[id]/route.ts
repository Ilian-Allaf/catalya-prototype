import { runWorkspace } from '@/server/cloud-workspace';
import { revision,events,messages } from '@/server/db';import { failure,identifier } from '@/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return await runWorkspace(request,async()=>{const id=identifier((await params).id),p=revision(id);return Response.json({quote:{...p,events:events(id)},messages:messages(id,p.version)});});}catch(e){return failure(e);}}

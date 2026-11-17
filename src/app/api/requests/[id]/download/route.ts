import { runWorkspace } from '@/server/cloud-workspace';
import { download } from '@/server/documents';import { failure,identifier } from '@/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return await runWorkspace(request,async()=>{const version=identifier(new URL(request.url).searchParams.get('version')||'');const d=download(identifier((await params).id),version);return new Response(new Uint8Array(d.buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="${d.name}"`,'Cache-Control':'no-store'}});});}catch(e){return failure(e);}}

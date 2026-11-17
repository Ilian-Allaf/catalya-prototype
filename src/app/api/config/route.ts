import { VERSION } from '@/server/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export function GET(){return Response.json({ai_available:!!process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_MODEL||'openai/gpt-4.1-mini',provider:'openrouter',orchestrator:'openai-agents-js',today:new Date().toISOString().slice(0,10),version:VERSION,local_only:!process.env.VERCEL,public_demo:process.env.VERCEL==='1'||process.env.CATALYA_HOSTED==='1'});}

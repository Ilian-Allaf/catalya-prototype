import { reference,VERSION } from '@/server/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export function GET(){const {catalog,clients}=reference();return Response.json({version:VERSION,products:Object.entries(catalog).map(([reference,p])=>({reference,description:p['Désignation'],family:p['Famille produit'],price:p['Prix catalogue (€/kg)'],pack:p['Poids par unité (kg)'],lead:p['Délai standard (semaines)']})),clients:Object.keys(clients).length});}

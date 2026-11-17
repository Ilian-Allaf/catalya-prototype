import { NextRequest,NextResponse } from 'next/server';
export function proxy(request:NextRequest){
 const response=NextResponse.next();
 if((process.env.VERCEL==='1'||process.env.CATALYA_HOSTED==='1')&&!/^[a-f0-9]{64}$/.test(request.cookies.get('catalya_session')?.value||'')){
  const session=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  response.cookies.set('catalya_session',session,{httpOnly:true,secure:request.nextUrl.protocol==='https:',sameSite:'lax',path:'/',maxAge:7*86400});
 }
 response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/','/api/:path*']};

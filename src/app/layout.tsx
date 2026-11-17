import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';
export const metadata:Metadata={title:'Catalya — Préparation de devis',description:'Préparer, clarifier et vérifier les devis Catalya.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr"><body><TooltipProvider>{children}</TooltipProvider></body></html>;}

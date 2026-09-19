import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Book Reader',description:'Library and audiobook reader'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('whisperbook.theme')==='dark'?'dark':'light'}catch(e){}"}}/></head><body>{children}</body></html>}

import type {Metadata} from 'next';
import {AdminApp} from '@/components/admin/admin-app';

export const metadata:Metadata={title:'Admin · Book Reader',robots:{index:false,follow:false}};
export default function AdminPage(){return <AdminApp/>}

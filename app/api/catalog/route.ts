import {remoteCatalog} from '../../../lib/remote-catalog-server';
export async function GET(){
 return new Response(JSON.stringify(await remoteCatalog()),{headers:{'content-type':'application/json','cache-control':'public, max-age=60'}});
}

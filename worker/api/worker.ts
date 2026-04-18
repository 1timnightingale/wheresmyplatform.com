export interface Env {
  // Binding to the Cloudflare KV namespace we will create
  STATIONS_DATA: KVNamespace;
  FRAME_REDIRECT_URL?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
     try {
       const url = new URL(request.url);

       if (url.pathname === '/api/stations-state') {
         const cachedStationsJson = await env.STATIONS_DATA.get('uk_stations_state');
         
         if (!cachedStationsJson) {
           return new Response(JSON.stringify({ stations: [], error: "No data in KV yet" }), {
             headers: { 'Content-Type': 'application/json' },
             status: 503
           });
         }

         const parsed = JSON.parse(cachedStationsJson);
         const responseObj = Array.isArray(parsed) ? { stations: parsed } : parsed;

         return new Response(JSON.stringify(responseObj), {
           headers: {
             'Content-Type': 'application/json',
             'Cache-Control': 'public, max-age=60',
           },
         });
       }

       if (url.pathname === '/api/config') {
         return new Response(JSON.stringify({ 
           redirectUrl: env.FRAME_REDIRECT_URL
         }), {
           headers: { 'Content-Type': 'application/json' }
         });
       }

       return new Response("Not Found", { status: 404 });
     } catch (e) {
       return new Response("Worker Error: " + (e.message || String(e)), { status: 500 });
     }
  },
};

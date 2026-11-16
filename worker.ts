import * as employees from './app/api/employees/route';
import * as discord from './app/api/discord/route';
import * as workshop from './app/api/workshop/route';
import * as webhook from './app/api/webhook/route';
import { setting } from './lib/workshop-server';
import { defaultCatalogue } from './lib/workshop.mjs';
import { syncDiscord } from './lib/discord-sync';

type Route = Partial<Record<'GET'|'POST',(request:Request)=>Promise<Response>>>;
const routes: Record<string,Route> = {
  '/api/catalogue': {async GET() {
    try {
      const saved=await setting('catalogue');
      return Response.json({catalogue:saved?JSON.parse(saved):defaultCatalogue,starterPrices:!saved});
    } catch {
      return Response.json({error:'Workshop prices are unavailable.'},{status:503});
    }
  }},
  '/api/employees': employees,
  '/api/discord': discord,
  '/api/workshop': workshop,
  '/api/webhook': webhook,
};

export default {
  async fetch(request:Request, env:Cloudflare.Env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const route=Object.hasOwn(routes,url.pathname)?routes[url.pathname]:null;
    if (!route) return Response.json({error:'API endpoint not found.'},{status:404});
    const action=request.method==='GET'?route.GET:request.method==='POST'?route.POST:undefined;
    if (!action) return Response.json({error:'Method not allowed.'},{status:405});
    const response=await action(request);
    response.headers.set('Cache-Control','no-store');
    return response;
  },
  async scheduled() {
    await syncDiscord();
  },
};

import { connectDiscord, discordStatus, DiscordSyncError, requireDiscordOwner, syncDiscord } from '../../../lib/discord-sync';

export const dynamic = 'force-dynamic';
const headers={'Cache-Control':'no-store'};

function failure(error:unknown) {
  if (error instanceof DiscordSyncError) return Response.json({error:error.message},{status:error.status,headers});
  return Response.json({error:'Discord sync could not finish. Try again.'},{status:503,headers});
}

export async function GET(request:Request) {
  try { await requireDiscordOwner(request); return Response.json(await discordStatus(),{headers}); }
  catch (error) {return failure(error);}
}

export async function POST(request:Request) {
  if (request.headers.get('origin')!==new URL(request.url).origin) return Response.json({error:'Open Paradise Customs to set up the Discord bot.'},{status:403,headers});
  try {
    const body=await request.json() as {action?:string;token?:unknown};
    await requireDiscordOwner(request);
    if (body?.action==='connect' && typeof body.token==='string') return Response.json(await connectDiscord(body.token.trim()),{headers});
    if (body?.action==='sync') return Response.json(await syncDiscord(),{headers});
    return Response.json({error:'Invalid request.'},{status:400,headers});
  } catch (error) {return failure(error);}
}

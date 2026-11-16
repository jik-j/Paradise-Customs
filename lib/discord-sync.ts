import { env } from 'cloudflare:workers';
import { employeeSession } from './employee-access';
import { parseEvent } from './workshop.mjs';
import { db, digest, saveSetting, setting } from './workshop-server';

const botId = env.DISCORD_BOT_ID;
const channelId = env.DISCORD_CHANNEL_ID;
const webhookId = env.DISCORD_WEBHOOK_ID;
const shop = (env.DISCORD_SHOP || 'mechanic2').toLowerCase();
const discordBase = 'https://discord.com/api/v10';
const discordUserAgent = 'DiscordBot (https://discord.com, 1.0.0)';
const channelPath = '/channels/' + channelId;
const stateKey = 'discord_sync';

const eventNames: Record<string,string> = {
  'orders: order placed': 'order.created',
  'orders: order marked as fulfilled': 'order.completed',
  'orders: order deleted': 'order.cancelled',
  'duty: status changed': 'duty.status',
  'invoices: invoice sent': 'invoice.created',
  'invoices: invoice paid': 'invoice.paid',
  'shop: item purchased': 'parts.obtained',
  'duty: clocked in': 'duty.started',
  'duty: clocked out': 'duty.ended',
  'duty: went on duty': 'duty.started',
  'duty: went off duty': 'duty.ended',
  'jobs: went on duty': 'duty.started',
  'jobs: went off duty': 'duty.ended',
  'inventory: part used': 'parts.used',
  'shop: item used': 'parts.used',
};
type Embed = {title?: string; timestamp?: string; fields?: {name:string;value:string}[]};
type Message = {id:string; webhook_id?:string; timestamp:string; embeds?:Embed[]; content?:string; attachments?:unknown[]};
type State = {channelId:string; webhookId?:string; guildId:string; channelName:string; encryptedToken:string; cursor:string; imported:number; skipped:number; syncedAt:string|null; parserVersion?:number};

export class DiscordSyncError extends Error {
  constructor(message:string, public status = 400) { super(message); }
}

async function cryptKey() {
  if (!env.DISCORD_STORAGE_KEY) throw new DiscordSyncError('Secure storage is unavailable.', 503);
  const material = new TextEncoder().encode('paradise-discord-token:v1:' + env.DISCORD_STORAGE_KEY);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', material), 'AES-GCM', false, ['encrypt','decrypt']);
}
function base64(bytes:Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function from64(value:string) { return Uint8Array.from(atob(value), char=>char.charCodeAt(0)); }

async function encrypt(token:string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await cryptKey(), new TextEncoder().encode(token));
  return base64(iv) + '.' + base64(new Uint8Array(cipher));
}
async function decrypt(encrypted:string) {
  const [iv,cipher] = encrypted.split('.');
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv)},await cryptKey(),from64(cipher)));
  } catch { throw new DiscordSyncError('Reconnect the bot using its token.', 409); }
}

async function discord<T>(path:string, token:string):Promise<T> {
  const stage = path === '/users/@me' ? 'bot identity' : path.includes('/messages?') ? 'message history' : 'log channel';
  let result:Response;
  try {
    result = await fetch(discordBase + path, {
      headers: {
        Authorization:'Bot '+token,
        Accept:'application/json',
        'User-Agent':discordUserAgent,
      },
      redirect:'manual', signal:AbortSignal.timeout(12000),
    });
  } catch {
    console.warn('Discord API request failed', {stage});
    throw new DiscordSyncError('Paradise Customs could not reach Discord. Try again.',503);
  }
  if (result.ok) return await result.json() as T;
  const failure=await result.json().catch(()=>null) as {code?:number}|null;
  const status=result.status;
  const code=typeof failure?.code==='number'?failure.code:undefined;
  console.warn('Discord API request rejected', {stage,status,code});
  if (status===401 && stage==='bot identity') {
    throw new DiscordSyncError('Discord rejected the token. Copy the Bot Token from the Paradise Customs Logs Bot page and paste it here.',422);
  }
  if (code===10003 || code===50001 || code===50013) {
    throw new DiscordSyncError(stage==='log channel'
      ? 'Discord denied access to the configured log channel. Add Paradise Customs Logs directly to that channel and allow View Channel and Read Message History.'
      : 'Discord denied message history access. Allow Read Message History for Paradise Customs Logs in the configured channel.',422);
  }
  if (status===403 && code==null) {
    throw new DiscordSyncError('Discord blocked the website’s API request before checking the bot’s channel permissions. Changing the Moderator role will not fix this.',502);
  }
  if (status===401) throw new DiscordSyncError('The bot token is no longer valid. Reconnect the bot using its current token.',422);
  if (status===403 || status===404) {
    throw new DiscordSyncError(`Discord rejected the ${stage} check (HTTP ${status}). Verify the linked bot and channel.`,422);
  }
  throw new DiscordSyncError(`Discord could not complete the ${stage} check (HTTP ${status}). Try again.`,503);
}

export async function checkDiscordReachability() {
  try {
    const result=await fetch(discordBase+'/users/@me',{headers:{Accept:'application/json','User-Agent':discordUserAgent},redirect:'manual',signal:AbortSignal.timeout(8000)});
    const failure=await result.json().catch(()=>null) as {code?:number}|null;
    return {status:result.status,discordApiResponded:result.status===401 && typeof failure?.code==='number'};
  } catch {return {discordApiResponded:false};}
}

async function identity(role:string,name:string) {
  const normalized=name.toLowerCase().trim().replace(/\s+/g,' ');
  return 'jg:'+role+':'+(await digest(normalized)).slice(0,32);
}
function cents(value:string) {
  const match = value.replace(/[,\s]/g,'').match(/^([+-]?)\$?([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match || (match[1] && match[2])) throw new Error('Invalid amount');
  const magnitude=Number(match[3])*100+Number((match[4]||'').padEnd(2,'0'));
  return (match[1]||match[2])==='-'?-magnitude:magnitude;
}

export async function mapDiscordEvent(message:Message, embed:Embed, index:number) {
  let type = eventNames[embed.title?.trim().toLowerCase() || ''];
  if (!type) return null;
  const fields = new Map((embed.fields||[]).map(field=>[field.name.replace(/[*:]/g,'').trim().toLowerCase(),field.value.trim()]));
  const mechanic=fields.get('mechanic')??fields.get('business')??fields.get('job');
  if (!mechanic) throw new Error('Missing mechanic');
  if (mechanic.toLowerCase() !== shop) return null;
  if (type==='duty.status') {
    const value=(fields.get('status')??fields.get('new status')??fields.get('duty status')??fields.get('on duty')??fields.get('duty')??'')
      .toLowerCase().replace(/[^a-z0-9]/g,'');
    if (['on','onduty','true','yes','1','clockedin','started'].includes(value)) type='duty.started';
    else if (['off','offduty','false','no','0','clockedout','ended'].includes(value)) type='duty.ended';
    else throw new Error('Unknown duty status');
  }
  function required(name:string) {
    const value=fields.get(name);
    if (!value) throw new Error('Missing '+name);
    return value;
  }
  function reference(name:string) {
    const id=required(name);
    if (!/^\d{1,30}$/.test(id)) throw new Error('Invalid reference');
    return `jg:${channelId}:${shop}:${id}`;
  }
  async function customer(name:string) {return {customerId:await identity('customer',name),customerName:name};}
  const actorName=(value:string)=>value.replace(/\s*\(id:\s*\d+\)\s*$/i,'').trim();
  const player=actorName(required('player'));
  const eventId=`discord:${message.id}:${index}`;
  const common={type,eventId,occurredAt:new Date(embed.timestamp||message.timestamp).toISOString(),
    employeeId:await identity('employee',player),employeeName:player,source:'discord',shop};
  function amount(...aliases:string[]) {
    for (const alias of aliases) {
      const value=fields.get(alias);
      if (!value) continue;
      try {return cents(value);} catch {continue;}
    }
    return undefined;
  }
  const financial={
    profitCents:amount('net profit','society profit','profit earned','profit'),
    costCents:amount('total cost','parts cost','item cost','cost'),
  };
  const assigned=fields.get('assigned mechanic')??fields.get('assigned to')??fields.get('employee');
  const orderId=fields.has('order #')?reference('order #'):undefined;
  switch(type) {
    case 'duty.started':
    case 'duty.ended':
      return {...common,shiftId:eventId,dutyKey:common.employeeId};
    case 'parts.used':
      return {...common,receiptId:eventId,partName:required('item'),quantity:Number(required('quantity'))};
    case 'order.created':
      return {...common,orderId:reference('order #'),vehicle:required('vehicle'),...await customer(player),
        orderPaidCents:amount('paid'),...financial,assigneeName:assigned?actorName(assigned):undefined,paymentMethod:fields.get('payment method')};
    case 'order.cancelled':
      return {...common,orderId:reference('order #')};
    case 'order.completed':
      return {...common,orderId:reference('order #'),commissionCents:amount('commission earned','commission'),...financial};
    case 'invoice.created':
      return {...common,invoiceId:reference('invoice #'),amountCents:cents(required('total')),orderId,...financial,
        ...await customer(actorName(required('recipient'))),breakdown:fields.get('breakdown')?.slice(0,1024)};
    case 'invoice.paid':
      return {...common,invoiceId:reference('invoice #'),amountCents:cents(required('total')),orderId,...financial,
        ...await customer(player),commissionCents:amount('commission','commission earned'),paymentMethod:fields.get('payment method')};
    default:
      return {...common,receiptId:eventId,partName:required('item'),quantity:Number(required('quantity')),
        totalCostCents:cents(required('total cost')),fundSource:required('fund source')};
  }
}

function isWorkshopWebhook(message:Message) {
  return message.webhook_id === webhookId;
}

function status(state:State|null) {
  return state?.channelId===channelId
    ? {connected:true,channelId,webhookId,channelName:state.channelName,channelUrl:`https://discord.com/channels/${state.guildId}/${channelId}`,imported:state.imported,skipped:state.skipped,syncedAt:state.syncedAt}
    : {connected:false,channelId,webhookId};
}
export async function discordStatus() {
  const current=await setting(stateKey);
  return status(current ? JSON.parse(current) as State : null);
}

export async function requireDiscordOwner(request:Request) {
  const account=await employeeSession(request);
  if (!account) throw new DiscordSyncError('Sign in to manage Discord sync.',401);
  if (account.grade!==4) throw new DiscordSyncError('Only a Boss can manage Discord sync.',403);
}

export async function connectDiscord(token:string) {
  if (![botId,channelId,webhookId].every(value=>/^\d{15,22}$/.test(value||''))) {
    throw new DiscordSyncError('Configure the Discord bot, channel, and posting webhook IDs first.',503);
  }
  if (!/^[a-zA-Z0-9_.-]{30,220}$/.test(token)) throw new DiscordSyncError('Paste the bot token from Discord.');
  const bot=await discord<{id:string;bot?:boolean}>('/users/@me',token);
  if (!bot.bot || bot.id !== botId) {
    console.warn('Discord setup rejected', {stage:'bot identity',reason:'different bot'});
    throw new DiscordSyncError('That token belongs to a different Discord bot. Open the linked Paradise Customs Logs Bot page to copy the correct one.',422);
  }
  const channel=await discord<{id:string;guild_id?:string;name?:string}>(channelPath,token);
  if (channel.id!==channelId || !/^\d{15,22}$/.test(channel.guild_id||'')) {
    throw new DiscordSyncError('Discord did not return the configured server channel. Check the DELIVERY-LOGS channel ID.',422);
  }
  const recent=await discord<Message[]>(channelPath+'/messages?limit=100',token);
  const webhookPosts=recent.filter(isWorkshopWebhook);
  if (webhookPosts.length && webhookPosts.every(message=>!message.embeds?.length && !message.content && !message.attachments?.length)) {
    console.warn('Discord setup rejected', {stage:'message history',reason:'embeds hidden'});
    throw new DiscordSyncError('Discord hid the log embeds. Enable Message Content Intent for the bot.',422);
  }
  const current=await setting(stateKey);
  const previous=current?JSON.parse(current) as State:null;
  const state:State={
    channelId,webhookId,guildId:channel.guild_id!,channelName:channel.name||'DELIVERY-LOGS',
    cursor:previous?.channelId===channelId&&previous.webhookId===webhookId?previous.cursor:recent.length===100?(BigInt(recent.at(-1)!.id)-BigInt(1)).toString():'0',
    imported:previous?.channelId===channelId?previous.imported:0,
    skipped:previous?.channelId===channelId?previous.skipped:0,
    syncedAt:previous?.channelId===channelId?previous.syncedAt:null,
    encryptedToken:await encrypt(token),
  };
  await saveSetting(stateKey,JSON.stringify(state));
  return await syncDiscord();
}

export async function syncDiscord() {
  const previous=await setting(stateKey);
  if (!previous) return {...status(null),received:0};
  const state=JSON.parse(previous) as State;
  if (state.channelId!==channelId) return {...status(null),received:0};
  const token=await decrypt(state.encryptedToken);
  const cursor=BigInt(state.cursor);
  const changedWebhook=state.webhookId!==webhookId;
  const pending:Message[]=[];
  const backfill=state.parserVersion!==2 && !changedWebhook;
  let before='';
  let reachedCursor=false;
  for (let page=0;page<8;page++) {
    const messages=await discord<Message[]>(channelPath+'/messages?limit=100'+(before?'&before='+before:''),token);
    pending.push(...messages.filter(message=>changedWebhook || BigInt(message.id)>cursor || (backfill && page<3)));
    if (changedWebhook || messages.length<100 || ((!backfill || page>=2) && messages.some(message=>BigInt(message.id)<=cursor))) {reachedCursor=true;break;}
    before=messages.at(-1)!.id;
  }
  if (!reachedCursor) throw new DiscordSyncError('The Discord backlog is too large for one sync. The saved position has been preserved.',409);
  const database=db();
  const inserts:D1PreparedStatement[]=[];
  const repairs:D1PreparedStatement[]=[];
  let skipped=0;
  const now=Date.now();
  for (const message of pending.reverse()) {
    if (!isWorkshopWebhook(message)) continue;
    if (!message.embeds?.length && !message.content && !message.attachments?.length) {
      throw new DiscordSyncError('Discord hid the log embeds. Check Message Content Intent.',422);
    }
    for (const [index,embed] of (message.embeds||[]).entries()) {
      try {
        const input=await mapDiscordEvent(message,embed,index);
        if (!input) continue;
        const {event,timestamp,entityId}=parseEvent(input);
        inserts.push(database.prepare('INSERT INTO workshop_events (event_id,type,entity_id,occurred_at,received_at,employee_id,payload) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
          .bind(event.eventId,event.type,entityId,timestamp,now,event.employeeId,JSON.stringify(event)));
        if (backfill && BigInt(message.id)<=cursor) {
          repairs.push(database.prepare('UPDATE workshop_events SET payload=? WHERE event_id=? AND type=?')
            .bind(JSON.stringify(event),event.eventId,event.type));
        }
      } catch { skipped++; }
    }
  }
  let received=0;
  for (let i=0;i<inserts.length;i+=75) {
    const results=await database.batch(inserts.slice(i,i+75));
    received+=results.reduce((sum,result)=>sum+(result.meta.changes||0),0);
  }
  for (let i=0;i<repairs.length;i+=75) await database.batch(repairs.slice(i,i+75));
  state.webhookId=webhookId;
  state.parserVersion=2;
  if (pending.length && BigInt(pending.at(-1)!.id)>cursor) state.cursor=pending.at(-1)!.id;
  state.imported+=received;
  state.skipped+=skipped;
  state.syncedAt=new Date(now).toISOString();
  const update=await database.prepare('UPDATE workshop_settings SET value=? WHERE key=? AND value=?').bind(JSON.stringify(state),stateKey,previous).run();
  if (!update.meta.changes) return {...await discordStatus(),received};
  return {...status(state),received};
}

'use client';

import Brand from '../brand';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, BookOpen, Boxes, CarFront, CircleDollarSign, ClipboardList, Clock3, CodeXml, Copy, LayoutDashboard, ListChecks, PlugZap, ReceiptText, RefreshCw, Search, UsersRound, Wrench, X, Plus, Pencil, KeyRound, Menu, ChevronDown } from 'lucide-react';
import { defaultCatalogue, eventFields } from '../../lib/workshop.mjs';

const sections = [
  { label: 'Overview', icon: LayoutDashboard, group: 'WORKSPACE' },
  { label: 'Service Catalogue', icon: BookOpen, group: 'WORKSPACE' },
  { label: 'Employees', icon: UsersRound, group: 'WORKSPACE' },
  { label: 'Customer Orders', icon: ClipboardList, group: 'WORKSPACE' },
  { label: 'Customers', icon: CarFront, group: 'WORKSPACE' },
  { label: 'Game Webhook', icon: PlugZap, group: 'INTEGRATION' },
] as const;
type Page = typeof sections[number]['label'];
type Item = typeof defaultCatalogue[number];
type Event = { type:string; occurredAt:string; eventId:string; employeeId:string; employeeName:string; [key:string]:string|number|undefined };
type Employee = { id:string; name:string; dutyMs:number; active:number; orders:number; invoices:number; parts:number; profit:number; paidRevenue:number; partsSpend:number; uncosted:number; hasDuty:boolean; dutyIssues:number };
type Customer = { id:string; name:string; completed:number; spend:number; orderIds:string[]; lastOrder:string };
type Order = Event & { id:string; status:string };
type DiscordStatus = {connected:boolean; channelId?:string; channelName?:string; channelUrl?:string; webhookId?:string; imported?:number; skipped?:number; syncedAt?:string|null; received?:number; error?:string};
type Workshop = { metrics: Pick<Employee, 'dutyMs'|'orders'|'invoices'|'parts'|'profit'|'paidRevenue'|'partsSpend'|'uncosted'>; employees:Employee[]; orders:Order[]; customers:Customer[]; events:Event[]; latest:string|null; catalogue:Item[]; starterPrices:boolean; webhookConfigured:boolean };

const metrics = [
  { key:'dutyMs', label:'Duty hours', icon:Clock3, note:'Recorded time on shift' },
  { key:'orders', label:'Orders completed', icon:ListChecks, note:'Completed workshop jobs' },
  { key:'invoices', label:'Invoices created', icon:ReceiptText, note:'Unique invoices issued' },
  { key:'parts', label:'Parts obtained', icon:Boxes, note:'Total units received' },
  { key:'profit', label:'Gross profit', icon:CircleDollarSign, note:'Paid invoices less direct costs' },
] as const;
const money = (cents:number) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:cents%100 ? 2 : 0 }).format(cents/100);
const date = (value?:string|null) => value ? new Intl.DateTimeFormat('en-IN', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value)) : '—';
const duty = (ms:number) => `${Math.floor(ms / 3600000)}h ${Math.floor(ms / 60000) % 60}m`;
const num = (n:number) => n.toLocaleString('en-IN');
const titles: Record<Page,string> = { Overview:'Workshop Overview', 'Service Catalogue':'Service Catalogue', Employees:'Employee Performance', 'Customer Orders':'Customer Orders', Customers:'Customer Directory', 'Game Webhook':'Game Webhook' };
const descriptions: Record<Page,string> = { Overview:'Track your Vanga Palagalam workshop activity in one place.', 'Service Catalogue':'Manage your workshop services and in-game prices.', Employees:'Review each mechanic’s shifts, jobs, invoices, parts and gross profit.', 'Customer Orders':'Search customer orders and track their progress.', Customers:'Review order history, paid spend and repeat customers.', 'Game Webhook':'Connect your FiveM server to the workshop database.' };
const emptyMetrics = { dutyMs:0, orders:0, invoices:0, parts:0, profit:0, paidRevenue:0, partsSpend:0, uncosted:0 };
const eventNames: Record<string,string> = {'duty.started':'Clocked in','duty.ended':'Clocked out','order.created':'Opened an order','order.completed':'Completed an order','invoice.created':'Created an invoice','invoice.paid':'Recorded a payment','parts.obtained':'Obtained parts'};

function Empty({ icon:Icon, title, children }: {icon:typeof Activity;title:string;children:ReactNode}) {
  return <div className="empty"><span className="empty-icon"><Icon size={21}/></span><strong>{title}</strong><p>{children}</p></div>;
}

function Panel({ title, subtitle, action, children }: {title:string;subtitle?:string;action?:ReactNode;children:ReactNode}) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}

function Table({ headers, children }: {headers:string[];children:ReactNode}) {
  return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function EventList({ events }: {events:Event[]}) {
  const [limit, setLimit] = useState(25);
  if (!events.length) return <Empty icon={Activity} title="No game activity yet">Game events appear here after your server starts sending them.</Empty>;
  return <><ul className="event-list">{events.slice(0,limit).map(event=><li key={event.eventId}><span className="event-dot"><Activity size={15}/></span><div><strong>{event.employeeName}</strong> {eventNames[event.type]}<small>{event.service || event.partName || event.invoiceId || event.shiftId}</small></div><time>{date(event.occurredAt)}</time></li>)}</ul>{events.length>limit && <div className="panel-body"><button className="secondary" onClick={()=>setLimit(limit+25)}>Show more events</button></div>}</>;
}

export default function Home() {
  const [page,setPage] = useState<Page>('Overview');
  const [days,setDays] = useState(0);
  const [data,setData] = useState<Workshop|null>(null);
  const [busy,setBusy] = useState(true);
  const [loadError,setLoadError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('All');
  const [selected,setSelected] = useState('');
  const [editing,setEditing] = useState<Item[]|null>(null);
  const [key,setKey] = useState('');
  const [saving,setSaving] = useState(false);
  const [notice,setNotice] = useState('');
  const [menu,setMenu] = useState(false);
  const [origin,setOrigin] = useState('');
  const [discordStatus,setDiscordStatus] = useState<DiscordStatus|null>(null);
  const [discordBusy,setDiscordBusy] = useState(false);
  const [discordNotice,setDiscordNotice] = useState('');
  const discordInFlight=useRef(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (new URLSearchParams(window.location.search).get('tab') === 'discord') setPage('Game Webhook');
    fetch('/api/discord',{cache:'no-store'}).then(response=>response.ok?response.json():null)
      .then(value=>setDiscordStatus(value as DiscordStatus|null)).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!discordStatus?.connected) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || discordInFlight.current) return;
      discordInFlight.current=true;
      setDiscordBusy(true);
      fetch('/api/discord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync'})})
        .then(response=>response.ok?response.json():null).then(value=>{
          const update=value as DiscordStatus|null;
          if (!update) return;
          setDiscordStatus(update);
          if (update.received) setRefresh(value=>value+1);
        }).catch(()=>{}).finally(()=>{discordInFlight.current=false;setDiscordBusy(false);});
    },60000);
    return () => window.clearInterval(interval);
  }, [discordStatus?.connected]);

  async function sendDiscord(action:'connect'|'sync',token?:string) {
    if (discordInFlight.current) return;
    discordInFlight.current=true;
    setDiscordBusy(true); setDiscordNotice('');
    try {
      const response=await fetch('/api/discord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token})});
      const result=await response.json() as DiscordStatus;
      if (!response.ok) throw new Error(result.error || 'Discord sync could not finish.');
      setDiscordStatus(result);
      if (!result.connected) throw new Error('The Discord bot is disconnected. Reconnect it under Game Webhook.');
      setDiscordNotice(action==='connect'?`Discord connected. Imported ${result.received||0} events.`:`Sync complete. Imported ${result.received||0} new events.`);
      setRefresh(value=>value+1);
    } catch (error) {setDiscordNotice((error as Error).message);}
    finally {discordInFlight.current=false;setDiscordBusy(false);}
  }
  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    setLoadError('');
    fetch('/api/workshop?days='+days,{cache:'no-store',signal:ctrl.signal})
      .then(async response => {
        const result = await response.json() as Workshop & { error?:string };
        if (!response.ok) throw new Error(result.error || 'Could not load workshop data.');
        setData(result);
      }).catch(error => { if (!ctrl.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!ctrl.signal.aborted) setBusy(false); });
    return () => ctrl.abort();
  }, [days,refresh]);

  function navigate(next:Page) {
    setKey(''); setPage(next); setQuery(''); setFilter('All'); setSelected(''); setNotice(''); setMenu(false);
    if (next !== 'Employees' && next !== 'Overview') setDays(0);
    window.scrollTo({top:0,behavior:'instant'});
  }
  async function save(body:object, message:string) {
    setSaving(true); setNotice('');
    try {
      const result = await fetch('/api/workshop', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const value = await result.json() as { error?:string };
      if (!result.ok) throw new Error(value.error || 'Save failed.');
      setNotice(message); setRefresh(v=>v+1); return true;
    } catch (error) {setNotice((error as Error).message); return false;}
    finally {setSaving(false);}
  }
  async function copy(value:string, label:string) {
    try { await navigator.clipboard.writeText(value); setNotice(label+' copied.'); }
    catch {setNotice('Clipboard access is unavailable. Select and copy the text.');}
  }
  async function downloadConfiguration() {
    setSaving(true); setNotice('');
    try {
      const result = await fetch('/api/workshop', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'configuration',key}) });
      const value = await result.json() as { error?:string; configuration?:string };
      if (!result.ok || !value.configuration) throw new Error(value.error || 'Configuration is unavailable.');
      const url = URL.createObjectURL(new Blob([value.configuration+'\n'], {type:'text/plain'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'paradise-customs-server.cfg';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice('Configuration downloaded. Copy its lines into your FiveM server.cfg.');
    } catch (error) {setNotice((error as Error).message);}
    finally {setSaving(false);}
  }
  const includes = (...values:(string|number|undefined)[]) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const catalogue = data?.catalogue ?? defaultCatalogue;
  const employee = data?.employees.find(item=>item.id===selected);
  const customer = data?.customers.find(item=>item.id===selected);
  const employeeRows = (data?.employees ?? []).filter(item=>includes(item.name,item.id));
  const orderRows = (data?.orders ?? []).filter(item=>(filter==='All'||item.status===filter)&&includes(item.id,item.customerName,item.service,item.employeeName,item.vehicle));
  const customerRows = (data?.customers ?? []).filter(item=>(filter==='All'||item.completed>=2)&&includes(item.name,item.id));
  const endpoint = origin+'/api/webhook';
  const example = JSON.stringify({eventId:'eclipse:shift-401:start',type:'duty.started',occurredAt:'2026-11-12T08:30:00Z',employeeId:'mechanic-12',employeeName:'Mechanic Name',shiftId:'shift-401'},null,2);

  function search(placeholder:string, options?:string[]) {
    return <div className="filters"><label className="search"><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={query} onChange={e=>setQuery(e.target.value)}/></label>{options && <label className="select"><select aria-label="Filter records" value={filter} onChange={e=>setFilter(e.target.value)}>{options.map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={14}/></label>}</div>;
  }

  function employeeTable(rows:Employee[]) {
    return rows.length ? <Table headers={['Employee','Duty hours','Orders','Invoices','Parts','Gross profit']}>{rows.map(item=><tr key={item.id}><td><button className="record" onClick={()=>{if(page!=='Employees')navigate('Employees');setSelected(item.id);}}><span className="avatar">{item.name.slice(0,2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.active?'On duty':item.id}</small></span></button></td><td>{item.hasDuty?duty(item.dutyMs):'—'}</td><td>{num(item.orders)}</td><td>{num(item.invoices)}</td><td>{num(item.parts)}</td><td className="green">{item.uncosted?'Incomplete':money(item.profit)}{item.uncosted>0&&<small>{item.uncosted} paid invoice(s) missing cost</small>}</td></tr>)}</Table> : <Empty icon={UsersRound} title={query?'No matching employees':'No employees recorded'}>{query?'Try another employee name or ID.':'Employee totals appear after the first game event.'}</Empty>;
  }

  function ordersTable(rows:Order[]) {
    return rows.length ? <Table headers={['Order','Customer','Service / Vehicle','Employee','Order payment','Status','Updated (IST)']}>{rows.map(item=><tr key={item.id}><td className="mono">{item.source==='discord'?'#'+item.id.split(':').at(-1):item.id}</td><td><strong>{item.customerName || 'Placement missing'}</strong></td><td>{item.service||'—'}<small>{item.vehicle}</small></td><td>{item.source==='discord'&&item.status==='Open'?'—':item.employeeName}</td><td>{typeof item.orderPaidCents==='number'?money(item.orderPaidCents):'—'}<small>{item.paymentMethod}</small></td><td><span className={'tag '+(item.status==='Completed'?'positive':'')}>{item.status}</span></td><td>{date(item.occurredAt)}</td></tr>)}</Table> : <Empty icon={ClipboardList} title="No orders to display">Orders appear when the game sends an order event.</Empty>;
  }

  return <div className="shell">
    <aside className={'sidebar '+(menu?'sidebar-open':'')}>
      <Brand label="Workshop settings" onClick={()=>navigate('Overview')}/>
      {['WORKSPACE','INTEGRATION'].map(group=><nav aria-label={group} key={group}><p>{group}</p>{sections.filter(s=>s.group===group).map(({label,icon:Icon})=><button key={label} aria-current={page===label?'page':undefined} className={page===label?'current':''} onClick={()=>navigate(label)}><Icon size={17}/><span>{label}</span></button>)}</nav>)}
      <div className="sidebar-foot"><span className="server-icon"><CarFront size={16}/></span><div><strong>Vanga Palagalam</strong><small>Workshop management</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={()=>setMenu(!menu)}><Menu size={18}/></button><span>Workshop</span><span className="slash">/</span><strong>{page}</strong></div><button className={'connection '+(data?.latest?'connected':'')} onClick={()=>navigate('Game Webhook')}><i/>{data?.latest?'Game events received':data?.webhookConfigured?'Awaiting game events':'Webhook setup pending'}</button></header>
      <main>
        <div className="page-heading"><div><h1>{titles[page]}</h1><p>{descriptions[page]}</p></div><div className="heading-actions">
          {(page==='Overview'||page==='Employees') && <label className="select"><select aria-label="Reporting period" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={0}>All time</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><ChevronDown size={14}/></label>}
          <button className="primary" type="button" disabled={discordBusy} onClick={()=>void sendDiscord('sync')}><RefreshCw size={15} className={discordBusy?'spin':''}/> {discordBusy?'Syncing…':'Sync Now'}</button>
          <button className="icon-button" aria-label="Refresh workshop data" title="Refresh data" disabled={busy} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={17} className={busy?'spin':''}/></button>
        </div></div>
        {discordNotice&&<div className="notice" role="status">{discordNotice}<button className="bare" aria-label="Dismiss sync message" onClick={()=>setDiscordNotice('')}><X size={16}/></button></div>}
        {loadError && <div className="notice error" role="alert">{loadError}</div>}
        {notice && <div className="notice" role="status">{notice}<button className="bare" aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={16}/></button></div>}

        {page==='Overview' && <>
          <section className="hero"><div className="hero-content"><div className="hero-label"><span/> VANGA PALAGALAM WORKSHOP</div><h2>PARADISE<br/><em>CUSTOMS</em></h2><p>Services, shifts and workshop performance.</p><button className="primary" onClick={()=>navigate('Service Catalogue')}>View service catalogue <ArrowRight size={15}/></button></div></section>
          <div className="section-title"><h2>Workshop metrics</h2><span>{days?`LAST ${days} DAYS`:'ALL TIME'}</span></div>
          <div className="metrics">{metrics.map(({key,label,icon:Icon,note})=>{const value=(data?.metrics??emptyMetrics)[key];return <article className="metric" key={key}><div className="metric-label"><span><Icon size={17}/></span>{label}</div><strong>{busy&&!data?'—':key==='dutyMs'?duty(value):key==='profit'?(data?.metrics.uncosted?'Incomplete':money(value)):num(value)}</strong><p>{key==='profit'&&data?.metrics.uncosted?`${data.metrics.uncosted} paid invoice(s) missing cost`:note}</p></article>;})}</div>
          <div className="overview-grid">
            <Panel title="Employee performance" subtitle="Per-employee workshop totals" action={<button className="text-button" onClick={()=>navigate('Employees')}>View employees <ArrowRight size={14}/></button>}>{employeeTable(employeeRows.slice(0,5))}</Panel>
            <Panel title="Recent activity" subtitle="Latest game events" action={<Activity size={18} className="green"/>}><EventList events={data?.events.slice(0,5)??[]}/></Panel>
          </div>
        </>}

        {page==='Service Catalogue' && <Panel title="Service pricing" subtitle={data?.starterPrices===false?'Current workshop prices in RP dollars.':'Sample prices in RP dollars. Edit them to match your workshop.'} action={<button className="primary" disabled={!data} onClick={()=>setEditing(catalogue.map(item=>({...item})))}><Pencil size={15}/> Edit catalogue</button>}>
          {search('Search services…',['All',...new Set(catalogue.map(item=>item.category))])}
          <div className="catalogue">{catalogue.filter(item=>(filter==='All'||filter===item.category)&&includes(item.name,item.description)).map(item=><article key={item.id}><span className="service-icon"><Wrench size={20}/></span><div><span className="tag">{item.category}</span><h3>{item.name}</h3><p>{item.description}</p><strong>{money(item.price)}</strong></div></article>)}</div>
          {!catalogue.some(item=>(filter==='All'||filter===item.category)&&includes(item.name,item.description))&&<Empty icon={BookOpen} title="No services found">Try another search or add a service to the catalogue.</Empty>}
        </Panel>}

        {page==='Employees' && <>
          <Panel title="Employee log" subtitle="Open shifts accrue through the time of the latest refresh. Overlapping shifts are counted once.">{search('Search by employee name or ID…')}{employeeTable(employeeRows)}</Panel>
          {employee && <div className="spaced"><Panel title={employee.name+' · activity'} subtitle={employee.dutyIssues?`${employee.dutyIssues} unmatched or invalid shift records`:`Employee ID: ${employee.id}`} action={<button className="icon-button" aria-label="Close employee activity" onClick={()=>setSelected('')}><X size={16}/></button>}><div className="panel-body form-actions"><span className="tag positive">Paid invoice revenue {money(employee.paidRevenue)}</span><span className="tag">Parts purchase spend {money(employee.partsSpend)}</span>{employee.uncosted>0&&<span className="tag">Profit on costed invoices {money(employee.profit)}</span>}{!employee.hasDuty&&<span className="tag">No duty events received</span>}</div><EventList events={data?.events.filter(item=>item.employeeId===selected&&!(item.source==='discord'&&(item.type==='order.created'||item.type==='invoice.paid')))??[]}/></Panel></div>}
        </>}

        {page==='Customer Orders' && <Panel title="Order history" subtitle="Order status and customer details from Vanga Palagalam.">{search('Search orders, vehicles or customers…',['All','Open','Completed'])}{ordersTable(orderRows)}</Panel>}

        {page==='Customers' && <>
          <Panel title="Customer records" subtitle="Regular customers have at least two completed orders. Spend reflects paid invoices.">{search('Search customer name or ID…',['All','Regular customers'])}
          {customerRows.length ? <Table headers={['Customer','Orders','Completed','Paid spend','Last order','Type']}>{customerRows.map(item=><tr key={item.id}><td><button className="record" onClick={()=>setSelected(item.id)}><span className="avatar">{item.name.slice(0,2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.id}</small></span></button></td><td>{item.orderIds.length}</td><td>{item.completed}</td><td className="green">{money(item.spend)}</td><td>{date(item.lastOrder)}</td><td><span className={'tag '+(item.completed>=2?'positive':'')}>{item.completed>=2?'Regular':'Customer'}</span></td></tr>)}</Table> : <Empty icon={UsersRound} title="No customers to display">Customer records are created from order and invoice events.</Empty>}
          </Panel>
          {customer && <div className="spaced"><Panel title={customer.name+' · orders'} action={<button className="icon-button" aria-label="Close order history" onClick={()=>setSelected('')}><X size={16}/></button>}>{ordersTable(data?.orders.filter(item=>item.customerId===selected)??[])}</Panel></div>}
        </>}

        {page==='Game Webhook' && <>
          <div className="discord-setup"><Panel title="Connect Paradise Customs Logs" subtitle="Import JG Mechanic logs from Vanga Palagalam’s DELIVERY-LOGS channel." action={<PlugZap className="green" size={20}/>}>
            <div className="panel-body stack">
              {discordStatus?.connected && <div className="form-actions"><span className="tag positive">Discord connected</span><span className="muted">Last sync {date(discordStatus.syncedAt)} · {discordStatus.imported||0} imported{discordStatus.skipped?` · ${discordStatus.skipped} malformed embeds`:''}</span></div>}
              <form className="stack" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const token=String(new FormData(form).get('discord-token')||'');form.reset();void sendDiscord('connect',token);}}>
                <label className="field-label">Discord bot token<input type="password" name="discord-token" minLength={30} maxLength={220} autoComplete="off" required placeholder="Paste the Paradise Customs Logs bot token"/></label>
                <button className="primary" type="submit" disabled={discordBusy}><PlugZap size={15}/> {discordBusy?'Working…':discordStatus?.connected?'Reconnect bot':'Connect Discord'}</button>
              </form>
              <p className="muted">On the bot settings page, use Reset Token if you need a new token. Paste it only in this form. The first sync checks the latest 100 channel messages.</p>
              <div className="form-actions">
                <a className="text-button" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Open Discord bot settings <ArrowRight size={14}/></a>
                {discordStatus?.channelUrl && <a className="text-button" href={discordStatus.channelUrl} target="_blank" rel="noreferrer">Open {discordStatus.channelName || 'configured log channel'} <ArrowRight size={14}/></a>}
              </div>
              {discordStatus?.channelId&&<p className="muted">Discord channel ID <code>{discordStatus.channelId}</code>{discordStatus.webhookId&&<> · Posting webhook ID <code>{discordStatus.webhookId}</code></>}</p>}
            </div>
          </Panel></div>

          <div className="integration-grid">
            <Panel title="Webhook endpoint" subtitle="Send one JSON event per HTTP POST from your FiveM server." action={<PlugZap className="green" size={20}/>}>
              <div className="panel-body stack"><label className="field-label">Endpoint<div className="endpoint"><span className="tag positive">POST</span><code>{endpoint}</code><button className="icon-button" aria-label="Copy endpoint" onClick={()=>copy(endpoint,'Endpoint')}><Copy size={16}/></button></div></label>
              <p className="muted">Last game event <strong>{date(data?.latest)}</strong> {data?.latest?'IST':''}</p>
              </div>
            </Panel>
            <Panel title="Webhook key" subtitle={data?.webhookConfigured?'A workshop key is configured.':'Create a key to authenticate game events.'} action={<KeyRound className="green" size={20}/>}>
              <form className="panel-body stack" onSubmit={e=>{e.preventDefault();void save({action:'key',key},'Key saved. Copy it to your FiveM server configuration.');}}>
                <label className="field-label">Workshop key<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Enter or generate a new key" minLength={24} maxLength={128} required/></label>
                <div className="form-actions"><button className="secondary" type="button" onClick={()=>setKey(Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''))}>Generate key</button><button className="secondary" type="button" disabled={!key} onClick={()=>copy(key,'Workshop key')}>Copy key</button><button className="primary" disabled={saving||!data} type="submit">Save key</button></div>
                <p className="muted">Saving a new key replaces the current one. Keep the key and downloaded configuration on your server.</p>
              </form>
            </Panel>
          </div>
          <div className="integration-grid spaced">
            <Panel title="FiveM setup"  subtitle="Configure these server-only convars in server.cfg." action={<CodeXml className="green" size={20}/>}>
              <div className="panel-body stack"><pre>{`set paradise_webhook_url "${endpoint}"\nset paradise_workshop_key "YOUR_WORKSHOP_KEY"\nensure paradise_customs_webhook`}</pre><button className="secondary" disabled={saving||!key||!data?.webhookConfigured} onClick={downloadConfiguration}><ArrowDownToLine size={16}/> Download private configuration</button><p className="muted">Generate and save a workshop key first. Requests send it in <code>X-Workshop-Key</code>.</p><p className="muted">Install the resource and call its server export from the duty, order, billing and inventory actions that persist your in-game records.</p></div>
            </Panel>
            <Panel title="Example event" subtitle="Use your game’s stable IDs and the actual event time." action={<button className="icon-button" aria-label="Copy example event" onClick={()=>copy(example,'Example event')}><Copy size={16}/></button>}><div className="panel-body"><pre>{example}</pre></div></Panel>
          </div>
          <div className="spaced"><Panel title="Supported game events" subtitle="Every event also requires eventId, occurredAt, employeeId and employeeName."><Table headers={['Event','Additional fields']}>{Object.entries(eventFields).map(([type,fields])=><tr key={type}><td><code>{type}</code></td><td>{Object.entries(fields).map(([name,kind])=>kind==='optional'||kind.endsWith('?')?name+' (when available)':name).join(', ')}</td></tr>)}</Table></Panel></div>
        </>}

        <footer>Paradise Customs <span>•</span> Vanga Palagalam <span>•</span> Times shown in IST</footer>
      </main>
    </div>
    {editing && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="panel-heading"><div><h2 id="editor-title">Edit catalogue</h2><p>Enter prices in RP dollars.</p></div><button className="icon-button" aria-label="Close editor" onClick={()=>setEditing(null)}><X size={17}/></button></div>
      <form onSubmit={async e=>{e.preventDefault();if(await save({action:'catalogue',catalogue:editing},'Catalogue saved.'))setEditing(null);}}><div className="edit-list">{editing.map((item,index)=><fieldset key={item.id}><legend>{item.name||'New service'}</legend><div className="edit-grid">{(['name','category','description','price'] as const).map(field=><label className="field-label" key={field}>{field[0].toUpperCase()+field.slice(1)}<input required maxLength={160} type={field==='price'?'number':'text'} min={field==='price'?0:undefined} step={field==='price'?'0.01':undefined} value={field==='price'?item.price/100:item[field]} onChange={e=>{const value=e.target.value;setEditing(editing.map((row,i)=>i===index?{...row,[field]:field==='price'?Math.round(Number(value)*100):value}:row));}}/></label>)}</div><button className="text-button" type="button" onClick={()=>setEditing(editing.filter((_,i)=>i!==index))}>Remove service</button></fieldset>)}</div>
      {notice && <p className="modal-notice" role="status">{notice}</p>}<div className="modal-actions"><button className="secondary" type="button" onClick={()=>setEditing([...editing,{id:crypto.randomUUID(),name:'',description:'',category:'',price:0}])}><Plus size={16}/> Add service</button><button className="primary" disabled={saving} type="submit">Save catalogue</button></div></form>
    </section></div>}
  </div>;
}

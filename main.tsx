import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultCatalogue } from './lib/workshop.mjs';
import Catalogue from './app/public-catalogue';
import './app/globals.css';
import './app/paradise-theme.css';

const Employees = lazy(()=>import('./app/employees/page'));
const Console = lazy(()=>import('./app/workshop-admin/console'));
const loading = <main className="muted">Loading workshop…</main>;

function Showroom() {
  const [state,setState]=useState({catalogue:defaultCatalogue,starterPrices:true});
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    const cancel=new AbortController();
    fetch('/api/catalogue',{signal:cancel.signal}).then(async response=>{
      if (!response.ok) throw new Error('Could not load workshop prices');
      setState(await response.json());
    }).catch(()=>{if (!cancel.signal.aborted) setUnavailable(true);});
    return ()=>cancel.abort();
  },[]);
  return <>{unavailable&&<p className="pc-bound muted" role="status">Live prices are unavailable. Showing sample prices.</p>}
    <Catalogue {...state}/></>;
}

function Admin() {
  const [allowed,setAllowed]=useState<boolean|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const cancel=new AbortController();
    fetch('/api/employees',{signal:cancel.signal,cache:'no-store'}).then(async response=>{
      if (!response.ok) throw new Error('Could not verify workshop access');
      const session=await response.json() as {owner?:boolean};
      setAllowed(session.owner===true);
    }).catch(()=>{if (!cancel.signal.aborted) setFailed(true);});
    return ()=>cancel.abort();
  },[]);
  if (failed) return <main><p>Workshop settings are temporarily unavailable.</p><a href="/employees">Employee dashboard</a></main>;
  if (allowed===null) return loading;
  if (!allowed) return <main><p>Sign in as a Boss to open workshop settings.</p><a href="/employees">Employee sign-in</a></main>;
  return <Console/>;
}

const path=window.location.pathname.replace(/\/$/,'')||'/';
if (path==='/' && new URLSearchParams(location.search).get('tab')==='discord') {
  location.replace('/workshop-admin?tab=discord');
} else {
  createRoot(document.getElementById('root')!).render(<Suspense fallback={loading}>
    {path==='/employees'?<Employees/>:path==='/workshop-admin'?<Admin/>:<Showroom/>}
  </Suspense>);
}

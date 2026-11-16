'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUpRight, Gauge, Paintbrush, Search, Wrench } from 'lucide-react';
import Brand from './brand';
import Emblem from './emblem';

type Item={id:string;name:string;category:string;description:string;price:number};
const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const iconFor=(name:string)=>{
  if (/perform|turbo|engine/i.test(name)) return Gauge;
  if (/cosmetic|paint|custom/i.test(name)) return Paintbrush;
  return Wrench;
};

export default function Catalogue({catalogue,starterPrices}:{catalogue:Item[];starterPrices:boolean}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const categories=[...new Set(catalogue.map(item=>item.category))];
  const term=query.trim().toLowerCase();
  const shown=catalogue.filter(item=>(!category||item.category===category)&&
    [item.name,item.description,item.category].join(' ').toLowerCase().includes(term));
  return <div className="pc-showroom">
    <header className="pc-nav"><div className="pc-bound pc-nav-inner">
      <Brand/>
      <nav aria-label="Main navigation"><a className="pc-nav-services" href="#services">Services</a>
        <a className="pc-nav-access" href="/employees">Employee access <ArrowUpRight size={17}/></a></nav>
    </div></header>
    <main className="pc-bound">
      <section className="pc-hero" aria-labelledby="pc-title">
        <div className="pc-hero-copy">
          <div className="pc-kicker">VANGA PALAGALAM WORKSHOP</div>
          <h1 id="pc-title">Paradise<br/><em>Customs</em></h1>
          <p>Vehicle repairs, performance upgrades, and custom finishes.</p>
          <a className="pc-button" href="#services">Explore services <ArrowDown size={20}/></a>
        </div>
        <Emblem/>
      </section>
      <section className="pc-services" id="services" aria-labelledby="pc-services-title">
        <div className="pc-services-heading">
          <div><h2 id="pc-services-title">Service catalogue</h2><p>{starterPrices?'Sample prices in RP dollars.':'Workshop prices in RP dollars.'}</p></div>
          <label className="pc-search"><Search size={18}/><input aria-label="Search services" placeholder="Search services" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        </div>
        <div className="pc-categories" role="group" aria-label="Service category">
          {['',...categories].map(value=><button type="button" aria-pressed={value===category} key={value} onClick={()=>setCategory(value)}>{value||'All services'}</button>)}
        </div>
        <div className="pc-service-grid">
          {shown.map(item=>{
            const Icon=iconFor(item.category);
            return <article className="pc-service" key={item.id}>
              <header><Icon size={22}/><span>{item.category}</span></header>
              <h3>{item.name}</h3><p>{item.description}</p>
              <div className="pc-service-price">{currency.format(item.price/100).replace(/\.00$/,'')}</div>
            </article>;
          })}
        </div>
        {!shown.length&&<p className="pc-empty" role="status">No services match your search.</p>}
      </section>
    </main>
    <footer className="pc-bound pc-footer"><Brand/><a href="#pc-title">Back to top ↑</a></footer>
  </div>;
}

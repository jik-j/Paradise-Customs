'use client';

import { useEffect, useRef, useState } from 'react';
import { Rotate3D } from 'lucide-react';
import { makeEmblem } from './emblem-model';

export default function Emblem() {
  const area=useRef<HTMLDivElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const photo=useRef<HTMLImageElement>(null);
  const controller=useRef<{nudge:()=>void}|null>(null);
  const [webgl,setWebgl]=useState(false);
  const [mode,setMode]=useState<'static'|'interactive'|'angled'>('static');

  useEffect(()=>{
    const surface=canvas.current, target=area.current, image=photo.current;
    if (!surface || !target || !image) return;
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose=()=>{};
    function mount() {
      dispose();
      controller.current=null;
      setMode('static');
      setWebgl(false);
      if (!surface || !target || !image?.naturalWidth || motion.matches) return;
      const model=makeEmblem(surface,image);
      setWebgl(Boolean(model));
      let position=[-.05,-.13], goal=[...position], frame=0, angled=false;
      function draw() {
        position=position.map((value,index)=>value+(goal[index]-value)*.14);
        if (model) model.draw(position[0],position[1]);
        else {
          target?.style.setProperty('--emblem-x',position[0]+'rad');
          target?.style.setProperty('--emblem-y',position[1]+'rad');
        }
        frame=position.some((value,index)=>Math.abs(value-goal[index])>.001)
          ? requestAnimationFrame(draw) : 0;
      }
      function animate() {if (!frame) frame=requestAnimationFrame(draw);}
      function move(event:PointerEvent) {
        if (!target || event.pointerType==='touch') return;
        const box=target.getBoundingClientRect();
        goal=[((event.clientY-box.top)/box.height-.5)*.56,((event.clientX-box.left)/box.width-.5)*.82];
        animate();
      }
      function reset() {goal=angled?[.12,.68]:[-.05,-.13];animate();}
      controller.current={nudge:()=>{
        angled=!angled;
        setMode(angled?'angled':'interactive');
        reset();
      }};
      const size=new ResizeObserver(animate);
      size.observe(surface);
      target.addEventListener('pointermove',move);
      target.addEventListener('pointerleave',reset);
      surface.addEventListener('webglcontextlost',hide,{once:true});
      function hide() {mount();}
      dispose=()=>{
        size.disconnect();
        target?.removeEventListener('pointermove',move);
        target?.removeEventListener('pointerleave',reset);
        surface?.removeEventListener('webglcontextlost',hide);
        cancelAnimationFrame(frame);
        model?.cleanup();
      };
      draw();
      setMode('interactive');
    }
    if (image.complete) mount();
    image.addEventListener('load',mount);
    motion.addEventListener('change',mount);
    return ()=>{dispose();controller.current=null;image.removeEventListener('load',mount);motion.removeEventListener('change',mount);};
  },[]);

  return <div className="emblem-stage">
    <div className="emblem-display" ref={area} data-model={mode} data-render={webgl?'webgl':'css'}>
      <span className="emblem-halo" aria-hidden="true"/>
      <span className="emblem-floor" aria-hidden="true"/>
      <div className="emblem-solid">
        <span aria-hidden="true" className="emblem-bevel emblem-bevel-back"/>
        <span aria-hidden="true" className="emblem-bevel emblem-bevel-mid"/>
        <span aria-hidden="true" className="emblem-bevel emblem-bevel-front"/>
      {/* The original emblem is the face of the rendered model in the CSS fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="emblem-face" ref={photo} src="/assets/paradise-emblem.webp" width={1000} height={1000}
        alt="Paradise Customs emblem with chrome pistons and a red turbocharger" fetchPriority="high"/>
      </div>
      <canvas ref={canvas} className="emblem-canvas" aria-hidden="true"/>
    </div>
    {mode!=='static'&&<button type="button" className="emblem-control" aria-pressed={mode==='angled'} onClick={()=>controller.current?.nudge()}>
      <Rotate3D size={15}/> Rotate emblem
    </button>}
  </div>;
}

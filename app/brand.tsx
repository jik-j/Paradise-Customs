export default function Brand({label, onClick}:{label?:string;onClick?:()=>void}) {
  const mark=<>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/assets/paradise-mark.webp" alt="" width={45} height={45}/>
    <span>PARADISE <strong>CUSTOMS</strong>{label&&<small>{label}</small>}</span>
  </>;
  return onClick?<button type="button" className="pc-brand" onClick={onClick}>{mark}</button>:
    <a href="/" className="pc-brand">{mark}</a>;
}

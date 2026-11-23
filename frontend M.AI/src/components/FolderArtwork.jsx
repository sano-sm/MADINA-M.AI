import React from "react";

/** Reusable illustrated folder artwork, intentionally independent of accounting logic. */
export default function FolderArtwork({ kind, design = "c" }) {
  const id = `ct-art-${kind}-${design}`;
  const golden = design === "c";
  const blue = design === "b" || design === "a";
  const metal = golden ? ["#fff4a5","#ffc32f","#a85a05"] : ["#dff9ff","#248fff","#07368d"];
  const dark = golden ? "#744008" : "#06438e";
  return <svg className="ct-illustrated-icon" viewBox="0 0 150 140" role="img" aria-label={kind === "invoices" ? "3D shipping container hanging from crane" : kind === "income" ? "TT document with approval seal" : "BL shipping document with cargo ship"}>
    <defs>
      <linearGradient id={id+"-metal"} x1="0" y1="0" x2="1" y2="1"><stop stopColor={metal[0]}/><stop offset=".45" stopColor={metal[1]}/><stop offset="1" stopColor={metal[2]}/></linearGradient>
      <linearGradient id={id+"-paper"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".65" stopColor="#fff4d9"/><stop offset="1" stopColor="#c8d8e7"/></linearGradient>
      <linearGradient id={id+"-sea"} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#27c7ff"/><stop offset="1" stopColor="#04549b"/></linearGradient>
      <filter id={id+"-shadow"} x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="2" dy="5" stdDeviation="3" floodColor="#000" floodOpacity=".55"/></filter>
    </defs>
    {kind === "invoices" ? <g filter={`url(#${id}-shadow)`}>
      <path d="M73 9V25M73 25L22 63M73 25L123 55" stroke={golden?"#ffdc58":"#f8b93d"} strokeWidth="4" strokeLinecap="round"/>
      <circle cx="73" cy="12" r="7" fill="none" stroke="#ffcb40" strokeWidth="5"/>
      <path d="M18 62L96 50L132 66L53 81Z" fill={metal[0]} stroke={dark} strokeWidth="2"/>
      <path d="M18 62L53 81V124L18 107Z" fill={metal[2]} stroke={dark} strokeWidth="2"/>
      <path d="M53 81L132 66V110L53 124Z" fill={`url(#${id}-metal)`} stroke={dark} strokeWidth="2"/>
      {[64,77,90,103,116].map(x=><path key={x} d={`M${x} ${79-(x-53)*.19}v43`} stroke={dark} strokeWidth="2.2" opacity=".65"/>)}
      {[29,40].map(x=><path key={x} d={`M${x} 70v43`} stroke={metal[0]} strokeWidth="2" opacity=".75"/>)}
      <path d="M19 63L53 81L132 66" fill="none" stroke="#fff5b3" strokeWidth="2" opacity=".8"/>
      <path d="M59 89L126 77" stroke="#fff" strokeWidth="1.5" opacity=".35"/>
      <rect x="18" y="103" width="6" height="8" rx="1" fill="#ffda49"/><rect x="126" y="105" width="6" height="8" rx="1" fill="#ffda49"/>
    </g> : kind === "income" ? <g filter={`url(#${id}-shadow)`}>
      <path d="M31 14H94L119 39V119Q119 124 113 124H31Q25 124 25 117V21Q25 14 31 14Z" fill={`url(#${id}-paper)`} stroke="#8eafc7" strokeWidth="2"/>
      <path d="M94 14V39H119Z" fill="#c9e4f9" stroke="#779bb5" strokeWidth="1.5"/>
      <rect x="37" y="34" width="52" height="25" rx="4" fill={golden?"#06664e":"#0d77d9"} stroke="#d9f8ff" strokeWidth="1.5"/>
      <text x="63" y="52" textAnchor="middle" fill="white" fontSize="19" fontWeight="900">TT</text>
      {[72,83,94].map((y,i)=><rect key={y} x="39" y={y} width={i===2?42:61} height="4" rx="2" fill="#6d9dbb"/>)}
      {golden ? <g transform="translate(85 85) rotate(32)"><rect x="-5" y="-23" width="11" height="46" rx="3" fill="#1c2934" stroke="#ffca4e" strokeWidth="3"/><path d="M-5 23L.5 34L6 23" fill="#e9b05e"/><path d="M-1 30L.5 34L2 30" fill="#171717"/></g> : <g><circle cx="101" cy="103" r="23" fill={design==="b"?"#27b94e":"#ffca37"} stroke={design==="b"?"#d6ffd5":"#ffef9a"} strokeWidth="4"/><path d="M89 102l9 9 16-19" fill="none" stroke={design==="b"?"white":"#253650"} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></g>}
    </g> : <g filter={`url(#${id}-shadow)`}>
      <path d="M23 12H90L114 36V120Q114 125 108 125H23Q17 125 17 118V19Q17 12 23 12Z" fill={`url(#${id}-paper)`} stroke="#8da9be" strokeWidth="2"/>
      <path d="M90 12V36H114Z" fill="#c6dcec" stroke="#7294ac"/>
      <text x="60" y="49" textAnchor="middle" fontWeight="900" fontSize="24" fill={golden?"#006e63":"#0c58a5"}>BL</text>
      <path d="M29 58H89M29 66H80" stroke="#75a8d1" strokeWidth="4" strokeLinecap="round"/>
      <path d="M33 105L47 116H104L129 98L125 90H48Z" fill={golden?"#063e57":"#064b91"} stroke="#2ccaff" strokeWidth="2"/>
      <path d="M55 88V76H98V90" fill="#f9f8f2" stroke="#1a7097" strokeWidth="2"/>
      <path d="M69 76V67H86V76M77 67V59" fill="none" stroke="#125c8e" strokeWidth="3"/>
      {[52,64,76,88,100].map(x=><rect key={x} x={x} y="82" width="11" height="9" fill={x%2?"#e6a52b":"#198ed5"} stroke="#fff" strokeWidth=".8"/>)}
      <path d="M24 124q10-9 20 0t20 0t20 0t20 0t20 0" fill="none" stroke={`url(#${id}-sea)`} strokeWidth="6" strokeLinecap="round"/>
    </g>}
  </svg>;
}

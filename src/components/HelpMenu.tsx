import { useEffect, useRef, useState } from 'react';
export default function HelpMenu({onSelect}:{onSelect(page:'guide'|'shortcuts'|'updates'):void}) {
  const [open,setOpen]=useState(false), trigger=useRef<HTMLButtonElement>(null), menu=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open)menu.current?.querySelector('button')?.focus();},[open]);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  return <div className="file-menu-wrap" onKeyDown={e=>e.stopPropagation()}><button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}>ヘルプ</button>{open&&<>
    <button className="menu-dismiss" aria-label="ヘルプメニューを閉じる" onClick={close}/>
    <div ref={menu} className="popup-menu file-menu" role="menu" aria-label="ヘルプ" onKeyDown={e=>{e.stopPropagation();
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(menu.current!.querySelectorAll('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='Tab')setOpen(false);
    }}>{([['guide','初めての動画編集'],['shortcuts','ショートカットキー一覧'],['updates','アップデート']] as const).map(([page,label])=><button role="menuitem" key={page} onClick={()=>{close();onSelect(page);}}>{label}</button>)}</div>
  </>}</div>;
}

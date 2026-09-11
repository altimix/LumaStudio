import { useState } from 'react';
import { shortcutCommand, type EditorCommand } from '../shortcuts';
const labels: Record<EditorCommand,string> = {
 play:'再生 / 停止',splitAll:'全トラックに編集点',trimPrevious:'前をリップルトリミング',trimNext:'後をリップルトリミング',zoomIn:'ズームイン',zoomOut:'ズームアウト',rippleDelete:'リップル削除',backFrame:'1フレーム戻る',forwardFrame:'1フレーム進む',backTen:'10フレーム戻る',forwardTen:'10フレーム進む',reverse:'逆再生',stop:'停止',forward:'順再生 / 早送り',undo:'元に戻す',redo:'やり直す',split:'選択クリップを分割',delete:'選択クリップを削除',duplicate:'複製',copy:'コピー',paste:'貼り付け',selectAll:'すべて選択',save:'保存',saveAs:'名前を付けて保存',open:'プロジェクトを開く',new:'新規プロジェクト',import:'素材を読み込む',export:'動画を書き出す',home:'先頭へ移動',end:'末尾へ移動',selectTool:'選択ツール',razorTool:'レーザーツール',snap:'スナップ切替',marker:'マーカーを追加',help:'ショートカット一覧',
};
const shortLabels: Partial<Record<EditorCommand,string>> = {trimPrevious:'前を詰める',trimNext:'後を詰める',splitAll:'全トラック分割',zoomIn:'拡大',zoomOut:'縮小',backFrame:'1コマ戻る',forwardFrame:'1コマ進む',backTen:'10コマ戻る',forwardTen:'10コマ進む',delete:'削除',selectTool:'選択',razorTool:'カット',marker:'マーカー',forward:'再生・早送り'};
const rows=[['1','2','3','4','5','6','7','8','9','0','-','=','Backspace'],['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['z','x','c','v','b','n','m'],['Home','End',' ','ArrowLeft','ArrowRight']];
export default function KeyboardDiagram({mac,setMac}:{mac:boolean;setMac(value:boolean):void}) {
 const [modifier,setModifier]=useState('normal'),[selected,setSelected]=useState(' ');
 const command=(key:string)=>shortcutCommand({key:modifier==='shift'&&key==='='?'+':key,ctrlKey:!mac&&modifier.includes('primary'),metaKey:mac&&modifier.includes('primary'),shiftKey:modifier.includes('shift'),altKey:false,isComposing:false,repeat:false});
 const display=(key:string)=>key===' '?'Space':key==='ArrowLeft'?'←':key==='ArrowRight'?'→':key==='Backspace'?(mac?'delete':'Backspace'):key.toUpperCase();
 const action=command(selected);
 return <section className="keyboard-help" aria-label="キーボード図">
 <div className="keyboard-toolbar"><div role="group" aria-label="キーボードのOS">{[true,false].map(value=><button key={String(value)} aria-pressed={mac===value} onClick={()=>setMac(value)}>{value?'Mac':'Windows'}</button>)}</div><div role="group" aria-label="組み合わせるキー">{[['normal','通常'],['shift','Shift'],['primary',mac?'⌘ Command':'Ctrl'],['primary-shift',mac?'⌘ + Shift':'Ctrl + Shift']].map(([value,label])=><button key={value} aria-pressed={modifier===value} onClick={()=>setModifier(value)}>{label}</button>)}</div></div>
 <p>色の付いたキーに機能があります。キーを選ぶと説明が表示されます。</p>
 <div className="keyboard-scroll"><div className="keyboard-keys">{rows.map((row,i)=><div className="keyboard-row" key={i}>{row.map(key=><button key={key} className={`${command(key)?'assigned':''} ${key===' '?'space-key':''}`} aria-pressed={selected===key} aria-label={`${display(key)}：${command(key)?labels[command(key)!]:'割り当てなし'}`} onClick={()=>setSelected(key)}><kbd>{display(key)}</kbd>{command(key)&&<span>{shortLabels[command(key)!] || labels[command(key)!]}</span>}</button>)}</div>)}</div></div>
 <div className="keyboard-detail" aria-live="polite"><kbd>{modifier.includes('primary')?(mac?'⌘ + ':'Ctrl + '):''}{modifier.includes('shift')?'Shift + ':''}{display(selected)}</kbd><strong>{action?labels[action]:'この組み合わせには割り当てがありません。'}</strong></div>
 <small>編集で使う主なキーを示した概略図です。記号キーやHome / Endの位置はキーボードによって異なります。すべての操作は下の一覧で確認できます。</small>
 </section>;
}

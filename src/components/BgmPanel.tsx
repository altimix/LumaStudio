import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Play, Plus, RefreshCw, Search, Square } from 'lucide-react';
import { useEditor } from '../store';
import { shortTime } from '../model';
import type { BgmLibrary } from '../types';
import { DEFAULT_BGM_VOLUME } from '../audio-volume';
import './bgm.css';

export default function BgmPanel() {
  const [library,setLibrary] = useState<BgmLibrary>({folder:null,tracks:[],errors:[],truncated:false});
  const [selected,setSelected] = useState(''), [search,setSearch] = useState(''), [volume,setVolume] = useState(DEFAULT_BGM_VOLUME * 100), [fit,setFit] = useState(true);
  const [reading,setReading] = useState(false), [busy,setBusy] = useState(false), [previewing,setPreviewing] = useState(false), [error,setError] = useState('');
  const audio = useRef<HTMLAudioElement>(null), alive = useRef(false), request = useRef<object|null>(null), scan = useRef<object|null>(null);
  const gesture = useEditor(s=>s.gestureActive);
  const stop = useCallback(()=>{request.current=null;audio.current?.pause();setPreviewing(false);setBusy(false);},[]);
  const read = useCallback(async (choose=false)=>{
    if(!window.luma)return;stop();const token={};scan.current=token;setReading(true);setError('');
    try{const result=await (choose?window.luma.chooseBgmFolder():window.luma.listBgm());if(!alive.current||scan.current!==token||!result)return;setLibrary(result);setSelected(current=>result.tracks.some(t=>t.id===current)?current:result.tracks[0]?.id||'');}
    catch(e){if(alive.current&&scan.current===token)setError((e as Error).message);}
    finally{if(alive.current&&scan.current===token)setReading(false);}
  },[stop]);
  useEffect(()=>{
    alive.current=true;const player=audio.current;void read();
    const unsubscribe=useEditor.subscribe((state,previous)=>{if(state.project!==previous.project||state.seekRevision!==previous.seekRevision||state.playing&&!previous.playing)stop();});
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')stop();};window.addEventListener('keydown',key);
    return()=>{alive.current=false;request.current=null;scan.current=null;player?.pause();player?.removeAttribute('src');player?.load();unsubscribe();window.removeEventListener('keydown',key);};
  },[read,stop]);
  useEffect(()=>{if(audio.current)audio.current.volume=volume/100;},[volume]);
  const run = async (insert:boolean,id=selected)=>{
    if(!window.luma||!id)return;
    if(!insert&&id===selected&&(previewing||busy)){stop();return;}
    stop();setSelected(id);useEditor.getState().stop();const state=useEditor.getState(), token={};request.current=token;setBusy(true);setError('');
    try{
      const asset=await window.luma.loadBgm(id);
      if(!alive.current||request.current!==token||useEditor.getState().project!==state.project||useEditor.getState().seekRevision!==state.seekRevision)return;
      if(insert){useEditor.getState().addBgm(asset,fit,volume/100);}
      else if(audio.current){const player=audio.current;player.src=asset.url;player.volume=volume/100;await player.play();if(request.current===token&&alive.current)setPreviewing(true);}
    }catch(e){if(alive.current&&request.current===token)setError((e as Error).message);}
    finally{if(alive.current&&request.current===token)setBusy(false);}
  };
  const filtered=library.tracks.filter(t=>t.relativePath.toLocaleLowerCase().includes(search.toLocaleLowerCase())), song=library.tracks.find(t=>t.id===selected);
  const folderName=library.folder?(/bundled-bgm[\\/]v[0-9]+$/.test(library.folder)?'同梱BGM':library.folder.split(/[\\/]/).filter(Boolean).at(-1)):null;
  return <div className="bgm-browser library-browser"><div className="bgm-panel"><div className="bgm-toolbar">
    <div className="bgm-folder-actions"><button className="secondary-button" aria-label="フォルダを選択" title={library.folder||'BGMフォルダを選択'} disabled={reading||gesture} onClick={()=>void read(true)}><FolderOpen size={14}/><span>{folderName||'フォルダを選択'}</span></button><span className="bgm-count">{library.tracks.length}曲</span><button className="icon-button" aria-label="BGM一覧を更新" disabled={reading||gesture} onClick={()=>void read()}><RefreshCw size={15}/></button></div>
    {!window.luma?<p role="status">BGMフォルダはデスクトップ版で利用できます。</p>:null}
    <label className="bgm-search"><Search size={14}/><input aria-label="BGMを検索" placeholder="曲名で検索" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    </div><div className="bgm-library-scroll"><div className="bgm-tracks" aria-label="BGMの曲一覧" aria-busy={reading}>
      {reading?<p role="status">BGMを読み込み中…</p>:filtered.map(t=><div key={t.id} className={'bgm-track '+(t.id===selected?'selected':'')}><button className="bgm-track-play" aria-label={`${t.name} ${t.id===selected&&(previewing||busy)?previewing?'の試聴を停止':'の読み込みを中止':'を試聴'}`} title={t.id===selected&&(previewing||busy)?'停止':'試聴'} disabled={gesture} onClick={()=>void run(false,t.id)}>{t.id===selected&&(previewing||busy)?<Square size={14}/>:<Play size={14}/>}</button><button className="bgm-track-select" aria-pressed={t.id===selected} onClick={()=>{stop();setSelected(t.id);}} title={t.relativePath}><span><strong>{t.name}</strong>{t.relativePath!==t.name?<small>{t.relativePath}</small>:null}</span><time>{shortTime(t.duration)}</time></button></div>)}
      {!reading&&!filtered.length?<p>{library.tracks.length?'検索に一致する曲がありません。':'音楽がありません。フォルダを選択してください。'}</p>:null}
    </div>
    {library.truncated?<p>表示上限です。フォルダを絞ってください。</p>:null}
    {library.errors.length?<details className="bgm-errors"><summary>読み込めなかった項目（{library.errors.length}）</summary>{library.errors.slice(0,30).map((e,i)=><p key={i}>{e}</p>)}</details>:null}
    {error?<p className="bgm-error" role="alert">{error}</p>:null}</div>
    <audio ref={audio} className="bgm-player" preload="none" onEnded={()=>{setPreviewing(false);}} onError={()=>{if(request.current){stop();setError('この曲を再生できません。フォルダと音楽ファイルを確認してください。');}}}/>
  </div><div className="bgm-actionbar"><fieldset className="bgm-options" disabled={!song||reading||gesture}>
    <label className="bgm-volume">音量 <input aria-label="追加するBGMの音量" disabled={busy} type="range" min={0} max={100} step={1} value={volume} onChange={e=>setVolume(Number(e.target.value))}/><output>{volume}%</output></label>
    <label className="bgm-length">長さ<select aria-label="BGMの追加する長さ" disabled={busy} value={fit?'fit':'full'} onChange={e=>setFit(e.target.value==='fit')} title={fit?'長い曲はカットし、短い曲は繰り返します。':'曲全体を追加します。'}><option value="fit">動画の終わりに合わせる</option><option value="full">曲をそのまま追加</option></select></label>
    <button className="primary-button bgm-insert" aria-label="BGMをタイムラインに追加" title={song?`${song.name}を再生ヘッドの位置に追加`:'曲を選んでください'} disabled={busy} onClick={()=>void run(true)}><Plus size={15}/><span>{song?`${song.name} を追加`:'BGMを追加'}</span></button>
  </fieldset></div></div>;
}

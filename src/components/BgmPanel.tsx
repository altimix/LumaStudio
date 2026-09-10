import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Music2, Play, Plus, RefreshCw, Search, Square } from 'lucide-react';
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
  const run = async (insert:boolean)=>{
    if(!window.luma||!selected)return;
    if(!insert&&(previewing||busy)){stop();return;}
    stop();useEditor.getState().stop();const state=useEditor.getState(), token={};request.current=token;setBusy(true);setError('');
    try{
      const asset=await window.luma.loadBgm(selected);
      if(!alive.current||request.current!==token||useEditor.getState().project!==state.project||useEditor.getState().seekRevision!==state.seekRevision)return;
      if(insert){useEditor.getState().addBgm(asset,fit,volume/100);}
      else if(audio.current){const player=audio.current;player.src=asset.url;player.volume=volume/100;await player.play();if(request.current===token&&alive.current)setPreviewing(true);else player.pause();}
    }catch(e){if(alive.current&&request.current===token)setError((e as Error).message);}
    finally{if(alive.current&&request.current===token)setBusy(false);}
  };
  const filtered=library.tracks.filter(t=>t.relativePath.toLocaleLowerCase().includes(search.toLocaleLowerCase())), song=library.tracks.find(t=>t.id===selected);
  return <><div className="bgm-panel">
    <div className="bgm-heading"><Music2 size={20}/><h3>動画に音楽を添える</h3></div>
    <p>曲を試聴して、再生ヘッドの位置から追加します。</p>
    <div className="bgm-folder-actions"><button className="secondary-button" disabled={reading} onClick={()=>void read(true)}><FolderOpen size={14}/>フォルダを選択</button><button className="icon-button" aria-label="BGM一覧を更新" disabled={reading} onClick={()=>void read()}><RefreshCw size={15}/></button></div>
    {library.folder?<div className="bgm-folder" title={library.folder}>{library.folder}</div>:<p>EXEと同じ場所の「bgm」フォルダを自動で探します。別の場所も選べます。</p>}
    {!window.luma?<p role="status">BGMフォルダの読み込みはデスクトップ版で利用できます。</p>:null}
    <label className="bgm-search"><Search size={14}/><input aria-label="BGMを検索" placeholder="曲名で検索" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <div className="bgm-tracks" aria-label="BGMの曲一覧" aria-busy={reading}>
      {reading?<p role="status">BGMを読み込み中…</p>:filtered.map(t=><button key={t.id} className={'bgm-track '+(t.id===selected?'selected':'')} aria-pressed={t.id===selected} onClick={()=>{stop();setSelected(t.id);}} title={t.relativePath}><Music2 size={16}/><span><strong>{t.name}</strong>{t.relativePath!==t.name?<small>{t.relativePath}</small>:null}</span><time>{shortTime(t.duration)}</time></button>)}
      {!reading&&!filtered.length?<p>{library.tracks.length?'検索に一致する曲がありません。':'音楽がありません。MP3などが入ったフォルダを選択してください。'}</p>:null}
    </div>
    <span className="bgm-count">{library.tracks.length}曲{library.truncated?'（表示上限に達しました。範囲を絞ってください）':''}</span>
    {library.errors.length?<details className="bgm-errors"><summary>読み込めなかった項目（{library.errors.length}）</summary>{library.errors.slice(0,30).map((e,i)=><p key={i}>{e}</p>)}</details>:null}
    <fieldset className="bgm-options" disabled={!song||reading||gesture}>
      <strong className="bgm-selected-name">{song?.name||'曲を選んでください'}</strong>
      <label>BGMの音量 <output>{volume}%（{volume > 0 ? (20 * Math.log10(volume / 100)).toFixed(1) + ' dB' : '無音'}）</output><input aria-label="追加するBGMの音量" disabled={busy} type="range" min={0} max={100} step={1} value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
      <p>会話中心の動画は10%（−20 dB）から。声を聞きながら調整してください。</p>
      <label>追加する長さ<select aria-label="BGMの追加する長さ" disabled={busy} value={fit?'fit':'full'} onChange={e=>setFit(e.target.value==='fit')}><option value="fit">動画の終わりに合わせる</option><option value="full">曲をそのまま追加</option></select></label>
      <p>{fit?'長い曲はカットし、短い曲は繰り返します。映像がない場合は1曲分を追加します。':'曲全体を追加します。動画より長くなる場合があります。'} 始めと終わりは自然にフェードします。</p>
    </fieldset>
    <audio ref={audio} className="bgm-player" preload="none" onEnded={()=>{setPreviewing(false);}} onError={()=>{if(request.current){stop();setError('この曲を再生できません。フォルダと音楽ファイルを確認してください。');}}}/>
    {error?<p className="bgm-error" role="alert">{error}</p>:null}
  </div><div className="bgm-actionbar"><small>{song?`${song.name} · ${volume}%`:'曲を選んでください'}</small>
    <button className="secondary-button bgm-audition" disabled={!song||reading||gesture} onClick={()=>void run(false)}>{previewing||busy?<Square size={14}/>:<Play size={14}/>} {previewing?'試聴を停止':busy?'読み込みを中止':'選択したBGMを試聴'}</button>
    <button className="primary-button bgm-insert" disabled={!song||reading||gesture||busy} onClick={()=>void run(true)}><Plus size={15}/>BGMをタイムラインに追加</button>
  </div></>;
}

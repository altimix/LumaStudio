import { useEffect, useState } from 'react';
import { Search, Plus, LayoutGrid, List, Film, Music2, Image as ImageIcon, FolderOpen, SlidersHorizontal, Type, ArrowUpRight, Play, Link2, Trash2, PanelLeftClose, LoaderCircle } from 'lucide-react';
import { useEditor } from '../store';
import { shortTime } from '../model';
import { IconButton, Waveform } from './UI';
import MediaAddMenu from './MediaAddMenu';
import TransitionPanel from './TransitionPanel';
import DrawingPanel from './DrawingPanel';
import BgmPanel from './BgmPanel';
import type { Asset, Clip } from '../types';
import './library-browser.css';

export default function MediaLibrary({ onImport, onProxy, onRelink, onRemove, importLabel, onCollapse }: { onProxy: (asset: Asset) => void; onCollapse: () => void; onImport: () => void; onRelink: (a: Asset) => void; onRemove: (id: string) => void; importLabel: string }) {
  const panel = useEditor(s => s.panel); const assets = useEditor(s => s.project.assets);
  const [fileDrag, setFileDrag] = useState(false);
  const [creatingBlack,setCreatingBlack]=useState(false);
  const addBlack=async()=>{const state=useEditor.getState();if(creatingBlack||state.gestureActive||!window.luma)return;if(state.project.assets.length>=2000){state.notify('素材は最大2000個です。');return;}const initialProject=state.project;setCreatingBlack(true);try{const asset=await window.luma.blackVideo(state.project.width,state.project.height);const current=useEditor.getState();if(current.gestureActive){current.notify('素材のドラッグ中のため追加を中止しました。ドラッグ後にもう一度追加してください。');return;}if(current.project.assets.length>=2000){current.notify('素材は最大2000個です。');return;}if(current.project!==initialProject){current.notify('プロジェクトが変更されたため追加を中止しました。もう一度追加してください。');return;}current.importAssets([asset]);setSelectedAsset(asset.id);setSearch('');setFilter('all');current.notify('ブラックビデオを追加しました。タイムラインに配置して長さを調整できます。');}catch(error){useEditor.getState().notify((error as Error).message);}finally{setCreatingBlack(false);}};
  const [search, setSearch] = useState(''); const [list, setList] = useState(true); const [filter, setFilter] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  useEffect(() => { if (!assets.some(a => a.id === selectedAsset)) setSelectedAsset(null); }, [assets, selectedAsset]);
  const preview = (id: string) => { useEditor.getState().stop(); useEditor.setState({ sourceId: id }); };
  const mediaKey = (e: React.KeyboardEvent) => {
    if (panel !== 'media' || !['Delete', 'Backspace'].includes(e.key) || e.nativeEvent.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault(); e.stopPropagation();
    if (selectedAsset && !useEditor.getState().gestureActive) onRemove(selectedAsset);
  };
  const filtered = assets.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || a.kind === filter));
  return <section className={`library-panel panel ${fileDrag ? 'file-drag-over' : ''}`} onKeyDown={mediaKey}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) setFileDrag(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDrag(false); }} onDrop={() => setFileDrag(false)}>
    <div className="library-toolbar"><div className="library-breadcrumb">{panel === 'media' ? <>プロジェクト素材 <span>{assets.length}</span></> : '素材・エフェクト'}</div><div className="library-toolbar-actions">{panel === 'media' ? <MediaAddMenu onImport={onImport} onBlack={() => { void addBlack(); }} disabled={!!importLabel || creatingBlack} blackDisabled={!window.luma}/> : null}<IconButton className="icon-button panel-collapse" label="素材パネルを折りたたむ" aria-controls="workspace-library" aria-expanded={true} onClick={onCollapse}><PanelLeftClose size={16}/></IconButton></div></div>
    <div className="library-tabs" role="tablist" aria-label="素材パネル">{[{ id: 'media', label: 'メディア', icon: FolderOpen }, { id: 'effects', label: 'エフェクト', icon: SlidersHorizontal }, { id: 'titles', label: 'テキスト', icon: Type }, { id: 'draw', label: '図形', icon: ArrowUpRight }, { id: 'bgm', label: 'BGM', icon: Music2 }].map(tab => <button key={tab.id} role="tab" aria-selected={panel === tab.id} className={panel === tab.id ? 'selected' : ''} onClick={() => useEditor.getState().setPanel(tab.id as typeof panel)}><tab.icon size={14}/>{tab.label}</button>)}</div>
    {panel === 'media' ? <><div className="media-search"><Search size={14}/><input aria-label="素材を検索" placeholder="素材を検索..." value={search} onChange={e => setSearch(e.target.value)}/><kbd>⌕</kbd></div><div className="library-controls"><select aria-label="素材の種類" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">すべての素材</option><option value="video">動画</option><option value="audio">音声</option><option value="image">画像</option></select><div><IconButton label="グリッド表示" active={!list} onClick={() => setList(false)}><LayoutGrid size={14}/></IconButton><IconButton label="リスト表示" active={list} onClick={() => setList(true)}><List size={15}/></IconButton></div></div>
      {selectedAsset ? <div className="media-selection-actions"><button className="selected-asset-add" aria-label="選択素材をタイムラインに追加" disabled={!!assets.find(a => a.id === selectedAsset)?.offline} onClick={() => { const before = useEditor.getState().project; useEditor.getState().addAsset(selectedAsset); if (useEditor.getState().project !== before) useEditor.getState().notify('素材をタイムラインに追加しました。Spaceで再生できます。'); }}><Plus size={14}/>タイムラインに追加</button><IconButton label="選択素材をプロジェクトから削除 (Delete)" onClick={() => onRemove(selectedAsset)}><Trash2 size={15}/></IconButton></div> : null}
      {selectedAsset && assets.find(a => a.id === selectedAsset)?.kind === 'video' ? <div className="media-proxy-action"><button className="secondary-button" disabled={!window.luma || !!importLabel || !!assets.find(a => a.id === selectedAsset)?.offline} onClick={() => onProxy(assets.find(a => a.id === selectedAsset)!)}>{assets.find(a => a.id === selectedAsset)?.previewProxy ? '軽量プロキシを解除' : '軽量プロキシを作成'}</button><small>プレビュー専用。書き出しは原本を使います。</small></div> : null}
      <div className={`media-grid ${list ? 'list-view' : ''}`}>{filtered.map(a => <article className={`media-card ${selectedAsset === a.id ? 'chosen' : ''} ${a.offline ? 'offline' : ''}`} key={a.id} data-asset-id={a.id} tabIndex={0} aria-label={a.name} onClick={e => { setSelectedAsset(a.id); if (!(e.target as HTMLElement).closest('button')) e.currentTarget.focus(); }} draggable={!a.offline} onDragStart={e => { setSelectedAsset(a.id); e.dataTransfer.setData('application/x-luma-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
        <div className="media-thumb-wrap"><button className={`media-thumb ${a.kind}`} aria-label={`${a.name} を選択`} aria-pressed={selectedAsset === a.id} onDoubleClick={() => preview(a.id)} onClick={() => setSelectedAsset(a.id)}>
          {a.kind === 'audio' ? <div className="audio-art"><Music2 size={23}/><Waveform values={a.waveform}/></div> : a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false}/> : <div className="missing-thumb"><Link2 size={20}/>オフライン</div>}
          <span className="asset-type">{a.kind === 'audio' ? <Music2 size={11}/> : a.kind === 'image' ? <ImageIcon size={11}/> : <Film size={11}/>}</span><span className="asset-duration">{shortTime(a.duration)}</span>
        </button><button className="asset-preview-button" aria-label={`${a.name} をプレビュー`} title="プレビュー" onClick={() => preview(a.id)}><Play size={13}/></button></div><div className="media-card-info"><span title={a.name}>{a.name}</span><small>{a.kind === 'audio' ? 'WAV / AUDIO' : a.kind === 'image' ? `${a.width} × ${a.height}` : `${a.width} × ${a.height} · ${a.fps.toFixed(0)} fps`}</small>{a.proxy ? <span className="proxy-tag">PROXY</span> : null}</div>
        <button className="asset-add" title={a.offline ? '素材を再リンク' : 'タイムラインに追加'} aria-label={`${a.name} ${a.offline ? 'を再リンク' : 'を追加'}`} onClick={() => a.offline ? onRelink(a) : useEditor.getState().addAsset(a.id)}>{a.offline ? <Link2 size={14}/> : <Plus size={14}/>}</button>
      </article>)}{filtered.length === 0 ? <div className="empty-library"><FolderOpen size={26}/><p>{assets.length ? '条件に合う素材がありません' : 'まずは動画・写真・音声を読み込みましょう'}</p>{assets.length ? <button className="text-button" onClick={() => { setSearch(''); setFilter('all'); }}>検索条件をクリア</button> : <><button className="secondary-button" disabled={!!importLabel} onClick={onImport}><Plus size={14}/>ファイルを選択</button><small>ここへドラッグしても読み込めます</small></>}</div> : null}</div>
      {importLabel || creatingBlack ? <div className="library-progress" role="status"><LoaderCircle className="spin" size={14}/><span>{importLabel || 'ブラックビデオを作成中…'}</span></div> : null}<div className="library-foot"><span>{assets.length} アイテム</span><span>ファイルをここへドロップ</span></div></> : null}
    {panel === 'effects' ? <TransitionPanel/> : null}
    {panel === 'draw' ? <DrawingPanel/> : null}
    {panel === 'bgm' ? <BgmPanel/> : null}
    {panel === 'titles' ? <div className="title-browser library-browser"><div className="library-section-scroll title-presets">{[{ style: 'hero', name: 'シネマタイトル', sample: '物語のはじまり' }, { style: 'minimal', name: 'ミニマル', sample: 'いつもの風景' }, { style: 'subtitle', name: '字幕・キャプション', sample: 'ここに字幕が入ります' }].map(t => <button className={`title-template ${t.style}`} key={t.style} aria-label={`${t.name}を追加`} title="再生ヘッドの位置に追加" onClick={() => useEditor.getState().addTitle(t.style as Clip['textStyle'])}><div><span>{t.sample}</span></div><footer><strong>{t.name}</strong><Plus size={14}/></footer></button>)}</div><div className="library-browser-hint">クリックで再生ヘッドの位置に追加</div></div> : null}
  </section>;
}

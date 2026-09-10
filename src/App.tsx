import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ExportEncoder from './components/ExportEncoder';
import EditingGuide from './components/EditingGuide';
import Toast from './components/Toast';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, Download, FolderOpen, HelpCircle, Keyboard, LoaderCircle, Plus, Save, Settings2, Upload, X, RotateCcw, HardDrive, Monitor, Film, ExternalLink } from 'lucide-react';
import { useEditor } from './store';
import { applySequenceSettings, demoProject, emptyProject, endTime, timecode, uid } from './model';
import { renderTitles } from './render';
import { ensureProjectFonts } from './fonts';
import { validateTransitions } from '../shared/transitions.mjs';
import { validateTextStyle } from '../shared/text-style.mjs';
import { validateTextBox } from '../shared/text-box.mjs';
import { validateGraphic } from '../shared/graphics.mjs';
import { validateVolumeKeys } from '../shared/volume-automation.mjs';
import type { Asset, ExportProgress, ExportSettings, Project } from './types';
import MediaLibrary from './components/MediaLibrary';
import Preview from './components/Preview';
import Inspector from './components/Inspector';
import Timeline from './components/Timeline';
import ShortcutHelp from './components/ShortcutHelp';
import HistoryPanel from './components/HistoryPanel';
import YouTubeStudio from './components/YouTubeStudio';
import { shortcutCommand, type EditorCommand } from './shortcuts';
import { IconButton, Modal } from './components/UI';
import { version } from '../package.json';

const isDesktop = !!window.luma;
function errorText(e: unknown) { const message = e instanceof Error ? e.message : String(e); return message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
function downloadJSON(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${p.name}.luma`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const p = useEditor(s => s.project); const ready = useEditor(s => s.ready); const dirty = useEditor(s => s.dirty); const toast = useEditor(s => s.toast); const panel = useEditor(s => s.panel); const tab = useEditor(s => s.inspectorTab); const savedAt = useEditor(s => s.autosavedAt); const sourceId = useEditor(s => s.sourceId);
  const [modal, setModal] = useState<'export' | 'shortcuts' | 'settings' | 'new' | 'youtube' | 'guide' | null>(null); const [fileMenu, setFileMenu] = useState(false); const [importLabel, setImportLabel] = useState(''); const [recovery, setRecovery] = useState<{ project: Project; savedAt: string } | null>(null); const [pending, setPending] = useState<(() => void) | null>(null);
  const trackMenuOpen = useEditor(s => s.trackMenuOpen);
  const [historyOpen, setHistoryOpen] = useState(false); const [windowMenu, setWindowMenu] = useState(false);
  const [savingOnClose, setSavingOnClose] = useState(false);
  const [projectBusy, setProjectBusy] = useState('');
  const projectBusyRef = useRef(false);
  const saveInFlight = useRef(false);
  const saveFinished = useRef<Promise<void>>(Promise.resolve());
  const projectOperationFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!projectBusy) {
      const previous = projectOperationFocus.current; projectOperationFocus.current = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    }
  }, [projectBusy]);
  const beginProjectOperation = (label: string) => {
    if (projectBusyRef.current) return false;
    projectOperationFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    projectOperationFocus.current?.blur();
    useEditor.getState().gestureCancel?.(); useEditor.getState().stop();
    projectBusyRef.current = true; setProjectBusy(label); return true;
  };
  const endProjectOperation = () => { projectBusyRef.current = false; setProjectBusy(''); };
  const [removeAssetId, setRemoveAssetId] = useState<string | null>(null);
  const requestRemoveAsset = (id: string) => {
    const s = useEditor.getState(), used = s.project.clips.filter(c => c.assetId === id);
    if (used.some(c => s.project.tracks.find(t => t.id === c.trackId)?.locked)) { s.notify('この素材を使用しているトラックのロックを解除してください。'); return; }
    if (used.length) { s.stop(); setRemoveAssetId(id); } else s.removeAsset(id);
  };
  const exportAttempt=useRef<{native:boolean}|null>(null);const [preparingFonts,setPreparingFonts]=useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null); const [rendering, setRendering] = useState(false); const [renderError, setRenderError] = useState('');
  const [settings, setSettings] = useState<ExportSettings>({ width: 1920, height: 1080, fps: 30, quality: 'standard' });
  const [timelineHeight, setTimelineHeight] = useState(Math.min(354, window.innerHeight * 0.38));
  const [preset, setPreset] = useState('match'); const [settingsDraft, setSettingsDraft] = useState({ name: '', width: 1920, height: 1080, fps: 30 });
  const [settingsError, setSettingsError] = useState('');
  const [newName, setNewName] = useState('新しいプロジェクト');
  const importInput = useRef<HTMLInputElement>(null); const openInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const start = async () => {
      try {
        if (window.luma) { const data = await window.luma.bootstrap(); useEditor.getState().load(data.startupProject||(data.assets.length ? demoProject(data.assets) : emptyProject())); if(data.startupError)useEditor.getState().notify(data.startupError); setRecovery(data.recovery); }
        else { const response = await fetch('./demo/manifest.json'); const assets: Asset[] = response.ok ? await response.json() : []; useEditor.getState().load(demoProject(assets)); }
      } catch (e) { useEditor.getState().load(emptyProject()); useEditor.getState().notify(errorText(e)); }
    };
    void start();
    const exportOff = window.luma?.onExportProgress(setProgress);
    const importOff = window.luma?.onImportProgress(data => setImportLabel(`${data.index}/${data.total} 読み込み中: ${data.name}`));
    return () => { exportOff?.(); importOff?.(); };
  }, []);
  useEffect(() => {
    if (!ready) return; void window.luma?.setDirty(dirty);
    if (!dirty) return;
    const timer = setTimeout(() => {
      if (window.luma) void window.luma.autosave(p).then(() => useEditor.setState({ autosavedAt: new Date().toLocaleTimeString('ja-JP') })).catch(e => useEditor.getState().notify(`自動保存に失敗しました: ${errorText(e)}`));
    }, 1500);
    return () => clearTimeout(timer);
  }, [p, dirty, ready]);
  useEffect(() => {
    const desktop = window.luma;
    return desktop?.onPrepareClose(async requestId => {
      await saveFinished.current;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await desktop.finishPrepareClose(requestId, useEditor.getState().dirty, !projectBusyRef.current && !saveInFlight.current);
    });
  }, []);
  const save = useCallback(async (saveAs = false) => {
    if (saveInFlight.current || projectBusyRef.current) return false;
    saveInFlight.current = true;
    let completeSave!: () => void;
    saveFinished.current = new Promise<void>(resolve => { completeSave = resolve; });
    const generation = useEditor.getState().projectGeneration;
    try {
      const snapshot = useEditor.getState().project;
      if (window.luma) {
        const target = await window.luma.saveProject(snapshot, saveAs); if (!target) return false;
        if (useEditor.getState().projectGeneration !== generation) { useEditor.getState().notify('以前のプロジェクトを保存しました'); return true; }
        const unchanged = useEditor.getState().project === snapshot;
        useEditor.setState({ savedPath: target, dirty: !unchanged });
        if (unchanged) { await window.luma.clearRecovery(); setRecovery(null); }
      } else { downloadJSON(snapshot); useEditor.setState({ dirty: false }); }
      useEditor.getState().notify('プロジェクトを保存しました'); return true;
    } catch (e) { useEditor.getState().notify(errorText(e)); return false; }
    finally { saveInFlight.current = false; completeSave(); }
  }, []);
  useEffect(() => {
    const desktop = window.luma;
    return desktop?.onSaveBeforeClose(async requestId => {
      useEditor.getState().stop();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setSavingOnClose(true);
      try {
        const saved = await save();
        const unchanged = !useEditor.getState().dirty;
        if (saved && !unchanged) useEditor.getState().notify('保存中に新しい変更が加わったため、編集を続けます。もう一度保存してください。');
        await desktop.finishSaveBeforeClose(requestId, saved && unchanged);
      } catch (e) { useEditor.getState().notify(errorText(e)); }
      finally { setSavingOnClose(false); }
    });
  }, [save]);
  const safely = (fn: () => void) => { if (projectBusyRef.current) return; setFileMenu(false); if (useEditor.getState().dirty) { useEditor.getState().stop(); setPending(() => fn); } else fn(); };
  const open = async () => {
    if (!beginProjectOperation('プロジェクトを開いています')) return;
    try { if (window.luma) { const result = await window.luma.openProject(); if (result) { useEditor.getState().load(result.project, result.path); setRecovery(null); } } else openInput.current?.click(); }
    catch (e) { useEditor.getState().notify(errorText(e)); }
    finally { endProjectOperation(); }
  };
  const newProject = () => { useEditor.getState().stop(); setNewName('新しいプロジェクト'); setModal('new'); };
  const createProject = (portrait: boolean) => { const fresh = emptyProject(); fresh.name = newName.trim() || '新しいプロジェクト'; fresh.width = portrait ? 1080 : 1920; fresh.height = portrait ? 1920 : 1080; useEditor.getState().load(fresh); void window.luma?.resetProjectPath().catch(e => useEditor.getState().notify(errorText(e))); setRecovery(null); setModal(null); };
  const importMedia = async (paths?: string[]) => {
    if (importLabel || projectBusyRef.current) return;
    if (!window.luma) { importInput.current?.click(); return; }
    if (!beginProjectOperation('素材を読み込んでいます')) return;
    const importProject = useEditor.getState().project.id;
    setImportLabel('素材を読み込み中…');
    try { const result = await window.luma.importMedia(paths); if (useEditor.getState().project.id !== importProject) return; if (result.assets.length) useEditor.getState().importAssets(result.assets); if (result.errors.length) useEditor.getState().notify(result.errors.join('\n')); }
    catch (e) { useEditor.getState().notify(errorText(e)); } finally { setImportLabel(''); endProjectOperation(); }
  };
  const relink = async (a: Asset) => {
    if (!window.luma) { useEditor.getState().notify('素材の再リンクはデスクトップアプリでご利用ください'); return; }
    if (!beginProjectOperation('素材を再リンクしています')) return;
    const relinkProject = useEditor.getState().project;
    try { const fresh = await window.luma.relink(a); if (useEditor.getState().project !== relinkProject) return; if (fresh) { const s = useEditor.getState(); s.commit({ ...s.project, assets: s.project.assets.map(asset => asset.id === a.id ? fresh : asset) }); } } catch (e) { useEditor.getState().notify(errorText(e)); }
    finally { endProjectOperation(); }
  };
  const showExport = () => { useEditor.getState().stop(); const project = useEditor.getState().project; setSettings({ width: project.width, height: project.height, fps: project.fps, quality: 'standard', encoder: 'auto' }); setPreset('match'); setProgress(null); setRenderError(''); setModal('export'); };
  const startExport = async () => {
    if (!window.luma) { setRenderError('MP4の書き出しはデスクトップアプリでご利用ください。'); return; }
    const attempt={native:false};exportAttempt.current=attempt;setPreparingFonts(true);
    setRendering(true); setProgress(null); setRenderError('');
    try { const project = useEditor.getState().project; await ensureProjectFonts(project);if(exportAttempt.current!==attempt)return; await document.fonts.ready;if(exportAttempt.current!==attempt)return;setPreparingFonts(false); if (settings.target === 'shorts' && (project.width * 16 !== project.height * 9 || endTime(project) > 180 + 0.000001)) throw new Error('Shortsは縦型9:16のシーケンス・3分以内で書き出せます。シーケンス設定と長さを確認してください。'); attempt.native=true;const result = await window.luma.exportProject(project, settings, renderTitles(project)); if (!result) setProgress(null); }
    catch (e) { if(exportAttempt.current===attempt)setRenderError(errorText(e)); } finally { if(exportAttempt.current===attempt){exportAttempt.current=null;setRendering(false);setPreparingFonts(false);} }
  };
  const editSettings = () => { setSettingsDraft({ name: p.name, width: p.width, height: p.height, fps: p.fps }); setSettingsError(''); setModal('settings'); };
  const saveSettings = () => {
    const editor = useEditor.getState();
    setSettingsError('');
    try { editor.commit(applySequenceSettings(editor.project, settingsDraft)); setModal(null); }
    catch (error) { setSettingsError(errorText(error)); }
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (savingOnClose || projectBusyRef.current) { e.preventDefault(); return; }
      if (useEditor.getState().clipMenuOpen) return;
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.isContentEditable || target?.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      if (!ready || modal || pending || removeAssetId || sourceId || fileMenu || windowMenu || trackMenuOpen) {
        if (e.key === 'Escape' && !rendering && modal !== 'youtube') { setModal(null); setPending(null); setRemoveAssetId(null); setFileMenu(false); setWindowMenu(false); useEditor.setState({ sourceId: null, trackMenuOpen: false }); } return;
      }
      const command = shortcutCommand(e); if (!command) { if (e.repeat && shortcutCommand(e, false)) e.preventDefault(); return; }
      const s = useEditor.getState(); if (s.gestureActive) return;
      const step = (frames: number) => { s.stop(); s.seek(Math.min(endTime(s.project), s.playhead + frames / s.project.fps)); };
      const actions: Record<EditorCommand, () => void> = {
        play: s.togglePlay, splitAll: () => s.split(s.playhead, s.project.clips.map(c => c.id)), trimPrevious: () => s.rippleTrim('previous'), trimNext: () => s.rippleTrim('next'),
        zoomIn: () => s.setZoom(s.zoom * 1.25), zoomOut: () => s.setZoom(s.zoom / 1.25), rippleDelete: () => s.remove(true),
        backFrame: () => step(-1), forwardFrame: () => step(1), backTen: () => step(-10), forwardTen: () => step(10), reverse: () => s.shuttle(-1), stop: s.stop, forward: () => s.shuttle(1),
        undo: s.undo, redo: s.redo, split: () => s.split(), delete: () => s.remove(), duplicate: s.duplicate, copy: s.copy, paste: s.paste, selectAll: () => s.select(s.project.clips.map(c => c.id)),
        save: () => { void save(); }, saveAs: () => { void save(true); }, open: () => safely(() => { void open(); }), new: () => safely(newProject), import: () => { void importMedia(); }, export: showExport,
        home: () => { s.stop(); s.seek(0); }, end: () => { s.stop(); s.seek(endTime(s.project)); }, selectTool: () => useEditor.setState({ tool: 'select' }), razorTool: () => useEditor.setState({ tool: 'razor' }), snap: () => useEditor.setState({ snapping: !s.snapping }), marker: s.addMarker, help: () => setModal('shortcuts'),
      };
      e.preventDefault(); actions[command]();
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  const source = p.assets.find(a => a.id === sourceId);
  const resizeTimeline = (e: React.PointerEvent) => { e.preventDefault(); const start = e.clientY; const height = timelineHeight; const move = (event: PointerEvent) => setTimelineHeight(Math.min(window.innerHeight - 390, Math.max(238, height + start - event.clientY))); const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); };
  const browserImport = async (files: FileList | null) => {
    if (!files) return;
    const assets: Asset[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file); const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video';
      try {
        if (kind === 'image') { const image = new Image(); image.src = url; await image.decode(); assets.push({ id: uid(), name: file.name, path: file.name, url, thumbnail: url, kind, duration: 5, width: image.width, height: image.height, fps: 0, hasAudio: false, waveform: [], size: file.size, codec: file.type }); }
        else { const element = document.createElement(kind); element.preload = 'metadata'; element.src = url; await new Promise<void>((resolve,reject) => { element.onloadedmetadata = () => resolve(); element.onerror = reject; }); if (!Number.isFinite(element.duration)) throw new Error('長さを取得できません'); assets.push({ id: uid(), name: file.name, path: file.name, url, thumbnail: '', kind, duration: element.duration, width: element instanceof HTMLVideoElement ? element.videoWidth : 0, height: element instanceof HTMLVideoElement ? element.videoHeight : 0, fps: 30, hasAudio: true, waveform: [], size: file.size, codec: file.type }); }
      } catch { URL.revokeObjectURL(url); useEditor.getState().notify(`${file.name} を再生できません。デスクトップアプリで読み込んでください。`); }
    }
    useEditor.getState().importAssets(assets);
  };
  return <div className="app" onKeyDownCapture={e => { if (projectBusyRef.current) { e.preventDefault(); e.stopPropagation(); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); if (savingOnClose || projectBusyRef.current) return; if (window.luma) void importMedia(window.luma.droppedPaths(Array.from(e.dataTransfer.files))); else void browserImport(e.dataTransfer.files); } }}>
    <div className="app-titlebar"><div className="brand"><svg width="23" height="25" viewBox="0 0 23 25" aria-hidden="true"><path d="M3 2h6v15h11v6H3z" fill="#b9d993"/><path d="m12 3 8 8h-8z" fill="#778e61"/></svg><span>Luma<span>Studio</span></span></div><div className="app-menu"><div className="file-menu-wrap"><button onClick={() => { setWindowMenu(false); setFileMenu(!fileMenu); }}>ファイル</button>{fileMenu ? <><button className="menu-dismiss" aria-label="メニューを閉じる" onClick={() => setFileMenu(false)}/><div className="popup-menu file-menu"><button onClick={() => safely(newProject)}><Plus size={14}/>新規プロジェクト<kbd>Ctrl N</kbd></button><button onClick={() => safely(() => { void open(); })}><FolderOpen size={14}/>プロジェクトを開く<kbd>Ctrl O</kbd></button><hr/><button onClick={() => { void save(); setFileMenu(false); }}><Save size={14}/>保存<kbd>Ctrl S</kbd></button><button onClick={() => { void save(true); setFileMenu(false); }}><Save size={14}/>名前を付けて保存</button><hr/><button onClick={() => { void importMedia(); setFileMenu(false); }}><Upload size={14}/>素材を読み込む<kbd>Ctrl I</kbd></button><button onClick={() => { showExport(); setFileMenu(false); }}><Download size={14}/>動画を書き出す<kbd>Ctrl E</kbd></button></div></> : null}</div><button onClick={() => setModal('shortcuts')}>編集</button><button onClick={editSettings}>シーケンス</button><div className="file-menu-wrap"><button aria-expanded={windowMenu} onClick={() => { setFileMenu(false); setWindowMenu(!windowMenu); }}>ウィンドウ</button>{windowMenu ? <><button className="menu-dismiss" aria-label="ウィンドウメニューを閉じる" onClick={() => setWindowMenu(false)}/><div className="popup-menu file-menu"><button aria-pressed={historyOpen} onClick={() => { setHistoryOpen(!historyOpen); setWindowMenu(false); }}>ヒストリー{historyOpen ? <Check size={14}/> : null}</button></div></> : null}</div><button onClick={() => setModal('guide')}>ヘルプ</button></div><div className="titlebar-center">{p.name}{dirty ? <span className="unsaved-dot"/> : null}</div><span className="titlebar-version">{isDesktop ? version : 'BROWSER PREVIEW'}</span></div>
    <header className="workspace-header"><div className="project-heading"><span className="project-folder"><Film size={19}/></span><div><button onClick={editSettings}>{p.name}<ChevronDown size={12}/></button><span>{isDesktop ? 'ローカルプロジェクト' : 'ブラウザプレビュー'} <span> / </span> シーケンス 01</span></div></div><nav className="workspace-tabs" aria-label="ワークスペース">{[{ label: '編集', active: panel === 'media' && tab === 'video', action: () => { useEditor.setState({ panel: 'media', inspectorTab: 'video' }); } }, { label: 'カラー', active: tab === 'color', action: () => { useEditor.setState({ panel: 'effects', inspectorTab: 'color' }); } }, { label: 'オーディオ', active: tab === 'audio', action: () => useEditor.setState({ panel: 'media', inspectorTab: 'audio' }) }, { label: 'テキスト', active: panel === 'titles', action: () => useEditor.setState({ panel: 'titles', inspectorTab: 'video' }) }, { label: 'YouTube', active: modal === 'youtube', action: () => { useEditor.getState().stop(); setModal('youtube'); } }].map(w => <button className={w.active ? 'active' : ''} key={w.label} onClick={w.action}>{w.label}</button>)}</nav><div className="header-actions"><button className="text-button guide-open" onClick={() => { useEditor.getState().stop(); setModal('guide'); }}><HelpCircle size={15}/>使い方</button><IconButton label="プロジェクトを保存 (Ctrl+S)" onClick={() => { void save(); }}><Save size={17}/></IconButton><button className="import-button" onClick={() => { void importMedia(); }} disabled={!!importLabel}><Plus size={15}/>読み込み</button><button className="primary-button export-button" onClick={showExport} disabled={!p.clips.length}><Download size={15}/>書き出し<ArrowUpRight size={14}/></button></div></header>
    {recovery ? <div className="recovery-banner"><RotateCcw size={14}/><span>前回の自動保存があります：{recovery.project.name}</span><button onClick={() => { useEditor.getState().load(recovery.project); useEditor.setState({ dirty: true }); void window.luma?.resetProjectPath(true).catch(e => useEditor.getState().notify(errorText(e))); setRecovery(null); }}>復元する</button><IconButton label="この自動保存を破棄" onClick={() => { void window.luma?.clearRecovery(recovery.savedAt).then(() => setRecovery(null)).catch(e => useEditor.getState().notify(errorText(e))); }}><X size={13}/></IconButton></div> : null}
    <main className="workspace"><MediaLibrary onRemove={requestRemoveAsset} onImport={() => { void importMedia(); }} onRelink={a => { void relink(a); }} importLabel={importLabel}/><Preview/><Inspector/></main>
    <div className="workspace-resizer" role="separator" aria-label="タイムラインの高さを変更" aria-orientation="horizontal" onPointerDown={resizeTimeline}><span/></div>
    <div className="timeline-container" style={{ height: timelineHeight }}><Timeline onImport={() => { void importMedia(); }}/></div>
    <footer className="statusbar"><div><span className="green-dot"/><span>{importLabel || (rendering ? '動画を書き出し中' : '編集の準備ができています')}</span>{savedAt && dirty ? <><span className="status-divider"/><Check size={11}/><span>自動保存 {savedAt}</span></> : null}</div><div><HardDrive size={11}/><span>素材はこのPCに保存</span><span className="status-divider"/><button onClick={() => setModal('shortcuts')}><Keyboard size={12}/>ショートカット</button><span className="status-divider"/><span>LUMA STUDIO</span></div></footer>
    {!ready ? <div className="loading-screen"><div className="loading-brand">Luma Studio</div><LoaderCircle className="spin"/><span>編集ワークスペースを準備しています…</span></div> : null}
    {toast ? <Toast message={toast} onClose={()=>useEditor.setState({toast:''})}/> : null}
    {removeAssetId ? <Modal title="使用中の素材を削除" onClose={() => setRemoveAssetId(null)}><p className="modal-description">「{p.assets.find(a => a.id === removeAssetId)?.name}」と、この素材を使用している{p.clips.filter(c => c.assetId === removeAssetId).length}個のクリップをプロジェクトから削除します。元のファイルはPCに残ります。Ctrl+Zで元に戻せます。</p><div className="modal-footer"><button className="secondary-button" onClick={() => setRemoveAssetId(null)}>キャンセル</button><button className="primary-button" onClick={() => { useEditor.getState().removeAsset(removeAssetId, true); setRemoveAssetId(null); }}>素材と使用クリップを削除</button></div></Modal> : null}
    {source ? <Modal title={source.name} wide onClose={() => useEditor.setState({ sourceId: null })}><div className="source-monitor">{source.offline ? <p>素材が見つかりません。メディアパネルから再リンクしてください。</p> : source.kind === 'image' ? <img src={source.url} alt={source.name}/> : source.kind === 'audio' ? <audio controls src={source.url}/> : <video controls src={source.url}/>}</div><div className="modal-footer"><span>{source.width ? `${source.width} × ${source.height} · ` : ''}{timecode(source.duration, p.fps)}</span><button className="primary-button" disabled={source.offline} onClick={() => { useEditor.getState().addAsset(source.id); useEditor.setState({ sourceId: null }); }}><Plus size={15}/>タイムラインに追加</button></div></Modal> : null}
    {pending ? <Modal title="変更を保存しますか？" onClose={() => setPending(null)}><p className="modal-description">現在のプロジェクトに未保存の変更があります。</p><div className="modal-footer"><button className="secondary-button" onClick={() => setPending(null)}>キャンセル</button><button className="secondary-button" onClick={() => { pending(); setPending(null); }}>保存しないで続行</button><button className="primary-button" onClick={async () => { if (await save()) { pending(); setPending(null); } }}>保存して続行</button></div></Modal> : null}
    {modal === 'youtube' ? <YouTubeStudio onClose={() => setModal(null)}/> : null}
    {modal === 'new' ? <Modal title="新規プロジェクト" onClose={() => setModal(null)}><div className="new-project-form"><label>プロジェクト名<input aria-label="新規プロジェクト名" maxLength={120} value={newName} onChange={e => setNewName(e.target.value)}/></label><p>編集を始める前に、動画の向きを選んでください。</p><div className="format-choices"><button onClick={() => createProject(false)}><span className="format-shape landscape"/><strong>YouTube 横動画</strong><span>1920 × 1080 · 16:9 · 30fps</span></button><button onClick={() => createProject(true)}><span className="format-shape portrait"/><strong>YouTube Shorts</strong><span>1080 × 1920 · 9:16 · 30fps</span></button></div><p>画面サイズは後から「シーケンス」で変更できます。</p></div></Modal> : null}
    {modal === 'shortcuts' ? <ShortcutHelp onClose={() => setModal(null)}/> : null}
    {historyOpen ? <HistoryPanel onClose={() => setHistoryOpen(false)}/> : null}
    {modal === 'settings' ? <Modal title="シーケンス設定" onClose={() => setModal(null)}><div className="settings-form"><label>プロジェクト名<input value={settingsDraft.name} maxLength={120} onChange={e => setSettingsDraft({ ...settingsDraft, name: e.target.value })}/></label><label>フレームサイズ<select value={`${settingsDraft.width}x${settingsDraft.height}`} onChange={e => { const [width,height] = e.target.value.split('x').map(Number); setSettingsDraft({ ...settingsDraft, width, height }); }}><option value="1920x1080">YouTube 横動画 — 1920 × 1080 (16:9)</option><option value="3840x2160">4K UHD — 3840 × 2160 (16:9)</option><option value="1280x720">HD — 1280 × 720 (16:9)</option><option value="1080x1920">YouTube Shorts — 1080 × 1920 (9:16)</option><option value="1080x1080">スクエア — 1080 × 1080 (1:1)</option></select></label><label>フレームレート<select aria-label="シーケンスのフレームレート" value={settingsDraft.fps} onChange={e => setSettingsDraft({ ...settingsDraft, fps: Number(e.target.value) })}>{[24,25,30,50,60].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label></div>{settingsError ? <div className="export-error" role="alert">{settingsError}</div> : null}<div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>キャンセル</button><button className="primary-button" onClick={saveSettings}>設定を適用</button></div></Modal> : null}
    {modal === 'guide' ? <Modal title="はじめての動画編集" onClose={() => setModal(null)}><EditingGuide hasClips={p.clips.length > 0} onImport={() => { setModal(null); void importMedia(); }} onTitles={() => { setModal(null); useEditor.setState({ panel:'titles', inspectorTab:'video' }); }} onExport={showExport} onNew={() => { setModal(null); safely(newProject); }} onShortcuts={() => setModal('shortcuts')}/></Modal> : null}
    {modal === 'export' ? <Modal title="動画を書き出す" onClose={() => { if (!rendering) setModal(null); }}><div className="export-intro"><span className="export-icon"><Film size={24}/></span><div><h3>{p.name}</h3><p>H.264 / MP4 <span>·</span> AAC ステレオ <span>·</span> {timecode(endTime(p),p.fps)}</p></div></div>
      {progress?.status === 'complete' ? <div className="export-success"><CheckCircle2 size={46}/><h3>書き出しが完了しました</h3><p>{progress.output}</p>{progress.encoderLabel ? <p className="export-encoder-used">使用した方式：{progress.encoderLabel}</p> : null}{progress.warning ? <p className="export-fallback-note">GPUを使用できなかったため、CPUで書き出しました。</p> : null}<button className="primary-button" onClick={() => { void window.luma?.reveal(progress.output); }}><FolderOpen size={16}/>保存先を開く</button></div> : <><fieldset className="settings-form" disabled={rendering}><label>書き出しサイズ<select aria-label="書き出しサイズ" value={preset} onChange={e => { const target = e.target.value; setPreset(target); if (target === 'youtube' || target === 'shorts') { setSettings({ ...settings, width: target === 'shorts' ? 1080 : 1920, height: target === 'shorts' ? 1920 : 1080, target }); return; } const portrait = p.height > p.width; const square = p.height === p.width; const [w,h] = e.target.value === 'match' ? [p.width,p.height] : e.target.value === '720' ? [1280,720] : e.target.value === '4k' ? [3840,2160] : [1920,1080]; setSettings({ ...settings, target: undefined, width: e.target.value === 'match' ? w : square ? h : portrait ? h : w, height: e.target.value === 'match' ? h : square ? h : portrait ? w : h }); }}><option value="match">シーケンスに一致 — {p.width} × {p.height}</option><option value="youtube">YouTube 横動画 — 1920 × 1080</option><option value="shorts">YouTube Shorts — 1080 × 1920・3分以内</option><option value="1080">1080p / フルHD</option><option value="720">720p / HD</option><option value="4k">2160p / 4K UHD</option></select></label><div className="form-columns"><label>フレームレート<select aria-label="書き出しフレームレート" value={settings.fps} onChange={e => setSettings({ ...settings, fps: Number(e.target.value) })}>{[24,25,30,50,60].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label><label>品質<select aria-label="品質" value={settings.quality} onChange={e => setSettings({ ...settings, quality: e.target.value as ExportSettings['quality'] })}><option value="standard">標準 — バランス</option><option value="high">高画質 — 細部を優先</option><option value="draft">ドラフト — 高速</option></select></label></div><ExportEncoder value={settings.encoder || 'auto'} onChange={encoder => setSettings({ ...settings, encoder })}/></fieldset><div className="export-specs"><span>映像サイズ <strong>{settings.width} × {settings.height}</strong></span><span>オーディオ <strong>48 kHz / 192 kbps</strong></span></div>
      {rendering ? <div className="export-progress" role="status"><div><span><LoaderCircle className="spin" size={15}/>{preparingFonts?'日本語フォントを準備しています…':progress?.status === 'preparing' ? '音声と書き出し方式を準備しています…' : progress ? '映像を書き出しています…' : '保存先と素材を準備しています…'}</span><strong>{Math.round((progress?.progress || 0) * 100)}%</strong></div><progress value={progress?.progress || 0} max="1"/><small>{progress?.encoderLabel || '編集内容と音声を1本の動画にまとめています。'}</small>{progress?.warning ? <p className="export-fallback-note">{progress.warning}</p> : null}</div> : null}
      {renderError ? <div className="export-error" role="alert">{renderError}</div> : null}<div className="modal-footer"><span className="export-local"><HardDrive size={13}/>このPCで処理</span>{rendering ? <button className="secondary-button" onClick={() => { if(exportAttempt.current?.native){void window.luma?.cancelExport();}else{exportAttempt.current=null;setRendering(false);setPreparingFonts(false);setRenderError('書き出しをキャンセルしました。');} }}>書き出しを中止</button> : <button className="primary-button" disabled={!p.clips.length} onClick={() => { void startExport(); }}><Download size={16}/>保存先を選んで書き出す</button>}</div></>}
    </Modal> : null}

    <input ref={importInput} hidden type="file" multiple accept="video/*,audio/*,image/*" onChange={e => { void browserImport(e.target.files); e.target.value = ''; }}/><input ref={openInput} hidden type="file" accept=".luma" onChange={async e => { const file = e.target.files?.[0]; if (file) { try { const project = JSON.parse(await file.text()) as Project; if (project.version !== 1 || !Array.isArray(project.clips) || !Array.isArray(project.assets)) throw new Error('プロジェクト形式が不正です'); validateTransitions(project); project.clips.forEach(c => { validateGraphic(c); validateVolumeKeys(c); validateTextBox(c); if (c.kind === 'title') validateTextStyle(c); }); project.assets = project.assets.map(a => a.url.startsWith('blob:') ? { ...a, offline: true, url: '' } : a); useEditor.getState().load(project); } catch (error) { useEditor.getState().notify(errorText(error)); } } e.target.value = ''; }}/>
    {projectBusy && !savingOnClose ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={projectBusy} tabIndex={-1} ref={element => { element?.focus(); }}><div className="modal-heading"><h2>{projectBusy}</h2></div><p role="status"><LoaderCircle size={16} className="spin"/> 処理が終わるまでお待ちください。</p></section></div> : null}
    {savingOnClose ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="プロジェクトを保存しています" tabIndex={-1} ref={element => { element?.focus(); }} onKeyDown={e => { e.preventDefault(); e.stopPropagation(); }}><div className="modal-heading"><h2>プロジェクトを保存しています</h2></div><p role="status"><LoaderCircle size={16} className="spin"/> 保存が完了すると終了します。</p></section></div> : null}
  </div>;
}

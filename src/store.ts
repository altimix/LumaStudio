import { trackDeletionReason } from './track-editing';
import { separateOverlappingClips } from './track-placement';
import { resetAudioMeter } from './meter-store';
import { captionStyle, captionBottomY, reflowEditedCaptions } from './caption-style';
import type { SoundId } from '../shared/sounds.mjs';
import { create } from 'zustand';
import type { Asset, Clip, Project, Track, Graphic, TransitionOptions } from './types';
import { uid, endTime, makeClip, makeTrack, emptyProject, normalizeClip, roundFrame, splitClip, rippleTrim } from './model';
import { validateOpacityKeys, windowOpacity } from '../shared/opacity.mjs';
import { retimeVolume, validateVolumeKeys } from '../shared/volume-automation.mjs';
import { validateTextStyle } from '../shared/text-style.mjs';
import { validateGraphic, SHAPE_NAMES } from '../shared/graphics.mjs';
import { boundedZoom, MAX_MEDIA_SECONDS } from '../shared/time.mjs';
import { applyTransition, pruneTransitions } from '../shared/transitions.mjs';
import { linkedIds, clipsLocked, cloneLinkedClips, syncLinkedEdits } from '../shared/clip-links.mjs';
import { separateAudio, relinkAudio, patchAudio } from './linked-editing';
import { applyBgmVolume } from './audio-volume';
import { insertBgm } from './bgm';
import { deleteTimelineGap, rippleGapTime } from './gap-editing';
export type Panel = 'media' | 'effects' | 'titles' | 'draw' | 'bgm';
type EditorState = {
  activeVolumePoint: {clipId:string;time:number}|null;
  addBgm(asset:Asset,fit:boolean,volume:number):boolean;
  setBgmVolumeDb(db:number,ids?:string[]):void;
  separateAudio(ids?:string[],link?:boolean):void; unlink(ids?:string[]):void; relink(ids?:string[]):void; setRate(speed:number,ids?:string[]):void; patchAudio(patch: { audioTreatment?:'speech'|'normalize'; audioMuted?:boolean },ids?:string[]):void;
  historyPlayheads:(number|null)[]; futurePlayheads:(number|null)[]; clipMenuOpen:boolean;
  addTransition(options:TransitionOptions,fromId?:string,toId?:string):void; removeTransition(id:string):void;
  drawTool: Graphic['shape'] | null; drawSettings: { color:string; duration:number; sound:'none'|SoundId; volume:number };
  addDrawing(input:Pick<Clip,'graphic'|'x'|'y'|'rotation'|'color'|'duration'>&{start?:number},sound?:Asset,volume?:number):boolean;
  projectGeneration: number; project: Project; selected: string[]; playhead: number; seekRevision: number; playing: boolean; shuttleRate: number; zoom: number; snapping: boolean; tool: 'select' | 'razor' | 'rate';
  panel: Panel; inspectorTab: 'video' | 'color' | 'audio'; history: Project[]; future: Project[]; historyLabels: string[]; futureLabels: string[]; currentAction: string; dirty: boolean; savedPath: string | null; clipboard: Clip[];
  toast: string; sourceId: string | null; ready: boolean; autosavedAt: string; previewQuality: number; safeGuides: boolean; gestureActive: boolean; gestureOwner:object|null; gestureCancel:(()=>void)|null; beginGesture(owner:object,cancel:()=>void):boolean; endGesture(owner:object):void; trackMenuOpen: boolean;
  load(p: Project, savedPath?: string): void; commit(p: Project, label?: string, undoPlayhead?: number): boolean; place(p: Project, label: string): boolean; checkpoint(label?: string): void; transient(p: Project, baseline?: Project): void;
  select(ids: string[]): void; seek(t: number): void; togglePlay(): void; stop(): void; shuttle(direction: -1 | 1): void; setZoom(n: number): void;
  setPanel(p: Panel): void; setInspectorTab(p: EditorState['inspectorTab']): void;
  updateClip(id: string, patch: Partial<Clip>): void; updateTrack(id: string, patch: Partial<Track>): void;
  importAssets(assets: Asset[]): void; removeAsset(id: string, removeUsed?: boolean): void; addAsset(id: string, at?: number, trackId?: string): void; addTitle(style?: Clip['textStyle']): void;
  split(at?: number, ids?: string[]): void; remove(ripple?: boolean): void; duplicate(): void; copy(): void; paste(): void;
  removeGap(trackId: string, time: number): void;
  rippleTrim(direction: 'previous' | 'next'): void; undo(): void; redo(): void; restoreHistory(index: number): void; addTrack(kind: Track['kind']): void; removeTrack(id: string): boolean; addMarker(): void; removeMarker(id: string): void;
  notify(message: string): void;
};
let toastTimer: ReturnType<typeof setTimeout>;
function volumeSelectionAfterEdit(s: EditorState, next: Project) {
  const point=s.activeVolumePoint;if(!point)return null;
  const before=s.project.clips.find(c=>c.id===point.clipId),after=next.clips.find(c=>c.id===point.clipId);
  if(!before||!after||before.in!==after.in||before.duration!==after.duration||before.speed!==after.speed||before.assetId!==after.assetId)return null;
  const times=after.volumeKeyframes?.length?after.volumeKeyframes.map(k=>k.time):[0,after.duration];
  return times.some(time=>Math.abs(time-point.time)<1e-7)?point:null;
}
const MAX_ITEMS = 2000;
function capacity(current: number, added: number, label = 'クリップ') {
  if (current + added <= MAX_ITEMS) return true;
  useEditor.getState().notify(`${label}は最大${MAX_ITEMS}個です。追加数を減らしてください。`);
  return false;
}
export const useEditor = create<EditorState>((set, get) => ({
  addBgm:(asset,fit,volume)=>{
    const s=get();if(s.gestureActive){s.notify('ドラッグ中の編集を完了してください。');return false;}
    try{const result=insertBgm(s.project,asset,s.playhead,fit,volume);if(!s.place(result.project,'BGMを追加'))return false;s.stop();set({activeVolumePoint:null,selected:result.ids,inspectorTab:'audio',sourceId:null});s.notify(`BGMを追加しました${result.repeats>1?`（${result.repeats}回の繰り返し）`:''}。右側で音量とフェードを調整できます。`);return true;}
    catch(error){s.notify((error as Error).message);return false;}
  },
  addTransition:(options,fromId,toId)=>{
    const s=get(),p=s.project;
    if(!fromId||!toId){
      const selected=p.clips.filter(c=>s.selected.includes(c.id)).sort((a,b)=>a.start-b.start);
      if(selected.length===2){fromId=selected[0].id;toId=selected[1].id;}
      else if(selected.length===1){
        const lane=p.clips.filter(c=>c.trackId===selected[0].trackId).sort((a,b)=>a.start-b.start),i=lane.indexOf(selected[0]);
        if(i===0){s.notify('前のクリップがありません。切り替え先のクリップ、または隣り合う2つのクリップを選択してください。');return;}
        fromId=lane[i-1]?.id;toId=selected[0].id;
      }
    }
    if(!fromId||!toId){s.notify('同じトラックで隣り合う2つのクリップ、または切り替え先のクリップを選択してください。');return;}
    try{const next=applyTransition(p,fromId,toId,options,uid());s.stop();s.commit(next,'トランジションを追加');s.select([toId]);s.seek(next.clips.find(c=>c.id===toId)!.start);s.notify('トランジションを追加しました。重なる区間を再生して確認できます。');}catch(error){s.notify((error as Error).message);}
  },
  removeTransition:id=>{const s=get(),t=s.project.transitions?.find(t=>t.id===id);if(!t)return;if(clipsLocked(s.project,[t.fromId,t.toId])){s.notify('トラックのロックを解除してください。');return;}s.commit({...s.project,transitions:s.project.transitions!.filter(t=>t.id!==id)},'トランジションを削除');s.notify('つなぎ目の効果を削除しました。素材の配置や動画の長さは変わりません。');},
  drawTool:null,drawSettings:{color:'#ff0000',duration:3,sound:'chime',volume:.9},
  addDrawing:(input,sound,volume=.9)=>{
    const s=get(),p=s.project,track=p.tracks.find(t=>t.kind==='video'&&!t.locked&&!t.hidden);
    if(!track){s.notify('図形を置く映像トラックを表示し、ロックを解除してください。');return false;}
    if(!input.graphic||!capacity(p.clips.length,sound?2:1)||!capacity(p.assets.length,sound&&!p.assets.some(a=>a.id===sound.id)?1:0,'素材'))return false;
    let tracks=p.tracks,soundTrack=tracks.find(t=>t.kind==='audio'&&t.name==='効果音'&&!t.locked);
    if(sound&&!soundTrack){if(tracks.length<24){soundTrack=makeTrack('audio','効果音');tracks=[...tracks,soundTrack];}else soundTrack=tracks.find(t=>t.kind==='audio'&&!t.locked);if(!soundTrack){s.notify('効果音を追加する音声トラックのロックを解除してください。');return false;}}
    const clip=normalizeClip({...makeClip(track.id,s.playhead),...input,text:'',name:SHAPE_NAMES[input.graphic.shape],textStyle:'minimal',textShadow:false},p);
    try{validateGraphic(clip);}catch(error){s.notify((error as Error).message);return false;}
    const assets=sound&&!p.assets.some(a=>a.id===sound.id)?[...p.assets,sound]:p.assets;
    const audio=sound?normalizeClip({...makeClip(soundTrack!.id,clip.start,sound),volume}, {...p,assets}):undefined;
    if(!s.place({...p,tracks,assets,clips:[...p.clips,clip,...(audio?[audio]:[])]},audio?'図形と効果音を追加':'図形を追加'))return false;
    set({activeVolumePoint:null,selected:[clip.id],inspectorTab:'video',drawTool:null});return true;
  },
  activeVolumePoint:null, historyPlayheads:[], futurePlayheads:[], clipMenuOpen:false,
  separateAudio:(ids,link=true)=>{const s=get();try {s.commit(separateAudio(s.project,ids||s.selected,link),'映像と音声を分離');}catch(e){s.notify((e as Error).message);}},
  unlink:ids=>{const s=get();try{ids=ids||s.selected;let p=s.project;if(p.clips.some(c=>ids!.includes(c.id)&&c.kind==='video'&&!c.audioDetached&&p.assets.find(a=>a.id===c.assetId)?.hasAudio))p=separateAudio(p,ids,false);const targets=linkedIds(p,ids);if(clipsLocked(p,targets))throw Error('リンク相手を含むトラックのロックを解除してください。');s.commit({...p,clips:p.clips.map(c=>targets.includes(c.id)?{...c,linkId:undefined}:c)},'映像と音声のリンクを解除');}catch(e){s.notify((e as Error).message);}},
  relink:ids=>{const s=get();try{s.commit(relinkAudio(s.project,ids||s.selected),'映像と音声を再リンク');}catch(e){s.notify((e as Error).message);}},
  patchAudio:(patch,ids)=>{const s=get();try{s.commit(patchAudio(s.project,ids||s.selected,patch),patch.audioMuted!==undefined?'クリップのミュートを変更':'音声の自動調整を解除');}catch(e){s.notify((e as Error).message);}},
  setBgmVolumeDb:(db,ids)=>{
    const s=get();
    try {
      const next=applyBgmVolume(s.project,ids||s.selected,db);
      if(next!==s.project && s.commit(next,`BGM音量を${db} dBに設定`))s.notify(`BGM音量を${db} dBに設定しました。`);
    } catch(e){s.notify((e as Error).message);}
  },
  setRate:(speed,ids)=>{const s=get(),targets=linkedIds(s.project,ids||s.selected);if(!Number.isFinite(speed)||speed<.25||speed>4)return;if(clipsLocked(s.project,targets)){s.notify('リンク相手を含むトラックのロックを解除してください。');return;}s.commit({...s.project,clips:s.project.clips.map(c=>targets.includes(c.id)&&['video','audio'].includes(c.kind)?normalizeClip({...c,speed,duration:c.duration*c.speed/speed,fadeIn:c.fadeIn*c.speed/speed,fadeOut:c.fadeOut*c.speed/speed,...(c.volumeKeyframes?{volumeKeyframes:retimeVolume(c,{in:c.in,speed,duration:c.duration*c.speed/speed})}:{})},s.project):c)},'再生速度を変更');},
  projectGeneration: 0, project: emptyProject(), selected: [], playhead: 2.4, seekRevision: 0, playing: false, shuttleRate: 1, zoom: 48, snapping: true, tool: 'select', panel: 'media', inspectorTab: 'video',
  history: [], future: [], historyLabels: [], futureLabels: [], currentAction: '開始', dirty: false, savedPath: null, clipboard: [], toast: '', sourceId: null, ready: false, autosavedAt: '', previewQuality: 0.5, safeGuides: false, gestureActive: false, gestureOwner:null, gestureCancel:null, trackMenuOpen: false,
  beginGesture:(owner,cancel)=>{if(get().gestureActive)return false;set({gestureActive:true,gestureOwner:owner,gestureCancel:cancel});return true;},
  endGesture:owner=>{if(get().gestureOwner===owner)set({gestureActive:false,gestureOwner:null,gestureCancel:null});},
  load: (p, savedPath) => {get().gestureCancel?.();set(s => ({ projectGeneration: s.projectGeneration + 1, project: p, activeVolumePoint:null, historyPlayheads:[], futurePlayheads:[], clipMenuOpen:false, drawTool:null, savedPath: savedPath || null, selected: p.clips.filter(c => c.kind === 'video').slice(0,1).map(c => c.id), playhead: Math.min(2.4, endTime(p)), zoom: boundedZoom(s.zoom, endTime(p)), seekRevision: s.seekRevision + 1, playing: false, shuttleRate: 1, history: [], future: [], historyLabels: [], futureLabels: [], currentAction: '開始', dirty: false, ready: true, gestureActive: false, gestureOwner:null, gestureCancel:null, trackMenuOpen: false, sourceId: null, clipboard: [] }));resetAudioMeter();},
  place: (p,label) => {
    const s=get();if(s.gestureActive){s.notify('ドラッグ中の編集を完了してください。');return false;}
    const existing=new Set(s.project.clips.map(c=>c.id));
    try { return s.commit(separateOverlappingClips(p,p.clips.filter(c=>!existing.has(c.id)).map(c=>c.id)),label); }
    catch(error){s.notify((error as Error).message);return false;}
  },
  commit: (p, label = 'クリップのプロパティを変更', undoPlayhead) => {
    const s=get(); try {p=pruneTransitions(syncLinkedEdits(s.project,p,uid));} catch(e){s.notify((e as Error).message);return false;}
    set({project:p,activeVolumePoint:volumeSelectionAfterEdit(s,p),zoom:boundedZoom(s.zoom,Math.max(endTime(p),s.playhead)),history:[...s.history.slice(-79),s.project],historyPlayheads:[...s.historyPlayheads.slice(-79),undoPlayhead??null],historyLabels:[...s.historyLabels.slice(-79),s.currentAction],currentAction:label,future:[],futurePlayheads:[],futureLabels:[],dirty:true});return true;
  },
  checkpoint: (label = 'プロパティを変更') => set(s => ({ history: [...s.history.slice(-79), s.project], historyPlayheads:[...s.historyPlayheads.slice(-79),null], historyLabels: [...s.historyLabels.slice(-79), s.currentAction], currentAction: label, future: [], futurePlayheads:[], futureLabels: [], dirty: true })),
  transient: (p,baseline) => {const s=get();try{p=reflowEditedCaptions(baseline||s.project,p);p=pruneTransitions(syncLinkedEdits(baseline||s.project,p,uid));set({project:p,activeVolumePoint:volumeSelectionAfterEdit(s,p),zoom:boundedZoom(s.zoom,Math.max(endTime(p),s.playhead)),dirty:true});}catch(e){s.notify((e as Error).message);}},
  select: selected => set(s=>({ selected, activeVolumePoint:selected.length===1&&selected[0]===s.activeVolumePoint?.clipId?s.activeVolumePoint:null })),
  seek: t => { if (Number.isFinite(t)) set(s => ({ playhead: Math.max(0, Math.min(MAX_MEDIA_SECONDS, roundFrame(t, s.project.fps))), zoom: boundedZoom(s.zoom, Math.max(endTime(s.project), Math.min(MAX_MEDIA_SECONDS, t))), seekRevision: s.seekRevision + 1 })); },
  togglePlay: () => set(s => ({ playing: endTime(s.project) > 0 && !s.playing, shuttleRate: 1, zoom: boundedZoom(s.zoom, endTime(s.project)), playhead: s.playhead >= endTime(s.project) ? 0 : s.playhead })),
  stop: () => set({ playing: false, shuttleRate: 1 }),
  shuttle: direction => set(s => {
    const total = endTime(s.project); if (!total) return { playing: false, shuttleRate: 1 };
    const speed = s.playing && Math.sign(s.shuttleRate) === direction ? Math.min(16, Math.abs(s.shuttleRate) * 2) : 1;
    return { playing: true, shuttleRate: direction * speed, zoom: boundedZoom(s.zoom, total), playhead: direction > 0 && s.playhead >= total ? 0 : direction < 0 && s.playhead <= 0 ? total : Math.min(total, s.playhead) };
  }),
  setZoom: zoom => { if (Number.isFinite(zoom)) set(s => ({ zoom: boundedZoom(zoom, Math.max(endTime(s.project), s.playhead)) })); },
  setPanel: panel => set({ panel }), setInspectorTab: inspectorTab => set({ inspectorTab }),
  updateClip: (id, patch) => {
    const s = get(); const clip = s.project.clips.find(c => c.id === id);
    if (!clip || s.project.tracks.find(t => t.id === clip.trackId)?.locked) return;
    const next = { ...clip, ...patch };
    if (next.captionAutoPosition && (['x','y','scale','rotation','textBox'].some(key=>Object.hasOwn(patch,key)) || next.textStyle!=='subtitle')) next.captionAutoPosition=false;
    if (next.captionAutoPosition) next.y=captionBottomY(s.project,next.text,next.fontSize);
    if (patch.speed !== undefined && patch.speed !== clip.speed) {const ratio=clip.speed/patch.speed;next.duration=clip.duration*ratio;next.fadeIn=patch.fadeIn??clip.fadeIn*ratio;next.fadeOut=patch.fadeOut??clip.fadeOut*ratio;}
    const normalized = normalizeClip(next, s.project);
    if (patch.volumeKeyframes === undefined && clip.volumeKeyframes) normalized.volumeKeyframes = retimeVolume(clip, normalized);
    if (clip.kind === 'title' && patch.duration !== undefined && patch.opacityKeyframes === undefined && clip.opacityKeyframes) normalized.opacityKeyframes = windowOpacity(clip.opacityKeyframes, 0, normalized.duration);
    try { validateOpacityKeys(normalized); validateVolumeKeys(normalized); validateGraphic(normalized); if (normalized.kind === 'title') validateTextStyle(normalized); } catch (e) { s.notify((e as Error).message); return; }
    s.commit({ ...s.project, clips: s.project.clips.map(c => c.id === id ? normalized : c) }, patch.volumeKeyframes !== undefined ? '音量ポイントを変更' : patch.opacityKeyframes !== undefined ? '不透明度キーフレームを変更' : patch.speed !== undefined ? '再生速度を変更' : 'クリップのプロパティを変更');
  },
  updateTrack: (id, patch) => { const s = get(); const track = s.project.tracks.find(t => t.id === id); if (!track || (track.locked && patch.name !== undefined)) return; s.commit({ ...s.project, tracks: s.project.tracks.map(t => t.id === id ? { ...t, ...patch } : t) }, patch.locked !== undefined ? (patch.locked ? 'トラックをロック' : 'トラックのロックを解除') : 'トラックを変更'); },
  importAssets: assets => { const s = get(); const known = new Set(s.project.assets.map(a => a.id)); const fresh = assets.filter(a => { if (known.has(a.id)) return false; known.add(a.id); return true; }); if (!capacity(s.project.assets.length, fresh.length, '素材')) return; if (fresh.length) s.commit({ ...s.project, assets: [...s.project.assets, ...fresh] }, '素材を読み込み'); s.notify(`${assets.length} 件の素材を読み込みました`); },
  removeAsset: (id, removeUsed = false) => {
    const s = get(), asset = s.project.assets.find(a => a.id === id);
    if (!asset) return;
    const used = s.project.clips.filter(c => c.assetId === id);
    if (used.some(c => s.project.tracks.find(t => t.id === c.trackId)?.locked)) { s.notify('この素材を使用しているトラックのロックを解除してください。'); return; }
    if (used.length && !removeUsed) { s.notify('使用中の素材です。使用クリップを確認してから削除してください。'); return; }
    const clips = s.project.clips.filter(c => c.assetId !== id);
    const youtube = s.project.youtube?.thumbnailAssetId === id ? { ...s.project.youtube, thumbnailAssetId: undefined } : s.project.youtube;
    const project = { ...s.project, assets: s.project.assets.filter(a => a.id !== id), clips, ...(youtube ? { youtube } : {}) };
    s.commit(project, '素材をプロジェクトから削除');
    set(state => ({ activeVolumePoint:null, selected: state.selected.filter(id => clips.some(c => c.id === id)), clipboard: state.clipboard.filter(c => c.assetId !== id), sourceId: state.sourceId === id ? null : state.sourceId, playing: false, shuttleRate: 1, playhead: Math.min(state.playhead, endTime(project)), zoom: boundedZoom(state.zoom, endTime(project)), seekRevision: state.seekRevision + 1 }));
    s.notify(`${asset.name} をプロジェクトから削除しました。Ctrl+Zで元に戻せます。`);
  },
  addAsset: (id, at, trackId) => {
    const s = get(); const asset = s.project.assets.find(a => a.id === id); if (!asset) return;
    if (!capacity(s.project.clips.length, asset.kind==='video'&&asset.hasAudio?2:1)) return;
    const track = s.project.tracks.find(t => t.id === trackId) || [...s.project.tracks].reverse().find(t => !t.locked && t.kind === (asset.kind === 'audio' ? 'audio' : 'video'));
    if (!track || track.locked || (track.kind === 'audio' && asset.kind !== 'audio')) { s.notify('素材に合うロックされていないトラックを選択してください'); return; }
    const start = at ?? Math.max(0, ...s.project.clips.filter(c => c.trackId === track.id).map(c => c.start + c.duration));
    const clip = normalizeClip(makeClip(track.id, start, asset), s.project);
    let next={...s.project,clips:[...s.project.clips,clip]};try{if(asset.kind==='video'&&asset.hasAudio)next=separateAudio(next,[clip.id],true,true);}catch(e){s.notify((e as Error).message);return;}
    if(!s.place(next, '素材をタイムラインに追加'))return; set(state => ({ activeVolumePoint:null, selected: [clip.id], playhead: clip.start, zoom: boundedZoom(state.zoom, endTime(state.project)), seekRevision: state.seekRevision + 1 }));
  },
  addTitle: (style = 'hero') => {
    const s = get(); const track = s.project.tracks.find(t => t.kind === 'video' && !t.locked);
    if (!capacity(s.project.clips.length, 1)) return;
    if (!track) { s.notify('映像トラックのロックを解除してください'); return; }
    const clip = { ...makeClip(track.id, s.playhead), textStyle: style, fontWeight: style === 'hero' ? 700 : 500, fontSize: style === 'subtitle' ? 58 : 94, y: style === 'subtitle' ? 33 : 0, name: style === 'subtitle' ? '字幕' : 'タイトル' };
    if(style==='subtitle')Object.assign(clip,captionStyle(s.project,clip.text));
    if(!s.place({ ...s.project, clips: [...s.project.clips, clip] }, 'テロップを追加'))return; set({ activeVolumePoint:null, selected: [clip.id], inspectorTab: 'video' });
  },
  split: (at, ids) => {
    const s = get(); let targets = linkedIds(s.project,ids || s.selected); let count = 0;
    const blocked=linkedIds(s.project,s.project.clips.filter(c=>targets.includes(c.id)&&s.project.tracks.find(t=>t.id===c.trackId)?.locked).map(c=>c.id));
    targets=targets.filter(id=>!blocked.includes(id));
    if(!targets.length&&blocked.length){s.notify('リンク相手を含むトラックのロックを解除してください。');return;}
    if (!targets.length) { s.notify('分割するクリップを選択してください'); return; }
    const clips = s.project.clips.flatMap(c => {
      if (!targets.includes(c.id) || s.project.tracks.find(t => t.id === c.trackId)?.locked) return [c];
      const pair = splitClip(c, at ?? s.playhead, s.project.fps); if (pair) count++; return pair || [c];
    });
    if (!capacity(s.project.clips.length, count)) return;
    if (count) { s.commit({ ...s.project, clips }, '編集点を追加'); s.notify(`${count} 個のクリップを分割しました`); } else s.notify('再生ヘッドをクリップの内側へ移動してください');
  },
  remove: (ripple = false) => {
    const s = get(), ids=linkedIds(s.project,s.selected); if(clipsLocked(s.project,ids)){s.notify('リンク相手を含むトラックのロックを解除してください。');return;} const removed = s.project.clips.filter(c => ids.includes(c.id));
    if (!removed.length) return;
    let clips = s.project.clips.filter(c => !removed.includes(c));
    if (ripple) {
      // Delete the union of selected intervals separately on each affected track.
      for (const track of s.project.tracks) {
        const spans = removed.filter(c => c.trackId === track.id).map(c => [c.start, c.start + c.duration]).sort((a,b) => a[0] - b[0]);
        const merged: number[][] = [];
        for (const span of spans) { const last = merged.at(-1); if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]); }
        clips = clips.map(c => c.trackId !== track.id ? c : { ...c, start: Math.max(0, c.start - merged.reduce((n, [a,b]) => n + Math.max(0, Math.min(c.start,b) - a), 0)) });
      }
    }
    if(s.commit({ ...s.project, clips }, ripple ? 'リップル削除' : 'クリップを削除'))set({ activeVolumePoint:null, selected: [] });
  },
  copy: () => { const s = get(), ids=new Set(linkedIds(s.project,s.selected)); set({ clipboard: s.project.clips.filter(c => ids.has(c.id)) }); s.notify('クリップをコピーしました'); },
  paste: () => {
    const s = get(); if (!s.clipboard.length) return; const min = Math.min(...s.clipboard.map(c => c.start));
    if(s.clipboard.some(c=>!s.project.tracks.some(t=>t.id===c.trackId&&!t.locked))){s.notify('貼り付け先のトラックのロックを解除してください。');return;}
    const clips = cloneLinkedClips(s.clipboard,uid,s.playhead-min);
    if (!capacity(s.project.clips.length, clips.length)) return;
    if (clips.length) { if(!s.place({ ...s.project, clips: [...s.project.clips, ...clips] }, 'クリップを貼り付け'))return; set({ activeVolumePoint:null, selected: clips.map(c => c.id) }); }
  },
  duplicate: () => {
    const s = get(),ids=linkedIds(s.project,s.selected);if(clipsLocked(s.project,ids)){s.notify('リンク相手を含むトラックのロックを解除してください。');return;} const selected = s.project.clips.filter(c => ids.includes(c.id)); if (!selected.length) return;
    if (!capacity(s.project.clips.length, selected.length)) return;
    const min = Math.min(...selected.map(c => c.start)); const max = Math.max(...selected.map(c => c.start + c.duration));
    const clips = cloneLinkedClips(selected,uid,max-min); if(!s.place({ ...s.project, clips: [...s.project.clips, ...clips] }, 'クリップを複製'))return; set({ activeVolumePoint:null, selected: clips.map(c => c.id) });
  },
  removeGap: (trackId, time) => {
    const s = get(); if (s.gestureActive) return;
    try {
      const result = deleteTimelineGap(s.project, trackId, time);
      if (!result || !s.commit(result.project, '空白をリップル削除', s.playhead)) return;
      const playhead = Math.min(endTime(result.project), rippleGapTime(s.playhead, result.gap, s.project.fps));
      set({ playhead, zoom: boundedZoom(get().zoom, Math.max(endTime(result.project), playhead)), seekRevision: s.seekRevision + 1, activeVolumePoint:null, selected: [], playing: false, shuttleRate: 1 });
      s.notify(`${(result.gap.to - result.gap.from).toFixed(2)}秒の空白を削除し、全トラックを前に詰めました。`);
    } catch (error) { s.notify((error as Error).message); }
  },
  rippleTrim: direction => {
    const s = get();
    try {
      const result = rippleTrim(s.project, s.playhead, direction);
      if (!result) return;
      if(!s.commit(result.project, direction === 'previous' ? '前の編集点までリップルトリム' : '次の編集点までリップルトリム', s.playhead))return;
      set({ playhead: result.playhead, zoom: boundedZoom(get().zoom, Math.max(endTime(result.project), result.playhead)), seekRevision: s.seekRevision + 1, activeVolumePoint:null, selected: [], playing: false, shuttleRate: 1 });
    } catch (error) { s.notify((error as Error).message); }
  },
  restoreHistory: index => {
    const s = get(); const states = [...s.history, s.project, ...s.future];
    if (!Number.isInteger(index) || index < 0 || index >= states.length || index === s.history.length) return;
    const labels = [...s.historyLabels, s.currentAction, ...s.futureLabels];
    const positions=[...s.historyPlayheads,s.playhead,...s.futurePlayheads];
    set({ activeVolumePoint:null, project: states[index], zoom: boundedZoom(s.zoom, endTime(states[index])), history: states.slice(0, index), future: states.slice(index + 1), historyPlayheads:positions.slice(0,index),futurePlayheads:positions.slice(index+1), historyLabels: labels.slice(0, index), currentAction: labels[index], futureLabels: labels.slice(index + 1), dirty: true, selected: s.selected.filter(id => states[index].clips.some(c => c.id === id)), playing: false, shuttleRate: 1, playhead: Math.min(positions[index]??s.playhead, endTime(states[index])), seekRevision: s.seekRevision + 1 });
  },
  undo: () => { const s = get(); if (s.history.length) s.restoreHistory(s.history.length - 1); },
  redo: () => { const s = get(); if (s.future.length) s.restoreHistory(s.history.length + 1); },
  removeTrack: id => {
    const s=get(),p=s.project,track=p.tracks.find(t=>t.id===id);if(!track)return false;
    if(s.gestureActive){s.notify('ドラッグ中の編集を完了してください。');return false;}
    const reason=trackDeletionReason(p,id);if(reason){s.notify(reason);return false;}
    const ids=p.clips.filter(c=>c.trackId===id).map(c=>c.id);
    if(!s.commit({...p,tracks:p.tracks.filter(t=>t.id!==id),clips:p.clips.filter(c=>c.trackId!==id)},'トラックを削除'))return false;
    s.stop();set({selected:s.selected.filter(id=>!ids.includes(id))});
    s.notify(`「${track.name}」を削除しました。Ctrl+Zで戻せます。`);return true;
  },
  addTrack: kind => { const s = get(); if (s.project.tracks.length >= 24) { s.notify('トラックは最大24本です'); return; } const t = makeTrack(kind, kind === 'video' ? '映像トラック' : '音声トラック'); s.commit({ ...s.project, tracks: kind === 'video' ? [t, ...s.project.tracks] : [...s.project.tracks, t] }); },
  addMarker: () => { const s = get(); s.commit({ ...s.project, markers: [...s.project.markers, { id: uid(), time: s.playhead, label: `マーカー ${s.project.markers.length + 1}` }] }); s.notify('マーカーを追加しました'); },
  removeMarker: id => { const s = get(); s.commit({ ...s.project, markers: s.project.markers.filter(m => m.id !== id) }); },
  notify: toast => { clearTimeout(toastTimer); set({ toast }); toastTimer = setTimeout(() => set({ toast: '' }), 4500); }
}));

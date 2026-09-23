import type { SoundId } from '../shared/sounds.mjs';
export type MediaKind = 'video' | 'audio' | 'image';
export interface TextBox { width: number; height: number }
export interface OpacityKeyframe { time: number; value: number }
export interface VolumeKeyframe { time: number; value: number }
export type VisualValues = Pick<Clip, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'> & Partial<Pick<Clip, 'fontSize' | 'color' | 'fontFamily' | 'fontWeight' | 'textStyle' | 'textShadow' | 'shadowColor' | 'shadowBlur' | 'shadowDistance' | 'textStroke' | 'strokeColor' | 'strokeWidth' | 'captionBackgroundOpacity' | 'exposure' | 'contrast' | 'saturation' | 'graphic'>> & { crop?: Crop | null; videoMask?: VideoMask | null; chromaKey?: ChromaKey | null; textBox?: TextBox | null };
export interface VisualKeyframe { time: number; values: VisualValues }
export interface Crop { top: number; right: number; bottom: number; left: number }
export interface BasicVideoMask { type: 'rectangle' | 'ellipse'; x: number; y: number; width: number; height: number; feather: number; inverted: boolean }
export interface BezierMaskPoint { x: number; y: number; inX: number; inY: number; outX: number; outY: number; kind: 'line' | 'curve' }
export interface BezierVideoMask { type: 'bezier'; points: BezierMaskPoint[]; closed: boolean; feather: number; inverted: boolean }
export type VideoMask = BasicVideoMask | BezierVideoMask;
export interface ChromaKey { color: string; tolerance: number; softness: number; greenSpill: number; blueSpill: number; matte: boolean }
export interface Mosaic { x: number; y: number; width: number; height: number; blockSize: number }
export interface Graphic { shape: 'arrow' | 'rectangle' | 'ellipse'; width:number; height:number; lineWidth:number; fill:boolean; fillColor:string; flipX?:boolean; flipY?:boolean }
export interface Asset {
  id: string; name: string; path: string; url: string; thumbnail: string; kind: MediaKind;
  duration: number; width: number; height: number; fps: number; hasAudio: boolean;
  waveform: number[]; size: number; codec: string; proxy?: boolean; previewProxy?: boolean; proxyWarning?: string; offline?: boolean; revision?: string;
}
export interface Track { id: string; name: string; autoName?: boolean; audioSourceTrackId?: string; kind: 'video' | 'audio'; muted: boolean; hidden: boolean; locked: boolean; solo: boolean }
export interface Clip {
  id: string; assetId?: string; trackId: string; name: string; kind: MediaKind | 'title';
  start: number; in: number; duration: number; speed: number;
  x: number; y: number; scale: number; rotation: number; opacity: number;
  exposure: number; contrast: number; saturation: number; volume: number; fadeIn: number; fadeOut: number;
  text: string; fontSize: number; color: string; textStyle: 'hero' | 'subtitle' | 'minimal';
  fontFamily?: string; fontWeight?: number; textShadow?: boolean; shadowColor?: string; shadowBlur?: number; shadowDistance?: number; textStroke?: boolean; strokeColor?: string; strokeWidth?: number;
  captionBackgroundOpacity?: number;
  captionAutoPosition?: boolean;
  textBox?: TextBox;
  audioTreatment?: 'speech' | 'normalize';
  linkId?: string; audioDetached?: boolean; audioMuted?: boolean;
  opacityKeyframes?: OpacityKeyframe[];
  visualKeyframes?: VisualKeyframe[];
  volumeKeyframes?: VolumeKeyframe[];
  crop?: Crop;
  videoMask?: VideoMask;
  chromaKey?: ChromaKey;
  mosaic?: Mosaic;
  subtitle?: boolean;
  graphic?: Graphic;
}
export interface Marker { id: string; time: number; label: string }
export interface Transition { id:string;fromId:string;toId:string;mode?:'fixed';duration?:number;video?:'dissolve'|'pageTurn'|'pagePeel';audio?:'constantGain'|'constantPower' }
export interface TransitionOptions {duration:number;autoAudio?:boolean;video?:Transition['video'];audio?:Transition['audio']}
export interface SubtitleCue { start: number; end: number; text: string }
export interface Chapter { time: number; label: string }
export interface YoutubeData { transcriptionStats?: { retries: number; timingFallbacks: number }; sourceKey: string; cues: SubtitleCue[]; titles: string[]; description: string; chapters: Chapter[]; keywords: string[]; hashtags?: string[]; thumbnailPrompt: string; thumbnailAssetId?: string; thumbnailReferenceAssetId?: string }
export interface AIStatus { configured: boolean; source: string; transcriptionModel: string; timingModel: string; textModel: string; imageModel: string }
export interface AIProgress { message: string; progress: number }
export interface Project { version: 1; id: string; name: string; width: number; height: number; fps: number; assets: Asset[]; clips: Clip[]; tracks: Track[]; markers: Marker[]; youtube?: YoutubeData; transitions?:Transition[] }
export interface UpdateInfo { status: 'current' | 'available' | 'unsupported' | 'error'; currentVersion: string; latestVersion?: string; checkedAt: number; platform: string; arch: string; releaseUrl?: string; message?: string }
export type ExportEncoder = 'auto' | 'cpu' | 'videotoolbox' | 'nvenc' | 'qsv' | 'amf';
export interface EncoderCapabilities { recommended: ExportEncoder; encoders: { id: Exclude<ExportEncoder, 'auto'>; label: string; available: boolean; reason?: string }[] }
export interface ExportSettings { width: number; height: number; fps: number; quality: 'draft' | 'standard' | 'high'; target?: 'youtube' | 'shorts'; encoder?: ExportEncoder }
export interface ExportProgress { status: 'preparing' | 'rendering' | 'complete'; progress: number; output: string; encoder?: ExportEncoder; encoderLabel?: string; warning?: string }
export interface ImportProgress { index: number; total: number; name: string; completed?: number; stage?: string }
export interface Bootstrap { startupProject?:Project|null; startupError?:string; assets: Asset[]; recovery: { project: Project; savedAt: string } | null; version: string }
export interface BgmTrack { id:string; name:string; relativePath:string; duration:number }
export interface BgmLibrary { folder:string|null; tracks:BgmTrack[]; errors:string[]; truncated:boolean }
export type AudioPreparePhase = 'preparing' | 'speech' | 'refining' | 'analysis' | 'processing' | 'correction' | 'saving' | 'cached' | 'complete';
export interface AudioPrepareProgress { requestId: string; phase: AudioPreparePhase; progress: number; processedSeconds: number; durationSeconds: number | null }
export interface DesktopAPI {
  onRenderTitleFrame(cb:(request:{id:string;clip:Clip;time:number;width:number;height:number;projectWidth:number})=>void):()=>void;
  finishTitleFrame(id:string,png?:string,error?:string):Promise<boolean>;
  copyText(text: string): Promise<void>;
  listBgm():Promise<BgmLibrary>;
  chooseBgmFolder():Promise<BgmLibrary|null>;
  loadBgm(id:string):Promise<Asset>;
  soundAsset(id: SoundId,minimumDuration?:number):Promise<Asset>;
  loadFont(family: string, weight: number): Promise<{ url: string; weight: string }>;
  aiStatus(): Promise<AIStatus>;
  aiSetKey(key: string): Promise<AIStatus>;
  aiImportEnv(): Promise<AIStatus>;
  aiClearKey(): Promise<AIStatus>;
  aiTranscribe(project: Project, vocabulary: string): Promise<YoutubeData>;
  aiMetadata(project: Project, model: import('../shared/ai-text-model.mjs').TextModel): Promise<YoutubeData>;
  aiThumbnail(project: Project, prompt: string): Promise<Asset>;
  aiChooseThumbnailReference(project: Project): Promise<Asset | null>;
  aiSaveOutput(project: Project, format: 'srt' | 'vtt' | 'txt' | 'jpg'): Promise<string | null>;
  aiCancel(): Promise<void>;
  onAIProgress(cb: (progress: AIProgress) => void): () => void;
  blackVideo(width:number,height:number):Promise<Asset>;
  bootstrap(): Promise<Bootstrap>;
  prepareAudio(project: Project, clipId: string, treatment: 'speech' | 'normalize', requestId?: string): Promise<{ inputLufs: number; outputLufs: number; peak: number }>;
  onAudioPrepareProgress(cb: (progress: AudioPrepareProgress) => void): () => void;
  cancelAudioPrepare(): Promise<void>;
  readAudioChunk(url: string, index: number, treatment?: Clip['audioTreatment']): Promise<Float32Array>;
  readWaveform(url: string, start: number, end: number, bins: number, options?:{absolute?:boolean;treatment?:'speech'|'normalize'}, requestId?:string): Promise<Float32Array>;
  cancelWaveform(requestId:string):Promise<void>;
  importMedia(): Promise<{ assets: Asset[]; errors: string[]; cancelled?: boolean }>;
  importDroppedFiles(files: File[]): Promise<{ assets: Asset[]; errors: string[]; cancelled?: boolean }>;
  previewProxy(asset: Asset, enabled: boolean): Promise<Asset | null>;
  cancelImport(): Promise<void>;
  relink(asset: Asset): Promise<Asset | null>;
  collectProject(project: Project): Promise<string | null>;
  relinkFolder(project: Project): Promise<{ assets: Asset[]; unresolved: string[] } | null>;
  saveProject(project: Project, saveAs?: boolean): Promise<string | null>;
  openProject(): Promise<{ project: Project; path: string } | null>;
  autosave(project: Project): Promise<void>;
  resetProjectPath(keepRecovery?: boolean): Promise<void>;
  listBackups(): Promise<{ id: string; projectId: string; name: string; savedAt: string; clips: number }[]>;
  readBackup(id: string): Promise<{ project: Project; savedAt: string }>;
  clearRecovery(expectedSavedAt?: string): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  onPrepareClose(cb: (requestId: number) => void): () => void;
  finishPrepareClose(requestId: number, dirty: boolean, canClose: boolean): Promise<void>;
  onSaveBeforeClose(cb: (requestId: number) => void): () => void;
  finishSaveBeforeClose(requestId: number, saved: boolean): Promise<void>;
  saveFrame(request: { name: string; time: number; fps: number; width: number; height: number; format: 'png' | 'jpg'; addToProject: boolean; png: string }): Promise<{ path: string; asset?: Asset; warning?: string } | null>;
  exportProject(project: Project, settings: ExportSettings, titles: Record<string, string>): Promise<string | null>;
  checkUpdates(refresh?: boolean): Promise<UpdateInfo>;
  openUpdatePage(): Promise<void>;
  exportEncoders(refresh?: boolean): Promise<EncoderCapabilities>;
  cancelExport(): Promise<void>;
  reveal(path: string): Promise<void>;
  onExportProgress(cb: (progress: ExportProgress) => void): () => void;
  onImportProgress(cb: (progress: ImportProgress) => void): () => void;
}
declare global { interface Window { luma?: DesktopAPI } }

import type { SoundId } from '../shared/sounds.mjs';
export type MediaKind = 'video' | 'audio' | 'image';
export interface TextBox { width: number; height: number }
export interface OpacityKeyframe { time: number; value: number }
export interface VolumeKeyframe { time: number; value: number }
export interface Graphic { shape: 'arrow' | 'rectangle' | 'ellipse'; width:number; height:number; lineWidth:number; fill:boolean; fillColor:string; flipX?:boolean; flipY?:boolean }
export interface Asset {
  id: string; name: string; path: string; url: string; thumbnail: string; kind: MediaKind;
  duration: number; width: number; height: number; fps: number; hasAudio: boolean;
  waveform: number[]; size: number; codec: string; proxy?: boolean; offline?: boolean; revision?: string;
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
  volumeKeyframes?: VolumeKeyframe[];
  subtitle?: boolean;
  graphic?: Graphic;
}
export interface Marker { id: string; time: number; label: string }
export interface Transition { id:string;fromId:string;toId:string;mode?:'fixed';duration?:number;video?:'dissolve'|'pageTurn'|'pagePeel';audio?:'constantGain'|'constantPower' }
export interface TransitionOptions {duration:number;autoAudio?:boolean;video?:Transition['video'];audio?:Transition['audio']}
export interface SubtitleCue { start: number; end: number; text: string }
export interface Chapter { time: number; label: string }
export interface YoutubeData { sourceKey: string; cues: SubtitleCue[]; titles: string[]; description: string; chapters: Chapter[]; keywords: string[]; hashtags?: string[]; thumbnailPrompt: string; thumbnailAssetId?: string }
export interface AIStatus { configured: boolean; source: string; transcriptionModel: string; timingModel: string; textModel: string; imageModel: string }
export interface AIProgress { message: string; progress: number }
export interface Project { version: 1; id: string; name: string; width: number; height: number; fps: number; assets: Asset[]; clips: Clip[]; tracks: Track[]; markers: Marker[]; youtube?: YoutubeData; transitions?:Transition[] }
export interface UpdateInfo { status: 'current' | 'available' | 'unsupported' | 'error'; currentVersion: string; latestVersion?: string; checkedAt: number; platform: string; arch: string; releaseUrl?: string; message?: string }
export type ExportEncoder = 'auto' | 'cpu' | 'videotoolbox' | 'nvenc' | 'qsv' | 'amf';
export interface EncoderCapabilities { recommended: ExportEncoder; encoders: { id: Exclude<ExportEncoder, 'auto'>; label: string; available: boolean; reason?: string }[] }
export interface ExportSettings { width: number; height: number; fps: number; quality: 'draft' | 'standard' | 'high'; target?: 'youtube' | 'shorts'; encoder?: ExportEncoder }
export interface ExportProgress { status: 'preparing' | 'rendering' | 'complete'; progress: number; output: string; encoder?: ExportEncoder; encoderLabel?: string; warning?: string }
export interface ImportProgress { index: number; total: number; name: string }
export interface Bootstrap { startupProject?:Project|null; startupError?:string; assets: Asset[]; recovery: { project: Project; savedAt: string } | null; version: string }
export interface BgmTrack { id:string; name:string; relativePath:string; duration:number }
export interface BgmLibrary { folder:string|null; tracks:BgmTrack[]; errors:string[]; truncated:boolean }
export type AudioPreparePhase = 'preparing' | 'speech' | 'refining' | 'analysis' | 'processing' | 'correction' | 'saving' | 'cached' | 'complete';
export interface AudioPrepareProgress { requestId: string; phase: AudioPreparePhase; progress: number; processedSeconds: number; durationSeconds: number | null }
export interface DesktopAPI {
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
  aiMetadata(project: Project): Promise<YoutubeData>;
  aiThumbnail(project: Project, prompt: string): Promise<Asset>;
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
  importMedia(): Promise<{ assets: Asset[]; errors: string[] }>;
  importDroppedFiles(files: File[]): Promise<{ assets: Asset[]; errors: string[] }>;
  relink(asset: Asset): Promise<Asset | null>;
  saveProject(project: Project, saveAs?: boolean): Promise<string | null>;
  openProject(): Promise<{ project: Project; path: string } | null>;
  autosave(project: Project): Promise<void>;
  resetProjectPath(keepRecovery?: boolean): Promise<void>;
  clearRecovery(expectedSavedAt?: string): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  onPrepareClose(cb: (requestId: number) => void): () => void;
  finishPrepareClose(requestId: number, dirty: boolean, canClose: boolean): Promise<void>;
  onSaveBeforeClose(cb: (requestId: number) => void): () => void;
  finishSaveBeforeClose(requestId: number, saved: boolean): Promise<void>;
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

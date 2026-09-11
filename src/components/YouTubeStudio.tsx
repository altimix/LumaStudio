import { useEffect, useRef, useState } from 'react';
import { Captions, Copy, Download, ImagePlus, KeyRound, LoaderCircle, Sparkles, Youtube } from 'lucide-react';
import { useEditor } from '../store';
import { endTime } from '../model';
import { applySubtitles, emptyYoutube } from '../youtube';
import { chapterTime, descriptionWithChapters, parseHashtags, timelineKey, validateYoutube, validChapters, youtubeText } from '../../shared/youtube.mjs';
import type { AIProgress, AIStatus, Project, SubtitleCue, YoutubeData } from '../types';
import { Modal } from './UI';
import '../youtube.css';
import { thumbnailFormat } from '../../shared/youtube-thumbnail.mjs';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '');
const seconds = (value: string) => value.trim() ? Number(value) : NaN;
export default function YouTubeStudio({ onClose }: { onClose: () => void }) {
  const p = useEditor(s => s.project), y = p.youtube || emptyYoutube(p), duration = endTime(p);
  const [tab, setTab] = useState('captions'), [status, setStatus] = useState<AIStatus>(), [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<AIProgress>(), [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const copying = useRef(false);
  const [vocabulary, setVocabulary] = useState(''), [search, setSearch] = useState(''), [replacement, setReplacement] = useState(''), [page, setPage] = useState(0);
  const alive = useRef(true), running = useRef(false), scroll = useRef<HTMLDivElement>(null);
  const editingField = useRef('');
  const invalidDraft = useRef(false); const [draftInvalid, setDraftInvalid] = useState(false);
  useEffect(() => { scroll.current?.scrollTo(0, 0); }, [tab]);
  useEffect(() => {
    alive.current = true;
    void window.luma?.aiStatus().then(s => { if (alive.current) setStatus(s); }).catch(e => { if (alive.current) setError(message(e)); });
    const off = window.luma?.onAIProgress(data => { if (alive.current) setProgress(data); });
    return () => { alive.current = false; off?.(); if (running.current) void window.luma?.aiCancel(); };
  }, []);
  const stale = !!p.youtube?.cues.length && y.sourceKey !== timelineKey(p);
  const update = (patch: Partial<YoutubeData>, field?: string) => {
    setCopied('');
    try {
      const s = useEditor.getState(), current = s.project.youtube || emptyYoutube(s.project), next = { ...current, ...patch }; validateYoutube(next);
      if (JSON.stringify(next) === JSON.stringify(current)) { setError(''); return true; }
      if (field) {
        if (editingField.current !== field) { s.checkpoint('YouTube投稿素材を編集'); editingField.current = field; }
        s.transient({ ...s.project, youtube: next });
      } else { editingField.current = ''; s.commit({ ...s.project, youtube: next }, 'YouTube投稿素材を編集'); }
      setError(''); return true;
    }
    catch (e) { setError(message(e)); return false; }
  };
  const task = async (work: (snapshot: Project) => Promise<void>) => {
    if (invalidDraft.current) { setError('入力エラーのある字幕を修正してから実行してください。'); return; }
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setCopied(''); setProgress(undefined); useEditor.getState().stop();
    try { await work(useEditor.getState().project); } catch (e) { if (alive.current) setError(message(e)); }
    finally { running.current = false; if (alive.current) { setBusy(false); setProgress(undefined); } }
  };
  const accept = (snapshot: Project, result: YoutubeData, assets?: Project['assets']) => {
    if (!alive.current) return;
    const current = useEditor.getState().project;
    if (current.id !== snapshot.id || current.width !== snapshot.width || current.height !== snapshot.height || timelineKey(current) !== timelineKey(snapshot)) throw new Error('処理中にタイムラインが変わりました。現在の内容で再実行してください。');
    const fresh = assets?.filter(a => !current.assets.some(known => known.id === a.id)) || [];
    if (current.assets.length + fresh.length > 2000) throw new Error('素材が2000個を超えます。');
    useEditor.getState().commit({ ...current, youtube: result, assets: [...current.assets, ...fresh] }, 'YouTube制作素材を生成');
  };
  const copy = async (contents: (data: YoutubeData, duration: number) => string, label: string) => {
    if (copying.current) return;
    setCopied('');
    if (invalidDraft.current) { setError('入力エラーを修正してからコピーしてください。'); return; }
    copying.current = true; setError('');
    try {
      // A blur can commit the keyword draft just before this click. Read the
      // store now so copying never uses the previous render's saved value.
      const current = useEditor.getState().project;
      const text = contents(current.youtube || emptyYoutube(current), endTime(current));
      if (!text.trim()) throw new Error('コピーするテキストを入力してください。');
      if (window.luma) await window.luma.copyText(text);
      else await navigator.clipboard.writeText(text);
      if (alive.current) setCopied(`${label}をコピーしました。Ctrl+Vで貼り付けできます。`);
    } catch {
      if (alive.current) setError('コピーできませんでした。もう一度コピーするか、「テキスト保存」を利用してください。');
    } finally { copying.current = false; }
  };
  const save = (format: 'srt' | 'vtt' | 'txt' | 'jpg') => task(async current => { const file = await window.luma?.aiSaveOutput(current, format); if (file) useEditor.getState().notify(`保存しました: ${file}`); });
  const cuePatch = (index: number, patch: Partial<SubtitleCue>) => ({ cues: y.cues.map((c, i) => i === index ? { ...c, ...patch } : c) });
  const checkDraft = (patch: Partial<YoutubeData>) => {
    setCopied('');
    try { validateYoutube({ ...y, ...patch }); invalidDraft.current = false; setDraftInvalid(false); setError(''); }
    catch (e) { invalidDraft.current = true; setDraftInvalid(true); setError(message(e)); }
  };
  const commitDraft = (patch: Partial<YoutubeData>, input: HTMLInputElement | HTMLTextAreaElement, saved: string) => {
    if (!update(patch)) input.value = saved;
    invalidDraft.current = false; setDraftInvalid(false);
  };
  const filtered = y.cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => !search || cue.text.includes(search));
  const rows = filtered.slice(page * 40, page * 40 + 40);
  const thumbnail = p.assets.find(a => a.id === y.thumbnailAssetId);
  const imageFormat=thumbnailFormat(p);
  const thumbnailMismatch=thumbnail&&(thumbnail.width!==imageFormat.width||thumbnail.height!==imageFormat.height);
  return <Modal title="YouTube制作スタジオ" wide onClose={() => { if (!busy) onClose(); }}><div className="youtube-studio">
    <div className="yt-intro"><span className="yt-logo"><Youtube size={25}/></span><div><strong>編集から、公開の準備まで。</strong><p>{p.width} × {p.height} · {p.height > p.width ? '縦型 / Shorts' : '横型 / YouTube'} · {chapterTime(duration)}</p></div><span className={`yt-key-state ${status?.configured ? 'ready' : ''}`}>{status?.configured ? 'API キー設定済み' : 'API キー未設定'}</span></div>
    <nav className="yt-tabs" aria-label="YouTube制作メニュー">{[{ id: 'captions', label: '日本語字幕', icon: Captions }, { id: 'metadata', label: 'タイトル・概要欄', icon: Youtube }, { id: 'thumbnail', label: 'サムネイル', icon: ImagePlus }, { id: 'settings', label: 'API設定', icon: KeyRound }].map(t => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}><t.icon size={16}/>{t.label}</button>)}</nav>
    {!window.luma ? <p className="yt-notice">AI機能はデスクトップ版で利用できます。</p> : null}
    {stale ? <p className="yt-notice" role="status">文字起こし後に音声の編集内容が変わりました。字幕・チャプターの時刻を更新するには、文字起こしを再実行してください。</p> : null}
    {tab === 'captions' && !!y.transcriptionStats?.timingFallbacks ? <p className="yt-notice">{y.transcriptionStats.timingFallbacks}区間は、短い音声で再確認した時刻付き認識を採用しました。字幕の本文を確認できます。</p> : null}
    {error ? <p className="yt-error" role="alert">{error}</p> : null}
    <p className={`yt-copy-status${copied ? ' visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">{copied}</p>
    <div className="yt-scroll" ref={scroll}><fieldset className="yt-content" disabled={busy} onBlurCapture={() => { editingField.current = ''; }}>
      {tab === 'settings' ? <div className="yt-settings"><h3>OpenAI APIの設定</h3><p>文字起こし時に音声を、投稿文・画像生成時に入力内容をOpenAIへ送信します。実行した分のAPI利用料がかかります。</p><label>OpenAI APIキー<input aria-label="OpenAI APIキー" type="password" autoComplete="new-password" placeholder="sk-…" value={key} onChange={e => setKey(e.target.value)}/></label><div className="yt-actions"><button className="primary-button" disabled={!key || !window.luma} onClick={() => void task(async () => { const value = key; setKey(''); const s = await window.luma!.aiSetKey(value); if (alive.current) setStatus(s); })}>キーを保存</button><button className="secondary-button" disabled={!window.luma} onClick={() => void task(async () => { const s = await window.luma!.aiImportEnv(); if (alive.current) setStatus(s); })}>.envから読み込む</button><button className="text-button" disabled={!status?.configured} onClick={() => void task(async () => { const s = await window.luma!.aiClearKey(); if (alive.current) setStatus(s); })}>保存したキーを解除</button></div><p>{status?.configured ? `利用元: ${status.source}` : 'APIキーを入力するか、OPENAI_API_KEYがある.envを選択してください。'} キーはこのWindowsユーザー用に暗号化して保存します。</p><p>文字起こしは gpt-transcribe、字幕時刻の取得は whisper-1 を使用します。発話のある区間では両モデルのAPI利用料がかかります。時刻が合わない区間の自動再試行にもAPI利用料がかかります。</p><div className="yt-models"><span>日本語の文字起こし<strong>{status?.transcriptionModel || 'gpt-transcribe'}</strong></span><span>投稿文<strong>{status?.textModel || 'gpt-6-astra'}</strong></span><span>画像生成<strong>{status?.imageModel || 'gpt-image-2'}</strong></span></div></div> : null}
      {tab === 'captions' ? <><div className="yt-toolbar"><label>固有名詞・専門用語のヒント<input aria-label="日本語の用語ヒント" maxLength={120} placeholder="例：Luma Studio、動画編集、リップルトリミング" value={vocabulary} onChange={e => setVocabulary(e.target.value)}/></label><button className="primary-button" disabled={!status?.configured || !p.clips.length} onClick={() => void task(async current => { const result = await window.luma!.aiTranscribe(current, vocabulary); accept(current, result); setPage(0); })}><Sparkles size={15}/>{y.cues.length ? '文字起こしを再実行' : '日本語で文字起こし'}</button></div><p className="yt-hint">長い音声も自動で区切り、本文と時刻が合わない区間だけ再確認します。短い区間でも一致しない場合は、時刻付き認識の本文を採用します。字幕は20〜30文字を目安に句読点・発話の間で区切ります。白文字・青い縁取り・影なしで、横動画とショートに合わせた大きさを使います。編集済みの音声を使用します。会話以外のトラックをミュートすると認識しやすくなります。再実行すると現在の字幕原稿と投稿文を置き換えます。</p>
      {y.cues.length ? <><div className="yt-search"><input aria-label="字幕内を検索" placeholder="字幕内を検索" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}/><input aria-label="字幕の置換後の文字" placeholder="置換後の文字" value={replacement} onChange={e => setReplacement(e.target.value)}/><button className="secondary-button" disabled={!search} onClick={() => update({ cues: y.cues.map(c => ({ ...c, text: c.text.replaceAll(search, replacement) })) })}>すべて置換</button></div><div className="yt-cue-list">{rows.map(({ cue, index }) => <div className="yt-cue" key={`${index}:${cue.start}:${cue.end}:${cue.text}`}><button className="yt-cue-jump" title="タイムラインのこの位置へ" onClick={() => { useEditor.getState().stop(); useEditor.getState().seek(cue.start); onClose(); }}>{String(index + 1).padStart(3, '0')}</button><div className="yt-cue-times"><label>開始秒<input aria-label={`字幕${index + 1}の開始秒`} type="number" min={0} step={0.01} defaultValue={Number(cue.start.toFixed(3))} onChange={e => checkDraft(cuePatch(index, { start: seconds(e.target.value) }))} onBlur={e => commitDraft(cuePatch(index, { start: seconds(e.target.value) }), e.currentTarget, String(Number(cue.start.toFixed(3))))}/></label><label>終了秒<input aria-label={`字幕${index + 1}の終了秒`} type="number" min={0} step={0.01} defaultValue={Number(cue.end.toFixed(3))} onChange={e => checkDraft(cuePatch(index, { end: seconds(e.target.value) }))} onBlur={e => commitDraft(cuePatch(index, { end: seconds(e.target.value) }), e.currentTarget, String(Number(cue.end.toFixed(3))))}/></label></div><textarea aria-label={`字幕${index + 1}の本文`} rows={2} maxLength={4000} defaultValue={cue.text} onChange={e => checkDraft(cuePatch(index, { text: e.target.value }))} onBlur={e => commitDraft(cuePatch(index, { text: e.target.value }), e.currentTarget, cue.text)}/></div>)}</div><div className="yt-pagination"><button disabled={!page} onClick={() => setPage(page - 1)}>前の40件</button><span>{Math.min(page * 40 + 1, filtered.length)}–{Math.min((page + 1) * 40, filtered.length)} / {filtered.length}件</span><button disabled={(page + 1) * 40 >= filtered.length} onClick={() => setPage(page + 1)}>次の40件</button></div><div className="yt-actions"><button className="primary-button" disabled={stale || draftInvalid} onClick={() => { if (invalidDraft.current) return; try { const s = useEditor.getState(); if(!s.commit(applySubtitles(s.project), '日本語字幕をタイムラインに適用'))return; s.notify('字幕を適用しました。既存の自動字幕は更新され、Undoで戻せます。'); } catch (e) { setError(message(e)); } }}><Captions size={15}/>字幕をタイムラインに適用</button><button className="secondary-button" disabled={draftInvalid} onClick={() => void save('srt')}><Download size={14}/>SRT保存</button><button className="secondary-button" disabled={draftInvalid} onClick={() => void save('vtt')}>VTT保存</button></div></> : <div className="yt-empty"><Captions size={36}/><strong>話した言葉を、読みやすい日本語字幕に。</strong><p>時刻付きの原稿を作成し、誤変換を直してからタイムラインに適用できます。</p></div>}</> : null}
      {tab === 'metadata' ? <><div className="yt-toolbar"><div><h3>動画の内容から、投稿文を作成</h3><p className="yt-hint">タイトル3案・チャプター付き概要欄・ハッシュタグ3個・検索ワード10個<br/>投稿文モデル: {status?.textModel || '確認中'}</p></div><button className="primary-button" disabled={!status?.configured || !y.cues.length || stale} onClick={() => void task(async current => { const result = await window.luma!.aiMetadata(current); accept(current, result); })}><Sparkles size={15}/>投稿文を生成</button></div>{y.titles.length ? <div className="yt-metadata"><div><h4>タイトル案</h4>{y.titles.map((title, i) => <label className="yt-copy-row" key={i}><span>{i + 1}</span><input aria-label={`YouTubeタイトル案${i + 1}`} maxLength={100} value={title} onChange={e => update({ titles: y.titles.map((t, n) => n === i ? e.target.value : t) }, `title-${i}`)}/><button title="タイトルをコピー" aria-label={`タイトル案${i + 1}をコピー`} disabled={draftInvalid || !title.trim()} onClick={() => void copy(data => data.titles[i] || '', `タイトル案${i + 1}`)}><Copy size={14}/></button></label>)}<label>概要欄<textarea aria-label="YouTube概要欄" rows={6} maxLength={3000} value={y.description} onChange={e => update({ description: e.target.value }, 'description')}/></label><label>概要欄の末尾に付けるハッシュタグ（3個まで）<input aria-label="YouTubeハッシュタグ" placeholder="#動画編集 #字幕 #YouTube制作" defaultValue={(y.hashtags || []).join(' ')} key={(y.hashtags || []).join(' ')} onChange={e => checkDraft({ hashtags: parseHashtags(e.target.value) })} onBlur={e => commitDraft({ hashtags: parseHashtags(e.target.value) }, e.currentTarget, (y.hashtags || []).join(' '))}/></label><p className="yt-hint">空白またはカンマで区切ります。#は自動で補い、チャプターの後ろへ追加します。空欄にすると付けません。</p><label>検索ワード（10個・カンマ区切り）<input aria-label="YouTube検索ワード" defaultValue={y.keywords.join(',')} key={y.keywords.join(',')} onChange={e => checkDraft({ keywords: e.target.value.split(/[,，]/).map(k => k.trim()).filter(Boolean) })} onBlur={e => commitDraft({ keywords: e.target.value.split(/[,，]/).map(k => k.trim()).filter(Boolean) }, e.currentTarget, y.keywords.join(','))}/></label><span className="yt-hint">現在 {y.keywords.length}個</span></div><div><h4>チャプター</h4>{y.chapters.map((c, i) => <div className="yt-chapter" key={i}><input aria-label={`チャプター${i + 1}の秒`} type="number" min={0} step={1} value={c.time} onChange={e => update({ chapters: y.chapters.map((v, n) => n === i ? { ...v, time: Number(e.target.value) } : v) }, `chapter-time-${i}`)}/><input aria-label={`チャプター${i + 1}の見出し`} maxLength={100} value={c.label} onChange={e => update({ chapters: y.chapters.map((v, n) => n === i ? { ...v, label: e.target.value } : v) }, `chapter-label-${i}`)}/></div>)}<p className="yt-hint">00:00開始・3項目以上・各10秒以上。条件を満たすチャプターを概要欄のコピー時に付けます。</p>{!validChapters(y.chapters, duration) ? <p className="yt-notice">この長さ・時刻ではYouTubeチャプターの条件を満たしません。コピーには概要本文とハッシュタグを含めます。</p> : null}<label>コピーされる概要欄<textarea aria-label="チャプター・ハッシュタグ付きの概要欄" rows={6} readOnly value={descriptionWithChapters(y, duration)}/></label><button className="secondary-button" disabled={draftInvalid} onClick={() => void copy(descriptionWithChapters, '概要欄')}><Copy size={14}/>概要欄をチャプター付きでコピー</button></div></div> : <div className="yt-empty"><Youtube size={36}/><strong>字幕原稿をもとに、投稿素材をまとめます。</strong><p>まず「日本語字幕」で文字起こしを実行してください。</p></div>}<div className="yt-actions"><button className="secondary-button" disabled={!y.titles.length || draftInvalid} onClick={() => void copy(youtubeText, '投稿素材')}>投稿素材を一括コピー</button><button className="secondary-button" disabled={!y.titles.length || draftInvalid} onClick={() => void copy(data => data.keywords.join(','), '検索ワード')}>検索ワードをコピー</button><button className="secondary-button" disabled={!y.titles.length || draftInvalid} onClick={() => void save('txt')}>テキスト保存</button></div></> : null}
      {tab === 'thumbnail' ? <div className="yt-thumbnail">
        <div className="yt-thumbnail-controls"><span className="yt-thumbnail-eyebrow">動画からサムネイル</span><h3>動画の魅力が伝わる一枚に</h3>
          <p className="yt-hint">動画の実際の場面と字幕・投稿文から、主役と見せ場を強調。大きな見出しとメリハリのある構図で、高品質なサムネイルを作ります。</p>
          <div className="yt-thumbnail-format"><strong>{imageFormat.ratio}</strong><span>{imageFormat.portrait ? '縦動画の構図' : '横動画の構図'}<small>{imageFormat.width} × {imageFormat.height} · 高品質 JPEG · 2MB未満</small></span></div>
          <label>強調したい内容・見出し（任意）<textarea aria-label="サムネイルの生成指示" rows={6} maxLength={6000} placeholder="例：完成した料理を大きく。「たった10分」を見出しにして、手軽さとおいしさを伝える。空欄なら動画の内容から構成します。" value={y.thumbnailPrompt} onChange={e => update({ thumbnailPrompt: e.target.value }, 'thumbnail-prompt')}/></label>
          <button className="primary-button" disabled={!status?.configured || (!y.thumbnailPrompt.trim()&&!p.clips.length)} onClick={() => void task(async current => { const data=current.youtube||emptyYoutube(current);const asset = await window.luma!.aiThumbnail(current, data.thumbnailPrompt); accept(current, { ...data, thumbnailAssetId: asset.id }, [...current.assets, asset]); })}><Sparkles size={15}/>サムネイルを1枚生成</button>
          <p className="yt-hint">動画から最大3枚の参考画像と、字幕・投稿文をOpenAIへ送信します。生成・再生成にはAPI利用料がかかります。完成後に文字と内容を確認してください。</p>
        </div>
        <div className={`yt-thumbnail-preview ${imageFormat.portrait?'portrait':'landscape'}`}>
          <div className="yt-thumbnail-image" style={{aspectRatio:`${imageFormat.width} / ${imageFormat.height}`}}>{thumbnail ? <img src={thumbnail.url} alt="生成したYouTubeサムネイル"/> : <div className="yt-empty"><ImagePlus size={42}/><strong>{imageFormat.ratio}のサムネイル</strong><span>動画の見せ場を、ひと目で。</span></div>}</div>
          {thumbnailMismatch?<p className="yt-hint">編集の縦横比が変わっています。現在の{imageFormat.ratio}で再生成してください。</p>:null}
          {thumbnail ? <button className="secondary-button" onClick={() => void save('jpg')}><Download size={15}/>JPEGを保存</button> : null}
        </div>
      </div> : null}
    </fieldset></div>
    {busy ? <div className="yt-progress" role="status"><LoaderCircle className="spin" size={17}/><span>{progress?.message || '処理しています…'}</span>{progress && progress.progress > 0 ? <progress max={1} value={progress.progress}/> : null}<button className="secondary-button" onClick={() => void window.luma?.aiCancel()}>中止</button></div> : <div className="yt-footer"><span>AI実行時は音声・入力内容をOpenAIへ送信します（API利用料）。生成内容はプロジェクトに保存できます。</span><button className="secondary-button" onClick={onClose}>編集に戻る</button></div>}
  </div></Modal>;
}

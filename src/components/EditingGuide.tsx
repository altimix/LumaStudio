import { FolderOpen, Plus, Scissors, Type, Download, Undo2 } from 'lucide-react';
import './editing-guide.css';
export default function EditingGuide({ onImport, onTitles, onExport, onNew, onShortcuts, hasClips }: { onImport():void; onTitles():void; onExport():void; onNew():void; onShortcuts():void; hasClips:boolean }) {
  return <div className="editing-guide"><p className="guide-intro">まずは短い動画で試してみましょう。操作を間違えても、<kbd>Ctrl（Macは⌘）</kbd> + <kbd>Z</kbd> で戻せます。</p>
    <ol className="guide-steps">
      <li><span className="guide-number">1</span><div><h3>素材を読み込む</h3><p>動画・写真・音声を選びます。縦長のShortsを作る場合は、新規プロジェクトで「YouTube Shorts」を選びます。</p><button className="secondary-button" onClick={onImport}><FolderOpen size={15}/>素材を選ぶ</button></div></li>
      <li><span className="guide-number">2</span><div><h3>タイムラインに並べる</h3><p>左の素材を選び「タイムラインに追加」を押すか、下のタイムラインへドラッグします。左から右へ再生されます。</p><span className="guide-inline"><Plus size={14}/>素材カードの＋ボタンでも追加できます。</span></div></li>
      <li><span className="guide-number">3</span><div><h3>いらない部分を切り、文字や音を整える</h3><p><kbd>Space</kbd> で再生・停止。切りたいクリップを選び、切りたい位置に再生ヘッドを動かして <kbd>Ctrl（Macは⌘）</kbd> + <kbd>B</kbd> で分割します。不要な部分を選んで <kbd>Delete</kbd> で削除できます。</p><p>文字はプレビューでドラッグできます。会話の音量は、クリップを選んで「オーディオ」から自動調整できます。</p><button className="secondary-button" onClick={onTitles}><Type size={15}/>文字を追加する</button></div></li>
      <li><span className="guide-number">4</span><div><h3>保存して、動画を書き出す</h3><p><kbd>Ctrl（Macは⌘）</kbd> + <kbd>S</kbd> は、後で編集を続けるための保存です。完成した動画は「書き出し」でMP4にします。「自動」のまま利用可能なGPUを使えます。</p><button className="primary-button" onClick={onExport} disabled={!hasClips}><Download size={15}/>動画の書き出しへ</button></div></li>
    </ol><div className="guide-footer"><button className="text-button" onClick={onNew}><Plus size={14}/>自分の動画を新しく作る</button><button className="text-button" onClick={onShortcuts}><Scissors size={14}/>ショートカット一覧</button></div><p className="guide-reassurance"><Undo2 size={14}/>編集しても元の素材ファイルは残ります。</p>
  </div>;
}

import { useState } from 'react';
import type { UpdateInfo } from '../types';
export default function UpdateHelp({info,checking,onCheck}:{info:UpdateInfo|null;checking:boolean;onCheck():void}) {
 const [error,setError]=useState('');
 const open=async()=>{try{setError('');await window.luma?.openUpdatePage();}catch{setError('ダウンロードページを開けませんでした。更新を再確認してください。');}};
 const mac=info?.platform==='darwin';
 const canReplace=!!info && info.status==='available' && ((mac&&info.arch==='arm64')||(info.platform==='win32'&&info.arch==='x64'));
 return <div className="update-help"><p className="modal-description">起動時に新しい安定版を確認します。編集中にアプリを入れ替えたり、終了したりすることはありません。</p>
 <div className="update-status" role="status">{checking?'更新を確認しています…':info?.status==='available'?`Luma Studio ${info.latestVersion} が利用できます。`:info?.status==='current'?'新しい安定版はありません。':info?.status==='unsupported'?`新しいバージョン ${info.latestVersion} がありますが、この環境向けの配布ファイルを確認できませんでした。`:info?.status==='error'?info.message:'更新はデスクトップ版で確認できます。'}{info&&<small>現在のバージョン：{info.currentVersion}</small>}</div>
 <div className="update-actions"><button className="primary-button" disabled={checking||!window.luma} onClick={onCheck}>更新を確認</button>{['available','unsupported'].includes(info?.status||'')&&<button className="secondary-button" onClick={()=>void open()}>ダウンロードページを開く</button>}</div>
 {error&&<p role="alert">{error}</p>}
 {canReplace&&<><h3>新しいバージョンへの入れ替え</h3><ol className="update-steps"><li>編集中のプロジェクトを保存し、書き出しが終わるのを待ちます。</li><li>ダウンロードページで{mac?'macOS-arm64.zip':'Windows.exe'}を取得します。必要に応じてSHA256SUMS.txtで確認できます。</li><li>Luma Studioを終了します。</li><li>{mac?'ZIPを展開し、今までのLuma Studio.appを新しいアプリに入れ替えます。':'新しいEXEを保存して起動します。古いEXEは新しい版の動作確認後に削除できます。'}</li><li>新しいアプリから保存済みのプロジェクトを開きます。プロジェクトや元の素材ファイルは削除しないでください。</li></ol></>}{info?.status==='unsupported'&&<p className="field-help">この環境に対応する配布ファイルを確認できていません。異なるOS・アーキテクチャ向けのアプリに入れ替えず、配布ページで対応状況を確認してください。</p>}
 {canReplace&&mac&&<p className="field-help">未署名のMac版がブロックされた場合は、システム設定 → プライバシーとセキュリティから、このアプリの起動を許可してください。詳しくは配布ページのREADME-Mac.txtをご覧ください。</p>}
 <p className="field-help">更新確認ではGitHubに接続します。プロジェクト・素材・APIキーは送信しません。通信できない場合も編集は続けられます。</p></div>;
}

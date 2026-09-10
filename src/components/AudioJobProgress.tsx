import { useEffect, useState } from 'react';
import { useAudioJob, cancelAudioJob } from '../audio-enhancement-job';
import { durationLabel, progressEstimate } from '../audio-job-progress';
import '../audio-enhancement.css';

export default function AudioJobProgress({ location }: { location: 'timeline' | 'inspector' }) {
  const job = useAudioJob(), [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!job.busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.busy, job.startedAt]);
  if (!job.message) return null;
  const percent = job.progress === 1 && !job.busy ? 100 : Math.min(99, Math.floor((job.progress || 0) * 100));
  const clock = job.finishedAt ?? now, { elapsedSeconds, remainingSeconds } = progressEstimate(job.progress, job.startedAt, clock);
  const waiting = job.busy && job.updatedAt !== null && clock - job.updatedAt >= 10000;
  return <div className={location === 'timeline' ? 'timeline-audio-job audio-job-progress' : 'audio-job-progress'}>
    <div className="audio-job-details">
      <p className="audio-treatment-status" role={location === 'timeline' ? 'status' : undefined}>{job.message}</p>
      {job.busy || job.progress === 1 ? <>
        <div className="audio-job-meter"><progress aria-label="音声の自動調整の進捗" max={100} value={percent}/><strong>{percent}%</strong></div>
        <div className="audio-job-time"><span>経過 {durationLabel(elapsedSeconds)}</span>{job.busy ? <span>{job.phase === 'saving' ? '保存を完了しています…' : remainingSeconds === null ? '残り目安を算出中…' : `残り約 ${durationLabel(remainingSeconds)}`}</span> : null}{waiting ? <span>処理の応答を待っています…</span> : null}</div>
      </> : null}
    </div>
    {location === 'timeline' ? job.busy ? <button className="text-button" onClick={cancelAudioJob}>処理を中止</button> : <button className="text-button" aria-label="音声の調整結果を閉じる" onClick={() => useAudioJob.setState({ message: '' })}>閉じる</button> : null}
  </div>;
}

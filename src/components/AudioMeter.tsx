import { Volume2 } from 'lucide-react';
import { formatMeterDb, meterPercent, meterZone, METER_YELLOW, METER_RED } from '../audio-meter';
import { resetAudioMeter, useAudioMeter } from '../meter-store';
import './AudioMeter.css';

const guide = '再生音のサンプルピーク（dBFS）。緑：−12未満、黄：−12〜−3未満、赤：−3以上。赤は上限に近い目安、CLIPは0以上への到達です。声はピーク−12〜−6程度を出発点に、聴きながら調整してください。';
const ticks = [0, -12, -24, -36, -48, -60];
export default function AudioMeter() {
  const { db, held, maximum, clipped } = useAudioMeter();
  return <aside className="audio-meter" aria-label="マスター音量メーター" title={guide}>
    <div className="meter-heading"><Volume2 size={12}/><span>MASTER</span></div>
    <button type="button" className={`meter-reset ${clipped ? 'is-clipped' : ''}`} aria-label="音量メーターのピークとCLIPをリセット" title="最大ピークとCLIPの記録を消去。音量は変わりません。" onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); }} onClick={resetAudioMeter}>{clipped ? 'CLIP' : 'ピーク解除'}</button>
    <div className="meter-body">
      <div className="meter-scale" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{ bottom: `${meterPercent(tick)}%` }}>{tick === 0 ? '0' : `−${-tick}`}</span>)}</div>
      {db.map((value, channel) => <div key={channel} className="meter-column">
        <span className="meter-channel-label" aria-hidden="true">{channel ? 'R' : 'L'}</span>
        <div className="meter-channel" role="meter" aria-label={`${channel ? '右 R' : '左 L'} 音量`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.max(-60, Math.min(0, value))} aria-valuetext={`${formatMeterDb(value)} dBFS`} data-db={Number.isFinite(value) ? value : '-Infinity'} data-zone={meterZone(value)}>
          <div className="meter-zones" aria-hidden="true"/>
          <div className="meter-lit" style={{ clipPath: `inset(${100 - meterPercent(value)}% 0 0 0)` }} aria-hidden="true"/>
          {[METER_YELLOW, METER_RED].map(boundary => <span key={boundary} className="meter-boundary" style={{ bottom: `${meterPercent(boundary)}%` }} aria-hidden="true"/>)}
          <span className="meter-peak" style={{ bottom: `${meterPercent(held[channel])}%`, visibility: held[channel] >= -60 ? 'visible' : 'hidden' }} aria-hidden="true"/>
        </div>
      </div>)}
    </div>
    <span className="meter-reading">{formatMeterDb(Math.max(...db))} dBFS</span>
    <span className="meter-maximum" title="リセットしてからの最大サンプルピーク">最大 {formatMeterDb(maximum)}</span>
  </aside>;
}

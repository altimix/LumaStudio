const {test}=require('node:test');const assert=require('node:assert/strict');
const {progressReader,audioProgress}=require('../electron/audio-progress.cjs');
test('FFmpeg progress parser handles split records, microseconds and invalid timestamps',()=>{
 const events=[],read=progressReader(value=>events.push(value));
 for(const chunk of ['out_time_u','s=1500000\r\nspeed=12x\npro','gress=continue\nout_time_ms=2000000\nprogress=end\n','out_time_us=N/A\nprogress=continue\n','out_time_us=-900\nprogress=continue\n'])read(Buffer.from(chunk));
 assert.deepEqual(events,[{seconds:1.5,done:false},{seconds:2,done:true}]);
});
test('phase progress is monotonic and reserves completion until publication',()=>{
 const events=[],send=audioProgress(100,p=>events.push(p));
 send('analysis',50);send('analysis',10);send('analysis',100,true);send('processing',100,true);send('correction',100,true);send('saving');
 assert.ok(events.every((e,i)=>e.progress>=(events[i-1]?.progress||0)&&e.progress<1));assert.equal(events[0].progress,.3);assert.equal(events[1].progress,.3);assert.equal(events.at(-1).phase,'saving');
 send('complete');assert.equal(events.at(-1).progress,1);
});

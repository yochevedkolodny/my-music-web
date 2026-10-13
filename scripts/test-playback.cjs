const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Gain {constructor(){this.gain={value:1,events:[],setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t])},linearRampToValueAtTime(v,t){this.events.push(['ramp',v,t])},cancelScheduledValues(t){this.events.push(['cancel',t])}}}connect(){}disconnect(){}}
class Source {connect(){}disconnect(){}start(time,offset){this.at=time;this.offset=offset}stop(){this.stopped=true}}
class Context {constructor(){this.currentTime=0;this.destination={}}resume(){return Promise.resolve()}createGain(){return new Gain()}createBufferSource(){return new Source()}async decodeAudioData(){return {duration:10,length:480000,numberOfChannels:1}}}
class Element extends EventTarget {constructor(){super();this.paused=true;this.currentTime=0;this.duration=10;this.readyState=1;this.src=''}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}load(){}getAttribute(n){return this[n]}removeAttribute(n){this[n]=''}}
const sandbox={Event,EventTarget,fetch:async()=>({arrayBuffer:async()=>new ArrayBuffer(100)}),setInterval:()=>1,clearInterval(){}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('playback.js','utf8'),sandbox);
async function ready(p){await p.play();await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
 const p=new sandbox.MusicAudio(new Element(),Context);p.configure('gapless');p.src='blob:one';p.nextTrack=()=>({id:2,url:'blob:two',manual:true});
 let adopted=[];p.addEventListener('trackchange',e=>adopted.push(e.detail.id));await ready(p);
 assert.equal(p.current.start,0);assert.equal(p.pending.start,10);assert.equal(p.pending.source.at,10,'next track scheduled exactly at current end');
 p.context.currentTime=10;p.tick();assert.equal(p.src,'blob:two');assert.equal(adopted[0],2);assert.equal(p.currentTime,0);
 p.context.currentTime=12;p.pause();assert.equal(p.currentTime,2);assert.equal(p.current,null);await ready(p);assert.equal(p.current.offset,2);
 p.currentTime=5;await new Promise(resolve=>setImmediate(resolve));assert.equal(p.current.offset,5);assert.equal(p.currentTime,5);
 const before=p.pending;p.nextTrack=()=>null;p.invalidateUpcoming();assert.equal(p.pending,null);if(before)assert.equal(before.source.stopped,true);
 p.pause();p.configure('crossfade',3);p.src='blob:one';p.nextTrack=()=>({id:2,url:'blob:two'});await ready(p);
 assert.equal(p.pending.start,p.current.start+7,'3 second overlap');assert.deepEqual(p.pending.gain.gain.events.slice(0,2).map(x=>x.slice(0,2)),[['set',0],['ramp',1]]);
 p.pause();p.configure('standard');assert.equal(p.active,false);await p.play();assert.equal(p.paused,false);
 const q=new sandbox.MusicAudio(new Element(),Context);q.configure('gapless');q.src='blob:repeat';q.nextTrack=()=>({id:1,url:'blob:repeat'});await ready(q);assert.equal(q.pending.start,10);
 q.pause();q.src='blob:slow';q.decode=()=>new Promise(resolve=>{q.finishDecode=resolve});const loading=q.play();q.pause();q.finishDecode({duration:10});await loading;assert.equal(q.current,null,'paused during decode never starts playback');
 // Restoring a saved seek from metadata must not recursively load metadata.
 const r=new sandbox.MusicAudio(new Element(),Context);r.configure('gapless');r.src='blob:resume';let count=0;r.onloadedmetadata=()=>{count++;r.currentTime=4};await ready(r);assert.equal(count,1);assert.equal(r.current.offset,4);
 console.log('PASS: exact boundary, crossfade gains, queue adoption, pause/resume, seeking, invalidation, repeat, decode cancellation and saved-position restore');
})().catch(e=>{console.error(e);process.exitCode=1});

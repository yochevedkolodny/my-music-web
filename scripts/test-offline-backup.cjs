'use strict';
const {chromium}=require('playwright');
const {assert,root,serve,wav}=require('./test-interface-helpers.cjs');
(async()=>{
 const server=await serve(root),browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Seed an old cache and existing user-owned IndexedDB before loading the new app.
  await page.goto(server.url+'/blank-before-install',{waitUntil:'load'});
  await page.evaluate(async({url,audio})=>{
   const cache=await caches.open('my-music-v2');await cache.put(url+'/',new Response('<html><body>STALE OLD APP</body></html>',{headers:{'Content-Type':'text/html'}}));
   localStorage.setItem('my-music-local-profile-v1',JSON.stringify({name:'Offline profile',photo:''}));
   await new Promise((resolve,reject)=>{
    const request=indexedDB.open('my-music-local-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('tracks',{keyPath:'id',autoIncrement:true});
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').add({name:'Offline preserved song',artist:'Offline QA',album:'Original library',favorite:true,blob:new Blob([Uint8Array.from(atob(audio),c=>c.charCodeAt(0))],{type:'audio/wav'})});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};
   });
  },{url:server.url,audio:wav(3).toString('base64')});
  await page.goto(server.url,{waitUntil:'load'});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>navigator.serviceWorker.controller&&typeof MusicBackup!=='undefined'&&songs.length===1);
  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>typeof MusicBackup!=='undefined'&&songs.length===1);
  const result=await page.evaluate(async()=>{
   const backup=await MusicBackup.readLibrary(await MusicBackup.exportLibrary({songs,preferences:MusicBackup.capturePreferences(localStorage)}));
   return {version:backup.version,name:songs[0].name,backupName:backup.songs[0].name,profile:JSON.parse(backup.preferences['my-music-local-profile-v1']).name,profileUI:profileData.name,oldCache:(await caches.keys()).includes('my-music-v2'),controller:!!navigator.serviceWorker.controller};
  });
  assert.deepEqual(result,{version:3,name:'Offline preserved song',backupName:'Offline preserved song',profile:'Offline profile',profileUI:'Offline profile',oldCache:true,controller:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: offline relaunch uses v3 backup assets despite retained old cache, without clearing existing songs or profile');
 }finally{await browser.close();await server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

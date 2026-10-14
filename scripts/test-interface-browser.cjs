'use strict';
const {fs,path,assert,wav,start,poll,library,openSettings,options,closeFull,report}=require('./test-interface-helpers.cjs');
// An upgrade and additive restore must never wipe the user's existing web stores.
function forbidDestructiveStorage(){
 window.__destructiveStorageCalls=JSON.parse(sessionStorage.getItem('__qaDestructiveStorageCalls')||'[]');
 const deny=label=>function(){window.__destructiveStorageCalls.push(label);sessionStorage.setItem('__qaDestructiveStorageCalls',JSON.stringify(window.__destructiveStorageCalls));throw new Error('Destructive storage operation blocked: '+label)};
 Storage.prototype.clear=deny('Storage.clear');
 IDBFactory.prototype.deleteDatabase=deny('indexedDB.deleteDatabase');
 IDBDatabase.prototype.deleteObjectStore=deny('IDBDatabase.deleteObjectStore');
 IDBObjectStore.prototype.clear=deny('IDBObjectStore.clear');
}
(async()=>{
 const app=await start(undefined,{init:forbidDestructiveStorage});const {page,errors,dialogs,tmp}=app;
 try{
  await page.evaluate(()=>{localStorage.setItem('my-music-future-raw-v1',' preserved raw value\n');localStorage.setItem('unrelated-app-preservation','keep me')});
  const imports=['QA Artist - Alpha.wav','QA Artist - Beta.wav','Other Artist - Gamma.wav'].map((name,i)=>({name,mimeType:'audio/wav',buffer:wav(90,220+i*110)}));
  await page.locator('#file').setInputFiles(imports);
  await poll(page,()=>songs.length===3);
  await library(page);
  assert.equal(await page.locator('#list .song').count(),3);
  assert.deepEqual(await page.evaluate(()=>songs.map(s=>[s.name,s.artist,s.blob.type])),[['Alpha','QA Artist','audio/wav'],['Beta','QA Artist','audio/wav'],['Gamma','Other Artist','audio/wav']]);
  report('browser fallback imports synthetic WAVs and infers artist/title locally');

  await page.getByRole('button',{name:'Add to Favorites: Alpha',exact:true}).click();
  await poll(page,()=>songs.find(s=>s.name==='Alpha').favorite===true);
  await page.locator('[data-nav="home"]').click();await page.locator('#homeFavorites').click();
  assert.equal(await page.locator('#list .song').count(),1);assert.match(await page.locator('#list').innerText(),/Alpha/);
  await library(page);await options(page,'Alpha');await page.locator('#sheetEdit').click();await page.locator('#sheetEditSingle').click();
  await page.locator('#editTitle').fill('Alpha Edited');await page.locator('#editArtist').fill('Renamed Artist');await page.locator('#editAlbum').fill('QA Album');
  await page.locator('#sheetEditForm button[type="submit"]').click();
  await poll(page,()=>songs.some(s=>s.name==='Alpha Edited'&&s.artist==='Renamed Artist'&&s.album==='QA Album'&&s.favorite));
  report('favorites collection and song title, artist and album editing persist');

  await page.locator('#libraryCategoryButton').click();await page.locator('[data-tab="artists"]').click();
  await page.getByRole('button',{name:'Manage picture for Renamed Artist',exact:true}).click();
  assert.equal(await page.locator('#artistPhotoRemove').isVisible(),false);
  const png=fs.readFileSync(path.join(__dirname,'../tests/synthetic-portrait.png'));
  await page.locator('#artistPhotoChoose').click();await page.locator('#artistPhotoInput').setInputFiles({name:'synthetic-portrait.png',mimeType:'image/png',buffer:png});
  await poll(page,()=>!!JSON.parse(localStorage.getItem('my-music-artist-photos-v1')||'{}')['renamed artist']);
  await page.getByRole('button',{name:'Manage picture for Renamed Artist',exact:true}).click();await page.locator('#artistPhotoRemove').click();
  await poll(page,()=>!JSON.parse(localStorage.getItem('my-music-artist-photos-v1')||'{}')['renamed artist']);
  assert.equal(await page.locator('.artist-list-portrait img').count(),0);
  report('artist photo add/remove updates portraits and persistent storage');

  await page.locator('[data-nav="playlists"]').click();await page.locator('#newPlaylist').click();await page.locator('#playlistEditorInput').fill('QA Ordered Mix');
  await page.locator('#playlistEditorForm').evaluate(form=>form.requestSubmit());
  await page.locator('#playlistAddSongs').click();
  await page.locator('#pickerItems input').nth(0).check();await page.locator('#pickerItems input').nth(1).check();await page.locator('#pickerItems input').nth(2).check();await page.locator('#pickerSave').click();
  await poll(page,()=>playlists.find(p=>p.name==='QA Ordered Mix')?.ids.length===3);
  assert.deepEqual(await page.locator('#list .song-name').allTextContents(),['Alpha Edited','Beta','Gamma']);
  await page.locator('#playlistDetailMenuButton').click();await page.locator('#playlistMenuReorder').click();
  await page.getByRole('button',{name:'Move Gamma up',exact:true}).click();
  assert.deepEqual(await page.locator('#list .song-name').allTextContents(),['Alpha Edited','Gamma','Beta']);
  await page.locator('#playlistDetailBack').click();await page.locator('#list .group').filter({hasText:'QA Ordered Mix'}).click();
  assert.deepEqual(await page.locator('#list .song-name').allTextContents(),['Alpha Edited','Gamma','Beta']);
  report('playlist creation, song picker, reordering and detail navigation preserve order');

  await openSettings(page);
  await page.locator('button[data-appearance="light"]').click();
  assert.equal(await page.locator('html').getAttribute('data-appearance'),'light');assert.equal(await page.locator('button[data-appearance="light"]').getAttribute('aria-pressed'),'true');
  await page.locator('#settingsClose').click();await page.screenshot({path:path.join(tmp,'library-light.png')});
  await openSettings(page);await page.locator('button[data-appearance="dark"]').click();assert.equal(await page.locator('html').getAttribute('data-appearance'),'dark');await page.locator('#settingsClose').click();
  await page.screenshot({path:path.join(tmp,'library-dark.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  report('light/dark appearance, selected controls and 390px horizontal fit');

  await page.locator('#list .song').filter({hasText:'Alpha Edited'}).locator('.song-info').click();
  await poll(page,()=>!audio.paused&&audio.duration>0);await page.locator('#play').click();await poll(page,()=>audio.paused);
  await page.locator('#openPlayer').click();await page.locator('#fullRepeat').click();assert.equal(await page.locator('#fullRepeat').innerText(),'Repeat: All');
  await page.locator('#fullRepeat').click();assert.equal(await page.locator('#fullRepeat').innerText(),'Repeat: One');
  await page.locator('#fullRepeat').click();assert.equal(await page.locator('#fullRepeat').innerText(),'Repeat: Off');
  await page.locator('#fullShuffle').click();assert.equal(await page.locator('#fullShuffle').innerText(),'Shuffle: on');
  const q=await page.evaluate(()=>({queue:[...queue],current:songs[idx].id,shuffle}));assert.equal(new Set(q.queue).size,3);assert.equal(q.shuffle,true);
  await closeFull(page);
  for(const name of ['Beta','Gamma']){await options(page,name);await page.locator('#sheetAddQueue').click()}
  await page.locator('#openPlayer').click();await page.locator('#openQueue').click();
  assert.equal(await page.locator('.queued-song[data-queue-index]').count(),2);
  await page.getByRole('button',{name:'Move Gamma up',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>manualQueue.map(id=>songs.find(s=>s.id===id).name)),['Gamma','Beta']);
  await page.getByRole('button',{name:'Remove Beta from queue',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>manualQueue.map(id=>songs.find(s=>s.id===id).name)),['Gamma']);
  const currentBefore=await page.evaluate(()=>songs[idx].id);await page.locator('#clearQueue').click();
  await poll(page,()=>upcoming().length===0);assert.equal(await page.evaluate(()=>songs[idx].id),currentBefore);
  await page.locator('#closeQueue').click();await closeFull(page);
  report('real browser playback, pause, repeat cycle, shuffle and queue reorder/remove/clear');

  await page.reload();await poll(page,()=>songs.length===3);await library(page);
  assert.deepEqual(await page.evaluate(()=>[db.name,db.version,Array.from(db.objectStoreNames)]),['my-music-local-v1',1,['tracks']]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('my-music-future-raw-v1')),' preserved raw value\n');
  assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-app-preservation')),'keep me');
  assert.deepEqual(await page.evaluate(()=>window.__destructiveStorageCalls),[]);
  assert.equal(await page.locator('html').getAttribute('data-appearance'),'dark');
  assert.deepEqual(await page.evaluate(()=>{const s=songs.find(s=>s.name==='Alpha Edited');return [s.artist,s.album,s.favorite]}),['Renamed Artist','QA Album',true]);
  assert.deepEqual(await page.evaluate(()=>playlists.find(p=>p.name==='QA Ordered Mix').ids.map(id=>songs.find(s=>s.id===id).name)),['Alpha Edited','Gamma','Beta']);
  assert.equal(await page.evaluate(()=>Object.keys(artistPhotos).length),0);
  report('reload preserves library metadata, favorites, playlist order, appearance and removed artist photo');
  await page.locator('#profileOpen').click();await page.locator('#profileName').fill('Synthetic Listener');await page.locator('#profileForm button[type="submit"]').click();await page.locator('#profileClose').click();
  await library(page);
  await page.locator('#list .song').filter({hasText:'Beta'}).locator('.song-info').click();
  await poll(page,()=>!audio.paused&&audio.duration>0);await page.locator('#play').click();await poll(page,()=>audio.paused);
  await page.evaluate(()=>{const beta=songs.find(s=>s.name==='Beta').id,gamma=songs.find(s=>s.name==='Gamma').id,alpha=songs.find(s=>s.name==='Alpha Edited').id;audio.currentTime=17.5;queue=[beta,gamma,alpha];queuePos=0;shuffle=true;manualQueue=[gamma];manualPlayed.clear();playHistory=[alpha];persistManual();saveQueue();savePosition(true)});
  await openSettings(page);const downloading=page.waitForEvent('download');await page.locator('#backupLibrary').click();const download=await downloading;const zipBytes=fs.readFileSync(await download.path());
  const restoreContext=await app.browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await restoreContext.addInitScript(forbidDestructiveStorage);
  const restored=await restoreContext.newPage(),restoreDialogs=[];let acceptRestore=true,restoreNavigations=0;
  restored.on('pageerror',error=>errors.push('Restored page: '+error.message));
  restored.on('framenavigated',frame=>{if(frame===restored.mainFrame())restoreNavigations++});
  restored.on('dialog',async d=>{restoreDialogs.push(d.message());if(d.type()==='confirm'&&!acceptRestore)await d.dismiss();else await d.accept()});
  const restoreSuccessfully=async()=>{const loaded=restored.waitForEvent('load');await restored.locator('#restoreFile').setInputFiles({name:'synthetic-backup.zip',mimeType:'application/zip',buffer:zipBytes});await loaded;await poll(restored,()=>typeof db!=='undefined'&&db&&songs.length===3&&idx>=0&&audio.duration>0)};
  try{
   await restored.goto(app.server.url);await poll(restored,()=>typeof db!=='undefined'&&db);
   await restoreSuccessfully();
   assert.deepEqual(await restored.evaluate(()=>{const song=songs.find(s=>s.name==='Alpha Edited');return [song.artist,song.album,song.favorite]}),['Renamed Artist','QA Album',true]);
   assert.deepEqual(await restored.evaluate(()=>playlists.find(p=>p.name==='QA Ordered Mix').ids.map(id=>songs.find(s=>s.id===id).name)),['Alpha Edited','Gamma','Beta']);
   assert.equal(await restored.locator('html').getAttribute('data-appearance'),'dark');assert.equal(await restored.evaluate(()=>profileData.name),'Synthetic Listener');assert.equal(await restored.evaluate(()=>Object.keys(artistPhotos).length),0);
   assert.equal(await restored.evaluate(()=>localStorage.getItem('my-music-future-raw-v1')),' preserved raw value\n');
   assert.equal(await restored.evaluate(()=>localStorage.getItem('unrelated-app-preservation')),null,'Unrelated app data is excluded from backup');
   const originalIDs=await restored.evaluate(()=>songs.map(song=>song.id));
   await restoreSuccessfully();assert.equal(await restored.evaluate(()=>songs.length),3);
   assert.deepEqual(await restored.evaluate(()=>songs.map(song=>song.id)),originalIDs,'Duplicate restore preserves original IDs');

   assert.deepEqual(await restored.evaluate(()=>({current:songs[idx].name,queue:queue.map(id=>songs.find(song=>song.id===id).name),manual:manualQueue.map(id=>songs.find(song=>song.id===id).name),paused:audio.paused,resume:JSON.parse(localStorage.getItem('my-music-resume-v1')).position})),{current:'Beta',queue:['Beta','Gamma','Alpha Edited'],manual:['Gamma'],paused:true,resume:17.5});
   assert.ok(Math.abs(await restored.evaluate(()=>audio.currentTime)-17.5)<0.25,'Restored audio resumes at the saved position without autoplay');
   await library(restored);await restored.locator('#list .song').filter({hasText:'Gamma'}).locator('.song-info').click();
   await poll(restored,()=>songs[idx].name==='Gamma'&&!audio.paused&&audio.duration>0);
   await restored.evaluate(()=>{const gamma=songs.find(s=>s.name==='Gamma').id,beta=songs.find(s=>s.name==='Beta').id,alpha=songs.find(s=>s.name==='Alpha Edited').id;audio.currentTime=23.25;queue=[gamma,beta];queuePos=0;manualQueue=[alpha];manualPlayed.clear();persistManual();saveQueue();savePosition(true)});
   acceptRestore=false;const beforeCancelNavigation=restoreNavigations,waitCancel=restored.waitForEvent('dialog');
   await restored.locator('#restoreFile').setInputFiles({name:'synthetic-backup.zip',mimeType:'application/zip',buffer:zipBytes});
   assert.equal((await waitCancel).type(),'confirm');await poll(restored,()=>!document.querySelector('#restoreLibrary').disabled);await restored.waitForTimeout(150);
   assert.equal(restoreNavigations,beforeCancelNavigation,'Cancel must not reload');assert.deepEqual(await restored.evaluate(()=>[songs[idx].name,audio.paused]),['Gamma',false],'Cancel leaves current playback untouched');

   await restored.evaluate(()=>{
    const originalSetItem=Storage.prototype.setItem;let injected=false;
    const snapshot=()=>JSON.stringify({preferences:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])),current:songs[idx]?.id,queue,queuePos,manualQueue,manualPlayed:[...manualPlayed],history:playHistory,source:audio.src,paused:audio.paused});
    Storage.prototype.setItem=function(key,value){
     const result=originalSetItem.call(this,key,value);
     if(this===localStorage&&backupRestoreInProgress&&!injected){
      injected=true;const audit={guard:backupRestoreInProgress,events:[],changed:[]},other=songs.find(song=>song.name==='Beta').id;
      const run=(name,emit)=>{const before=snapshot();emit();audit.events.push(name);if(snapshot()!==before)audit.changed.push(name)};
      run('timeupdate',()=>audio.emit('timeupdate'));
      run('ended',()=>audio.emit('ended'));
      run('loadedmetadata',()=>audio.emit('loadedmetadata'));
      run('trackchange',()=>audio.emit('trackchange',{id:other,manual:true}));
      const visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
      try{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});run('visibilitychange',()=>document.dispatchEvent(new Event('visibilitychange')))}
      finally{if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete document.visibilityState}
      run('pagehide',()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
      sessionStorage.setItem('__qaOldEvents',JSON.stringify(audit));
     }
     return result;
    };
   });
   acceptRestore=true;await restoreSuccessfully();await restored.waitForTimeout(350);
   assert.deepEqual(await restored.evaluate(()=>JSON.parse(sessionStorage.getItem('__qaOldEvents'))),{guard:true,events:['timeupdate','ended','loadedmetadata','trackchange','visibilitychange','pagehide'],changed:[]},'Late old-media and lifecycle events cannot alter state during the guarded preferences commit');
   const expectedActiveRestore={current:'Beta',queue:['Gamma','Beta','Alpha Edited'],queuePos:1,manual:['Alpha Edited','Gamma'],paused:true,resume:17.5};
   const playbackSnapshot=()=>restored.evaluate(()=>({current:songs[idx].name,queue:queue.map(id=>songs.find(song=>song.id===id).name),queuePos,manual:manualQueue.map(id=>songs.find(song=>song.id===id).name),paused:audio.paused,resume:JSON.parse(localStorage.getItem('my-music-resume-v1')).position}));
   assert.deepEqual(await playbackSnapshot(),expectedActiveRestore,'Successful restore replaces the active current/resume and merges queues without stale writes or autoplay');
   assert.ok(Math.abs(await restored.evaluate(()=>audio.currentTime)-17.5)<0.25);
   await restored.reload();await poll(restored,()=>typeof db!=='undefined'&&db&&songs.length===3&&idx>=0&&audio.duration>0);
   assert.deepEqual(await playbackSnapshot(),expectedActiveRestore,'Restored playback survives another pagehide/reload');
   report('active-playback restore hydrates the incoming current/resume and additive queues without autoplay; cancel preserves playback without navigation');
   const beforeCorruptNavigation=restoreNavigations;
   const beforeCorrupt=await restored.evaluate(()=>({metadata:songs.map(({blob,art,...metadata})=>metadata),preferences:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))}));
   const bad=Buffer.from(zipBytes);bad[45]^=1;await restored.locator('#restoreFile').setInputFiles({name:'synthetic-corrupt.zip',mimeType:'application/zip',buffer:bad});await poll(restored,()=>!document.querySelector('#restoreLibrary').disabled);
   assert.equal(await restored.evaluate(()=>songs.length),3);assert.ok(restoreDialogs.some(message=>message.startsWith('Restore failed:')));
   await restored.waitForTimeout(150);assert.equal(restoreNavigations,beforeCorruptNavigation,'Corrupt restore must not reload');
   assert.deepEqual(await restored.evaluate(()=>({metadata:songs.map(({blob,art,...metadata})=>metadata),preferences:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))})),beforeCorrupt,'Corrupt ZIP must leave the existing library and preferences unchanged');
   assert.deepEqual(await restored.evaluate(()=>window.__destructiveStorageCalls),[]);
   report('real v3 browser backup download and fresh-profile restore preserve metadata/favorites/order/profile/theme; duplicate import is idempotent and corrupt ZIP rejected');
  }finally{await restoreContext.close()}

  const quotaContext=await app.browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await quotaContext.addInitScript(forbidDestructiveStorage);
  const quotaPage=await quotaContext.newPage();let quotaNavigations=0;
  quotaPage.on('framenavigated',frame=>{if(frame===quotaPage.mainFrame())quotaNavigations++});
  quotaPage.on('pageerror',error=>errors.push('Quota page: '+error.message));
  quotaPage.on('dialog',async dialog=>dialog.accept());
  try{
   await quotaPage.goto(app.server.url);await poll(quotaPage,()=>typeof db!=='undefined'&&db);
   await quotaPage.locator('#file').setInputFiles({name:'Existing Artist - Quota Existing.wav',mimeType:'audio/wav',buffer:wav(90,770)});
   await poll(quotaPage,()=>songs.length===1);await library(quotaPage);
   await quotaPage.locator('#list .song .song-info').click();await poll(quotaPage,()=>!audio.paused&&audio.duration>0);
   await quotaPage.evaluate(()=>{
    profileData={name:'Original Quota Profile',photo:''};saveProfile();appearanceChoice='light';localStorage.setItem('my-music-appearance-v1','light');applyAppearance();
    localStorage.setItem('my-music-qa-original-raw',' original raw value\n');
    audio.currentTime=9.25;savePosition(true);lastPositionSave=Infinity;totalListeningSeconds=1231;localStorage.setItem(listeningTimeKey,'1231');playCounted=true;
    const originalSetItem=Storage.prototype.setItem;let failed=false;
    window.__quotaWrites=0;window.__quotaThrown=0;
    Storage.prototype.setItem=function(key,value){
     if(this===localStorage&&backupRestoreInProgress&&!failed&&localStorage.getItem(key)!==String(value)){
      if(!window.__quotaBefore)window.__quotaBefore={preferences:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])),source:audio.src,current:songs[idx].id,queue:[...queue],queuePos,manual:[...manualQueue],paused:audio.paused};
      if(++window.__quotaWrites===3){failed=true;window.__quotaThrown++;throw new DOMException('Synthetic quota failure','QuotaExceededError')}
     }
     return originalSetItem.call(this,key,value);
    };
   });
   const beforeQuotaNavigation=quotaNavigations,failure=quotaPage.waitForEvent('dialog',{predicate:dialog=>dialog.type()==='alert'});
   await quotaPage.locator('#restoreFile').setInputFiles({name:'synthetic-backup.zip',mimeType:'application/zip',buffer:zipBytes});
   assert.match((await failure).message(),/previous settings were restored and imported songs were kept/i);
   await poll(quotaPage,()=>songs.length===4&&!document.querySelector('#restoreLibrary').disabled);
   assert.equal(quotaNavigations,beforeQuotaNavigation,'Preference quota failure must not navigate');
   const quotaState=await quotaPage.evaluate(()=>({before:window.__quotaBefore,writes:window.__quotaWrites,thrown:window.__quotaThrown,preferences:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])),source:audio.src,current:songs[idx].id,queue:[...queue],queuePos,manual:[...manualQueue],paused:audio.paused,names:songs.map(song=>song.name),guard:backupRestoreInProgress,destructive:window.__destructiveStorageCalls}));
   assert.equal(quotaState.writes,3,'Fail exactly the third changed preference write');assert.equal(quotaState.thrown,1,'Inject quota failure only once so rollback can complete');
   assert.deepEqual(quotaState.preferences,quotaState.before.preferences,'Quota rollback restores every original raw preference exactly');
   for(const key of ['source','current','queue','queuePos','manual','paused'])assert.deepEqual(quotaState[key],quotaState.before[key],'Quota rollback preserves old playback '+key);
   assert.equal(quotaState.paused,false,'Previously playing audio continues after reversible preference failure');
   assert.deepEqual(quotaState.names,['Quota Existing','Alpha Edited','Beta','Gamma'],'Original and additive imported songs survive preference rollback');
   assert.equal(quotaState.guard,false);assert.deepEqual(quotaState.destructive,[]);
   report('third-write quota failure rolls back raw preferences exactly, keeps original active playback/source and retains all additive songs without navigation');
  }finally{await quotaContext.close()}

  // Inspect real downloaded bytes independently of the page's export handler.
  const backupSandbox={Blob,TextEncoder,TextDecoder,Uint8Array,DataView,ArrayBuffer,Map,Set};
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../backup.js'),'utf8'),backupSandbox);
  for(const mode of ['gapless','crossfade']){
   if(await page.locator('#settingsPanel').isVisible())await page.locator('#settingsClose').click();
   await openSettings(page);await page.locator('#transitionMode').selectOption(mode);
   await poll(page,expected=>audio.active&&audio.mode===expected&&audio.paused&&!Number.isFinite(audio.duration),mode);
   const modeDownloadEvent=page.waitForEvent('download');await page.locator('#backupLibrary').click();
   const modeZip=fs.readFileSync(await (await modeDownloadEvent).path());
   const modeArchive=await backupSandbox.MusicBackup.readLibrary(new Blob([modeZip]));
   assert.equal(modeArchive.preferences['my-music-transition-v1'],mode);
   assert.equal(JSON.parse(modeArchive.preferences['my-music-resume-v1']).position,17.5);
   const modeContext=await app.browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   await modeContext.addInitScript(forbidDestructiveStorage);
   const modePage=await modeContext.newPage();
   modePage.on('pageerror',error=>errors.push(mode+' page: '+error.message));
   modePage.on('dialog',async dialog=>dialog.accept());
   try{
    await modePage.goto(app.server.url);await poll(modePage,()=>typeof db!=='undefined'&&db);
    const reloaded=modePage.waitForEvent('load');
    await modePage.locator('#restoreFile').setInputFiles({name:mode+'-backup.zip',mimeType:'application/zip',buffer:modeZip});await reloaded;
    await poll(modePage,expected=>typeof db!=='undefined'&&db&&songs.length===3&&idx>=0&&audio.active&&audio.mode===expected,mode);
    const beforeFirstPlay=()=>modePage.evaluate(()=>({current:songs[idx].name,resume:JSON.parse(localStorage.getItem('my-music-resume-v1')).position,paused:audio.paused,undecoded:!Number.isFinite(audio.duration)}));
    assert.deepEqual(await beforeFirstPlay(),{current:'Beta',resume:17.5,paused:true,undecoded:true},mode+' restore must preserve resume before its first decode/play');
    await openSettings(modePage);const exportedEvent=modePage.waitForEvent('download');await modePage.locator('#backupLibrary').click();
    const reexported=await backupSandbox.MusicBackup.readLibrary(new Blob([fs.readFileSync(await (await exportedEvent).path())]));
    assert.equal(JSON.parse(reexported.preferences['my-music-resume-v1']).position,17.5,mode+' backup before first play retains the incoming position');
    assert.deepEqual(await beforeFirstPlay(),{current:'Beta',resume:17.5,paused:true,undecoded:true},mode+' export must not overwrite resume with an undecoded zero position');
    await modePage.reload();await poll(modePage,expected=>typeof db!=='undefined'&&db&&songs.length===3&&idx>=0&&audio.active&&audio.mode===expected,mode);
    assert.deepEqual(await beforeFirstPlay(),{current:'Beta',resume:17.5,paused:true,undecoded:true},mode+' pagehide and second reload retain the incoming position');
    await modePage.locator('#play').click();await poll(modePage,()=>!audio.paused&&audio.duration>0&&audio.currentTime>=17.5);
    assert.ok(await modePage.evaluate(()=>audio.currentTime<20),mode+' first playback starts at the restored position');
    assert.deepEqual(await modePage.evaluate(()=>window.__destructiveStorageCalls),[]);
    report(mode+' before-first-play export and second reload preserve resume, with first playback starting at the saved position');
   }finally{await modeContext.close()}
  }
  assert.deepEqual(errors,[],'No uncaught JavaScript errors');
  assert.equal(dialogs.filter(d=>d.type==='alert').length,0,'No unexpected alert errors');
  console.log('PASS: all browser fallback interface checks. Screenshots: '+tmp);
 }catch(error){await page.screenshot({path:path.join(tmp,'failure.png')}).catch(()=>{});console.error('Failure screenshot: '+tmp+'/failure.png');console.error('Page errors:',errors);console.error('Dialogs:',dialogs);throw error}
 finally{await app.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

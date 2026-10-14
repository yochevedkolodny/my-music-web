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
   acceptRestore=true;await restoreSuccessfully();await restored.waitForTimeout(350);
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
  assert.deepEqual(errors,[],'No uncaught JavaScript errors');
  assert.equal(dialogs.filter(d=>d.type==='alert').length,0,'No unexpected alert errors');
  console.log('PASS: all browser fallback interface checks. Screenshots: '+tmp);
 }catch(error){await page.screenshot({path:path.join(tmp,'failure.png')}).catch(()=>{});console.error('Failure screenshot: '+tmp+'/failure.png');console.error('Page errors:',errors);console.error('Dialogs:',dialogs);throw error}
 finally{await app.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

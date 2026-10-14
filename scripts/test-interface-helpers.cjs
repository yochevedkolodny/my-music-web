'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
function wav(seconds=90,frequency=330){
 const rate=8000,samples=rate*seconds,b=Buffer.alloc(44+samples*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*frequency*Math.PI*2/rate)*128),44+i*2);
 return b;
}
async function serve(directory){
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(directory,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(directory+path.sep)){res.writeHead(403);return res.end()}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data)})
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function start(source=process.env.MUSIC_WEB_SOURCE||root,options={}){
 const server=await serve(path.resolve(source)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'music-interface-qa-'));
 let browser;try{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']})}catch(error){await server.close();throw error};
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'block',colorScheme:'dark'});
 if(options.init)await context.addInitScript(options.init,options.initArg);
 const page=await context.newPage(),errors=[],dialogs=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});await dialog.accept()});
 page.setDefaultTimeout(8000);
 await page.goto(server.url,{waitUntil:'load'});
 await page.waitForFunction(()=>typeof songs!=='undefined'&&typeof db!=='undefined'&&db);
 return {page,context,browser,server,tmp,errors,dialogs,async close(){await browser.close();await server.close()}};
}
async function poll(page,fn,arg){await page.waitForFunction(fn,arg,{timeout:8000})}
async function library(page){
 await page.locator('[data-nav="library"]').click();
 await page.locator('#libraryScreen').waitFor({state:'visible'});
 await poll(page,()=>mainPage==='library'&&view==='songs'&&!groupFilter&&!document.body.classList.contains('playlist-detail-active')&&!document.body.classList.contains('artist-detail-active'));
}
async function openSettings(page){
 // The preserved interface intentionally hides the legacy #settingsOpen control.
 // Reach Settings through its visible Profile entry after leaving detail screens.
 await library(page);
 await page.locator('#profileOpen').click();
 await page.locator('#profilePanel').waitFor({state:'visible'});
 await page.locator('#profileSettingsButton').click();
 await page.locator('#settingsPanel').waitFor({state:'visible'});
}
async function options(page,name){await page.getByRole('button',{name:'Options for '+name,exact:true}).click()}
async function closeFull(page){if(await page.locator('#fullPlayer').evaluate(el=>el.classList.contains('open'))){await page.locator('#closePlayer').click();await poll(page,()=>!document.querySelector('#fullPlayer').classList.contains('open'));await page.waitForTimeout(380)}}
function report(name){console.log('PASS: '+name)}
module.exports={fs,path,assert,root,wav,serve,start,poll,library,openSettings,options,closeFull,report};

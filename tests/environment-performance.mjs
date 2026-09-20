/** Repeatable browser workload; instrumentation is injected only into the test page. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const url = process.env.TEST_URL || 'http://127.0.0.1:8088/';
const output = process.env.EVIDENCE_DIR || '../results/usd_inspector_performance/current';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
 args: ['--no-sandbox', '--enable-webgl', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: {width: 1440, height: 900}, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
if (process.env.DISABLE_MULTIDRAW) await page.addInitScript(() => {
 const original=WebGL2RenderingContext.prototype.getExtension;
 WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:original.call(this,name);};
});
const errors = [], report = { viewport: [1440,900], errors, sourceRevision: process.env.BASELINE_REF || 'working-tree', disableMultiDraw: !!process.env.DISABLE_MULTIDRAW };
page.on('pageerror', e => errors.push(e.stack));
await page.route('**/*', async route => {
 const request=route.request(), name=new URL(request.url()).pathname.replace(/^\//,'');
 if (request.resourceType() !== 'document') {
  if (process.env.BASELINE_REF && request.url().startsWith(url) && name.startsWith('src/')) {
   const body=execFileSync('git',['show',`${process.env.BASELINE_REF}:${name}`]);
   return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body});
  }
  return route.continue();
 }
 const response = await route.fetch();
 const source = process.env.BASELINE_REF ? execFileSync('git',['show',`${process.env.BASELINE_REF}:index.html`],{encoding:'utf8'}) : await response.text();
 const injected = `
window.__perf = { renderer: Ke, camera: Lt, controls: Yt, scene: le, request: $t, callbacks: un, lighting: environmentLighting, frames: [] };
const perfGl = Ke.getContext(), perfExt = perfGl.getExtension('EXT_disjoint_timer_query_webgl2');
const perfOriginal = environmentLighting.render, perfPending = [];
let perfPrevious = 0;
environmentLighting.render = () => {
 const start = performance.now();
 Ke.info.autoReset = false; Ke.info.reset();
 const query = perfExt ? perfGl.createQuery() : null;
 if (query) perfGl.beginQuery(perfExt.TIME_ELAPSED_EXT, query);
 perfOriginal();
 if (query) perfGl.endQuery(perfExt.TIME_ELAPSED_EXT);
 const record = {t: start, interval: perfPrevious ? start-perfPrevious : 0, cpu: performance.now()-start,
 calls: Ke.info.render.calls, triangles: Ke.info.render.triangles, gpu: null};
 perfPrevious = start;
 if (query) perfPending.push({query,record});
 while (perfPending.length && perfGl.getQueryParameter(perfPending[0].query,perfGl.QUERY_RESULT_AVAILABLE)) {
  const item=perfPending.shift();
  if (!perfGl.getParameter(perfExt.GPU_DISJOINT_EXT)) item.record.gpu=perfGl.getQueryParameter(item.query,perfGl.QUERY_RESULT)/1e6;
  perfGl.deleteQuery(item.query);
 }
 if (__perf.recording) __perf.frames.push(record);
};
`;
 await route.fulfill({ response, body: source.replace('</script>\n</body>', injected+'</script>\n</body>') });
});
const summarize = rows => {
 const result = {frames: rows.length};
 for (const key of ['interval','cpu','gpu','calls','triangles']) {
  const values=rows.map(r=>r[key]).filter(v=>v!=null).sort((a,b)=>a-b);
  result[key]={median: values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],count:values.length};
 }
 result.observedFps=1000/result.interval.median;
 return result;
};
async function measure(name, duration=6000) {
 await page.evaluate(()=>{__perf.frames=[];__perf.recording=true;});
 await page.waitForTimeout(duration);
 const frames=await page.evaluate(()=>{__perf.recording=false;return __perf.frames;});
 if(name!=='idle' && frames.length<10) throw new Error(`No rendered frames in ${name}`);
 report[name]=summarize(frames.slice(3));
 await writeFile(output+'/'+name+'-frames.json',JSON.stringify(frames));
 console.log(name,JSON.stringify(report[name]));
}
try {
 const start=Date.now();
 await page.goto(url+'?sample=kakun&environment=astera&pose=6,-4.3,0,90',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__environmentDebug?.().environment?.meshes===13339 && window.__environmentDebug?.().robot?.includes('kakun'));
 report.loadSeconds=(Date.now()-start)/1000;
 report.device=await page.evaluate(()=>{const gl=__perf.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixelRatio:__perf.renderer.getPixelRatio(),timerQueries:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});
 console.log('LOADED',report.loadSeconds,report.device);
 // Begin driving immediately: the quality of interactive controls is the primary workload.
 await page.locator('#driveEnable').check(); await page.keyboard.down('w');
 await page.waitForTimeout(1500);
 await measure('drive');
 await page.keyboard.up('w');
 await page.screenshot({path:output+'/drive.png'});
 // Use the same orbit and view in both versions, after explicitly selecting raster mode.
 await page.locator('#envQuality').selectOption('interactive');
 await page.evaluate(()=>{
 __perf.controls.enableDamping=false;
 __perf.camera.position.set(8,-7,3);__perf.controls.target.set(6,-4,1);__perf.controls.update();
 const start=performance.now();
 __perf.orbit=(t)=>{const phase=(t-start)/1000;__perf.camera.position.set(6+Math.cos(phase)*3,-4+Math.sin(phase)*3,3);__perf.controls.update();return true;};
 __perf.callbacks.add(__perf.orbit);__perf.request();
 });
 await page.waitForTimeout(1500); await measure('orbit',6300);
 await page.evaluate(()=>{__perf.callbacks.delete(__perf.orbit);__perf.camera.position.set(8,-7,3);__perf.controls.target.set(6,-4,1);__perf.controls.update();__perf.request();});
 await page.waitForTimeout(1500);
 await page.screenshot({path:output+'/raster.png'});
 await measure('idle',2500);
 report.environment=await page.evaluate(()=>__environmentDebug());
 report.rendering=await page.evaluate(()=>__environmentRenderingDebug());
 report.success=errors.length===0;
} catch(e) { report.success=false; report.error=e.stack; console.error(e); }
finally {await writeFile(output+'/report.json',JSON.stringify(report,null,2));await browser.close();}
if(!report.success) process.exitCode=1;

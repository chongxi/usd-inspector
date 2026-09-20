import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const base=process.env.TEST_URL || 'http://127.0.0.1:8088/';
const output=process.env.EVIDENCE_DIR || '../results/usd_inspector_performance/shadow_correctness';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,
 args:['--no-sandbox','--enable-webgl','--use-angle=gl','--ignore-gpu-blocklist']});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.route('**/shadow-fixture',route=>route.fulfill({contentType:'text/html',body:`
 <script type="importmap">{"imports":{"three":"./node_modules/three/build/three.module.js"}}</script>
 <script type="module">
 import * as T from 'three';
 import {createEnvironmentShadowCache} from './src/environment-shadow-cache.js';
 const renderer=new T.WebGLRenderer();renderer.setSize(256,256);renderer.shadowMap.enabled=true;
 renderer.shadowMap.type=T.PCFShadowMap;
 const scene=new T.Scene(), camera=new T.PerspectiveCamera(48,1,.01,30);
 camera.up.set(0,0,1);camera.position.set(3,-4,4);camera.lookAt(0,0,.3);
 const floor=new T.Mesh(new T.BoxGeometry(6,6,.1),new T.MeshStandardMaterial({color:'#c3b5a0'}));
 floor.position.z=-.05;floor.receiveShadow=true;floor.castShadow=true;scene.add(floor);
 const wall=new T.Mesh(new T.BoxGeometry(.5,.5,1.8),new T.MeshStandardMaterial({color:'white'}));
 wall.position.set(-1,.5,.9);wall.castShadow=true;wall.receiveShadow=true;scene.add(wall);
 const base=new T.Group(), body=new T.Mesh(new T.BoxGeometry(.6,.4,.7),new T.MeshStandardMaterial({color:'#00bbff'}));
 body.position.z=.35;body.castShadow=true;body.receiveShadow=true;base.add(body);scene.add(base);
 const robot={root:base,base,visuals:[body],jdefs:[]};
 const light=new T.SpotLight('white',45,15,.8,.4);light.up.set(0,0,1);light.position.set(1,-1,4);light.target.position.set(0,0,0);
 light.castShadow=true;light.shadow.mapSize.set(512,512);light.shadow.autoUpdate=false;light.shadow.bias=-.000025;light.shadow.normalBias=.002;
 scene.add(light,light.target,new T.AmbientLight('white',.3));
 const target=new T.WebGLRenderTarget(256,256), cache=createEnvironmentShadowCache(renderer,scene,()=>robot);
 function snapshot(){renderer.setRenderTarget(target);renderer.render(scene,camera);const p=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(target,0,0,256,256,p);return p;}
 const comparisons=[];
 for (const x of [0,.25,.7,-.4]) {
  base.position.x=x;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  cache.update([light],camera);
  const actual=snapshot();light.shadow.needsUpdate=true;const expected=snapshot();
  let max=0,sum=0,changed=0;
  for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);sum+=d;if(d>2)changed++;}
  comparisons.push({x,max,mean:sum/actual.length,changed});
 }
 const before=cache.debug();wall.position.x-=.3;scene.updateMatrixWorld(true);cache.update([light],camera,true);
 const actual=snapshot();light.shadow.needsUpdate=true;const expected=snapshot();
 let difference=0;for(let i=0;i<actual.length;i++)difference+=Math.abs(actual[i]-expected[i]);
 window.result={comparisons,before,after:cache.debug(),invalidatedMean:difference/actual.length,glError:renderer.getContext().getError()};
 cache.clear();target.dispose();renderer.dispose();
 </script>`}));
 await page.goto(base+'shadow-fixture');await page.waitForFunction(()=>window.result,{timeout:30000});
 const result=await page.evaluate(()=>window.result);result.errors=errors;
 await writeFile(output+'/report.json',JSON.stringify(result,null,2));
 assert.deepEqual(errors,[]);assert.equal(result.glError,0);
 assert.equal(result.before.staticUpdates,1);assert.equal(result.before.dynamicUpdates,4);
 assert.equal(result.after.staticUpdates,2);
 for(const view of result.comparisons) assert.ok(view.mean<.05,JSON.stringify(view));
 assert.ok(result.invalidatedMean<.05);
 console.log('PASS cached static depth + moving robot matches full shadow rendering',JSON.stringify(result));
} finally {await browser.close();}

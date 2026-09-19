// Read the shipped USDZ through the real browser renderer and check IMG_5141's measured guard.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = process.env.EVIDENCE_DIR || path.join(root, 'results/environment-railing');
await mkdir(output, {recursive: true});
const server = createServer(async (request, response) => {
  try {
    const name = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true,
  args:['--no-sandbox','--enable-webgl','--use-angle=gl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];
page.on('pageerror', error=>errors.push(error.message));
try {
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = (await response.text()).replace('window.__environmentDebug =', `
      window.__railingSnapshot=()=>{
        const result={};
        le.updateMatrixWorld(true);
        le.traverse(mesh=>{
          if(!mesh.userData.members)return;
          mesh.geometry.computeBoundingBox();
          mesh.userData.members.forEach((path,index)=>{
            if(!/office_column_03|office_stair_guard_east/.test(path))return;
            const matrix=mesh.matrixWorld.clone();
            if(mesh.isInstancedMesh){const instance=new v.Matrix4();mesh.getMatrixAt(index,instance);matrix.multiply(instance);}
            const box=mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
            result[path]={min:box.min.toArray(),max:box.max.toArray()};
          });
        });
        return result;
      };
      window.__railingView=()=>{
        Lt.position.set(7.35,-8.8,1.9);Yt.target.set(5.12,-11.2,.7);
        Lt.fov=59;Lt.updateProjectionMatrix();Yt.update();$t();
      };
      window.__environmentDebug =`);
    await route.fulfill({response, body:html});
  });
  await page.addInitScript(()=>localStorage.setItem('environmentQuality','interactive'));
  await page.goto(url+'?sample=kakun&environment=astera', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__environmentDebug?.().environment?.meshes===13339, null, {timeout:180000});
  const parts=await page.evaluate(()=>window.__railingSnapshot());
  const column=parts['/World/Objects/office_column_03/Geometry/shaft'];
  const foot=parts['/World/Objects/office_stair_guard_east/Geometry/post_0_foot'];
  const projection=(foot.min[1]+foot.max[1])/2-column.max[1];
  assert.ok(Math.abs(projection-.456)<2e-6, `Measured guard projection: ${projection}`);
  assert.equal(Object.keys(parts).filter(p=>p.includes('/horizontal_1_')).length,9);
  assert.equal(Object.keys(parts).filter(p=>p.includes('/post_column_flat_')).length,2);
  assert.equal(Object.keys(parts).filter(p=>p.includes('/post_column_bolt_')).length,4);
  await page.evaluate(()=>window.__railingView());
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(output,'railing-usdz.png')});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({success:true,projection,parts,errors},null,2));
  console.log(`PASS: shipped USDZ guard is ${(projection*100).toFixed(4)} cm, with nine rods and two paired uprights`);
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

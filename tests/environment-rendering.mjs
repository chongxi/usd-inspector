import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.TEST_URL || 'http://127.0.0.1:8088/';
const output = process.env.EVIDENCE_DIR || 'results/environment-rendering';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const report = { checks: [], errors: [] };
page.on('pageerror', e => report.errors.push(e.stack));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const state = () => page.evaluate(() => window.__environmentRenderingDebug());
const check = text => { report.checks.push(text); console.log('PASS', text); };
async function converge() {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => {
    const p = window.__environmentRenderingDebug?.().pathTracing;
    return p && (p.samples >= 12 || p.failure);
  });
  const result = await state(); assert.equal(result.pathTracing.failure, ''); return result;
}
try {
  await page.goto(url + '?sample=kakun&environment=astera', {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__environmentDebug?.().environment?.meshes === 13323);
  const initial = await converge();
  assert.equal(initial.authoredLights, 30); assert.equal(initial.ao, true);
  check('Real USDZ lights, shadow rendering, worker BVH and progressive rendering initialize');
  await page.screenshot({path: output + '/realistic-kakun.png'});

  await page.locator('#driveEnable').check();
  const x = await page.locator('#placeX').inputValue();
  await page.keyboard.down('w');
  await page.waitForFunction(x => window.__environmentDebug().placement.x > Number(x) + .03, x);
  await page.keyboard.up('w');
  const moved = await converge();
  assert.ok(moved.pathTracing.geometryVersion > initial.pathTracing.geometryVersion);
  assert.equal(moved.pathTracing.builtVersion, moved.pathTracing.geometryVersion);
  check('Driving interrupts refinement; the updated robot pose is rebuilt and converges after stopping');

  await page.locator('#envCeiling').check();
  const ceiling = await converge();
  assert.ok(ceiling.pathTracing.geometryVersion > moved.pathTracing.geometryVersion);
  check('Changing ceiling visibility rebuilds the ray-traced geometry');
  await page.locator('#envQuality').selectOption('interactive');
  assert.equal((await state()).pathTracing.mode, 'interactive');
  await page.locator('#envQuality').selectOption('realistic');
  await converge();
  check('Rendering modes switch without replacing the environment or robot');
  await page.locator('[data-mode="reach"]').click();
  assert.equal(await page.locator('#pane-reach').isVisible(), true);
  check('Reach inspection remains available with realistic rendering selected');
  await page.locator('[data-mode="reach"]').click();
  await page.locator('[data-pane="env"]').click();
  await page.locator('#envRemove').click();
  assert.equal((await state()).active, false);
  assert.equal((await page.evaluate(() => window.__environmentDebug())).environment, null);
  check('Removing the environment restores the robot studio and disposes progressive rendering');
  assert.deepEqual(report.errors, []);
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.stack; report.state = await state().catch(() => null);
  await page.screenshot({path: output + '/failure.png'}).catch(() => {});
  throw error;
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

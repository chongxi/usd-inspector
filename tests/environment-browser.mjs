import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = process.env.EVIDENCE_DIR || path.join(root, 'results/environment-browser');
await mkdir(evidence, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.CHROMIUM_EXECUTABLE
  || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--no-sandbox', '--enable-webgl', ...(process.env.CHROMIUM_GPU
    ? ['--use-angle=gl', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(60000);
const errors = [], report = { checks: [] };
page.on('pageerror', error => errors.push(error.stack));
const debug = () => page.evaluate(() => window.__environmentDebug());
const robotPose = () => page.evaluate(() => ({
  base: window.__legalDbg.m().base.position.toArray(),
  joints: Object.fromEntries(window.__legalDbg.m().jdefs.map(def => [def.name,
    window.__legalDbg.m().robot.getJointValue(def.path)])),
}));
const check = message => { report.checks.push(message); console.log('PASS', message); };
try {
  // Functional controls are checked in the responsive rendering mode. The full
  // scene's progressive path tracing is exercised by the separate visual test.
  await page.addInitScript(() => localStorage.setItem('environmentQuality', 'interactive'));
  await page.goto(`${base}/?sample=kakun&environment=astera&pose=6,-4.3,0,90`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__environmentDebug?.().environment
    && window.__environmentDebug?.().robot?.includes('kakun'));
  const initial = await debug();
  assert.equal(initial.environment.meshes, 13339);
  assert.equal(initial.environment.textureCount, 17);
  assert.ok(initial.environment.drawMeshes < initial.environment.meshes / 5);
  assert.equal(initial.placement.x, 6);
  assert.equal(initial.placement.y, -4.3);
  assert.ok(Math.abs(initial.placement.yaw - Math.PI / 2) < 1e-6);
  assert.equal(initial.wheelCount, 2);
  report.initial = initial;
  check('Astera USDZ and Kakun load together with all 17 textures and share-link placement');
  assert.deepEqual(await page.locator('#inspector [data-pane]').evaluateAll(tabs => tabs.map(t => t.dataset.pane)),
    ['props', 'joints', 'reach', 'env', 'checks']);
  assert.equal(await page.locator('#inspector #pane-env').isVisible(), true);
  assert.equal(await page.locator('#pane-env').evaluate(p => getComputedStyle(p).position), 'static');
  assert.equal(await page.locator('#envClose').count(), 0);
  await page.locator('#driveEnable').check();
  await page.keyboard.down('w');
  await page.locator('[data-pane="props"]').click();
  assert.equal((await debug()).driving, false);
  assert.equal(await page.locator('#driveEnable').isChecked(), false);
  await page.keyboard.up('w');
  await page.locator('#envBtn').click();
  check('Env is docked in the Inspector; leaving the tab stops driving; topbar shortcut opens it');
  await page.screenshot({ path: path.join(evidence, 'kakun-in-astera.png') });

  for (const [button, filename] of [['#envDownloadUsdz', 'astera_office_2f.usdz'], ['#envDownloadUsd', 'astera_office_2f_usd.zip']]) {
    const received = page.waitForEvent('download');
    await page.locator(button).click();
    const download = await received;
    assert.equal(download.suggestedFilename(), filename);
    await download.saveAs(path.join(evidence, filename));
  }
  const digest = data => createHash('sha256').update(data).digest('hex');
  const asset = path.join(root, 'samples/environments/astera_office_2f.usdz');
  assert.equal(digest(await readFile(path.join(evidence, 'astera_office_2f.usdz'))), digest(await readFile(asset)));
  execFileSync('python3', ['-c', `import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as original, zipfile.ZipFile(sys.argv[2]) as downloaded:
    assert set(original.namelist()) == set(downloaded.namelist())
    assert len(original.namelist()) == 18
    for name in original.namelist():
        assert original.read(name) == downloaded.read(name), name
`, asset, path.join(evidence, 'astera_office_2f_usd.zip')]);
  check('Environment USDZ download is byte-identical; USD ZIP preserves the USD and all 17 textures');

  await page.locator('#driveEnable').check();
  const before = await robotPose();
  await page.keyboard.down('w');
  await page.waitForFunction(y => window.__environmentDebug().placement.y - y > 0.02, before.base[1]);
  await page.keyboard.up('w');
  await page.waitForTimeout(150);
  const after = await robotPose();
  assert.ok(after.base[1] - before.base[1] > 0.01);
  assert.ok(Math.abs(after.base[0] - before.base[0]) < 1e-5);
  assert.ok(Object.keys(before.joints).filter(name => /wheel/.test(name))
    .some(name => Math.abs(after.joints[name] - before.joints[name]) > 0.01));
  await page.waitForTimeout(400);
  assert.deepEqual((await robotPose()).base, after.base);
  check('Keyboard driving follows heading, rolls the wheels, and stops on key release');

  await page.keyboard.down('a');
  await page.waitForFunction(() => window.__environmentDebug().placement.yaw > Math.PI / 2 + 0.01);
  await page.keyboard.up('a');
  assert.ok((await debug()).placement.yaw > Math.PI / 2);
  assert.deepEqual((await robotPose()).base, after.base);
  const forwardButton = page.locator('[data-drive="forward"]');
  const buttonBox = await forwardButton.boundingBox();
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  await page.mouse.down();
  await page.waitForFunction(base => Math.hypot(window.__environmentDebug().placement.x - base[0],
    window.__environmentDebug().placement.y - base[1]) > 0.01, after.base);
  await page.mouse.up();
  const buttonPose = await robotPose();
  assert.notDeepEqual(buttonPose.base, after.base);
  assert.equal((await debug()).driving, false);
  check('Turning rotates in place; holding and releasing on-screen controls moves and stops');

  await page.locator('#placeX').focus();
  await page.keyboard.down('w'); await page.waitForTimeout(250); await page.keyboard.up('w');
  assert.deepEqual((await robotPose()).base, buttonPose.base);
  await page.locator('#envStatus').click();
  await page.keyboard.down('w'); await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  assert.equal((await debug()).driving, false);
  const blurred = await robotPose();
  await page.waitForTimeout(300);
  assert.deepEqual((await robotPose()).base, blurred.base);
  await page.keyboard.up('w');
  check('Text entry does not drive; simulated focus loss clears held commands');

  await page.locator('#envOverview').click();
  await page.locator('#envCeiling').check();
  const full = (await debug()).environment.visibleDrawMeshes;
  await page.locator('#envCeiling').uncheck();
  assert.ok((await debug()).environment.visibleDrawMeshes < full);
  await page.locator('#tglStage').click(); await page.locator('#tglInspector').click();
  await page.screenshot({ path: path.join(evidence, 'environment-overview.png') });
  await page.locator('#tglStage').click(); await page.locator('#tglInspector').click();
  check('Ceiling toggle reveals the interior without replacing scene geometry');

  await page.locator('#placeX').fill('5.9'); await page.locator('#placeY').fill('-3.5');
  await page.locator('#placeZ').fill('0'); await page.locator('#placeYaw').fill('20');
  await page.locator('#placeApply').click();
  for (const [sample, name] of [['panthera-ht', 'panthera'], ['worker-pi', 'worker']]) {
    await page.locator('#libBtn').click();
    await page.locator(`[data-sample="${sample}"]`).click();
    await page.waitForFunction(name => window.__environmentDebug?.().robot?.includes(name), name);
    const state = await debug();
    assert.equal(state.environment.meshes, initial.environment.meshes);
    assert.ok(Math.abs(state.placement.x - 5.9) < 1e-5 && Math.abs(state.placement.y + 3.5) < 1e-5);
    assert.equal(await page.locator('#driveEnable').isDisabled(), true);
    await page.locator('[data-pane="joints"]').click();
    const slider = page.locator('input[data-joint]:visible').first();
    const value = await slider.inputValue();
    await slider.focus(); await page.keyboard.press('ArrowRight');
    assert.notEqual(await slider.inputValue(), value);
    await page.screenshot({ path: path.join(evidence, `${sample}-in-astera.png`) });
    check(`${sample}: environment and placement persist, joint controls remain usable`);
  }
  await page.locator('#tglMotion').click();
  await page.locator('#motAdd').click();
  assert.equal(await page.evaluate(() => window.__legalDbg.m().motion.keys.length), 1);
  await page.locator('[data-mode="reach"]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#pane-reach').isVisible(), true);
  check('Motion keyframes and Reach UI still work after robot replacement');
  await page.locator('[data-mode="reach"]').click();

  await page.locator('[data-pane="env"]').click();
  await page.locator('#envRemove').click();
  assert.equal((await debug()).environment, null);
  assert.ok((await debug()).robot.includes('worker'));
  await page.locator('#envFile').setInputFiles(path.join(root, 'samples/environments/astera_office_2f.usdz'));
  await page.waitForFunction(() => window.__environmentDebug?.().environment?.meshes === 13339);
  assert.equal((await debug()).environment.textureCount, 17);
  assert.equal(await page.locator('#shareBtn').isVisible(), false);
  check('Local USDZ opens with embedded textures, keeps robot, and never offers a broken share link');

  await page.locator('#envUrl').fill(`${base}/missing-scene.usdz`);
  await page.locator('#envLoadUrl').click();
  await page.waitForFunction(() => document.querySelector('#envStatus').hasAttribute('data-error'));
  assert.equal((await debug()).environment.meshes, 13339);
  check('Failed environment loads leave the current environment and robot intact');

  await page.locator('#envUrl').fill(`${base}/tests/fixtures/environment-y-up-cm.usda`);
  await page.locator('#envLoadUrl').click();
  await page.waitForFunction(() => window.__environmentDebug?.().environment?.meshes === 2);
  const small = await debug();
  assert.ok(small.environment.bounds.every((n, i) => Math.abs(n - [2, 3, 0.1][i]) < 1e-6));
  await page.locator('#envOverview').click();
  await page.locator('#placePick').click();
  await page.mouse.click(850, 650);
  assert.equal(await page.locator('#placePick').getAttribute('aria-pressed'), 'false');
  const picked = (await debug()).placement;
  assert.ok(Math.abs(picked.x) < 1 && Math.abs(picked.y) < 1.5 && Math.abs(picked.z) < 1e-6);
  check('Y-up centimetre stage is converted to metres, visibility/purpose/default prim respected, floor click places robot');

  await page.goto(`${base}/?sample=panthera-ht&environment=astera`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__environmentDebug?.().environment?.meshes === 13339
    && window.__environmentDebug?.().robot?.includes('panthera'));
  const defaultPose = (await debug()).placement;
  assert.deepEqual(defaultPose, { x: 2.678, y: 4.525414, z: 0, yaw: 0 });
  assert.equal(new URL(page.url()).searchParams.get('environment'), 'astera');
  assert.equal(new URL(page.url()).searchParams.get('pose'), '2.678,4.525414,0,0');
  check('Fresh share link uses the calibrated default spawn regardless of robot/environment load order');
  assert.deepEqual(errors, []);
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error.stack;
  report.failureState = await debug().catch(() => null);
  await page.screenshot({ path: path.join(evidence, 'failure.png') });
  throw error;
} finally {
  report.pageErrors = errors;
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); server.close();
}

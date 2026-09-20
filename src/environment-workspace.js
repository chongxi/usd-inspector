import { advanceDrive, wheelIncrement, parsePlacement } from './workspace-math.js';
import { batchEnvironment, disposeEnvironment } from './environment-renderer.js?v=20260919-perf';

const ASTERA = 'samples/environments/astera_office_2f.usdz?v=20260920-bins';
const DEFAULT_SPAWN = { x: 2.678, y: 4.525414, z: 0, yaw: 0 };

/** Independent environment and robot placement. Browser kinematics, no physics host. */
export function createEnvironmentWorkspace(api) {
  const { THREE, scene, camera, controls, canvas, requestRender, getRobot } = api;
  const panel = document.querySelector('#pane-env');
  panel.classList.add('workspace');
  panel.setAttribute('aria-label', 'Environment and robot placement');
  panel.innerHTML = `
    <div class="workspace-actions"><button class="btn primary" id="envAstera">Astera office · 29.0 MB</button><button class="btn" id="envOpen">Open USDZ…</button></div>
    <input id="envFile" type="file" accept=".usdz,.usd,.usda,.usdc" hidden>
    <div class="workspace-url"><input class="search" id="envUrl" type="url" placeholder="Or an environment URL" aria-label="Environment URL"><button class="btn" id="envLoadUrl">Load</button></div>
    <p class="workspace-status" id="envStatus" role="status" aria-live="polite">No environment. Choose Astera or open your own USDZ.</p>
    <div class="workspace-actions"><button class="btn sm" id="envOverview" disabled>View environment</button><button class="btn sm" id="envRemove" disabled>Remove environment</button></div>
    <label class="workspace-check"><input type="checkbox" id="envCeiling"> Show ceiling and overhead lights</label>
    <label class="workspace-quality">Rendering <select id="envQuality"><option value="interactive">Real-time · balanced</option><option value="high">Real-time · high detail</option><option value="realistic">Photo · path traced</option></select></label>
    <p id="envRenderStatus" role="status">Real-time lighting, materials and contact shadows.</p>
    <fieldset><legend>Download environment · no robot</legend>
      <div class="workspace-actions"><button class="btn sm" id="envDownloadUsdz">USDZ · single file</button><button class="btn sm" id="envDownloadUsd">USD + textures · ZIP</button></div>
      <p id="envDownloadNote" role="status">Astera office. Downloads also work before loading the scene.</p>
    </fieldset>
    <fieldset id="placementFields"><legend>Place the selected robot</legend>
      <div class="workspace-fields">
        <label>X · m<input id="placeX" type="number" step="0.1" value="0"></label>
        <label>Y · m<input id="placeY" type="number" step="0.1" value="0"></label>
        <label>Support surface Z · m<input id="placeZ" type="number" step="0.05" value="0"></label>
        <label>Heading · °<input id="placeYaw" type="number" step="5" value="0"></label>
      </div>
      <div class="workspace-actions"><button class="btn" id="placeApply">Apply position</button><button class="btn" id="placePick" aria-pressed="false">Click to place</button><button class="btn sm" id="placeFocus">Follow robot</button></div>
      <p>Pick a floor or tabletop. Switching robots keeps this location. Joints, Reach and Motion still control the selected robot.</p>
    </fieldset>
    <fieldset><legend>Base driving</legend>
      <label class="workspace-check"><input type="checkbox" id="driveEnable"> Keyboard drive · W A S D / arrows</label>
      <div class="drive-pad">
        <span></span><button class="btn" data-drive="forward" aria-label="Drive forward">↑</button><span></span>
        <button class="btn" data-drive="left" aria-label="Turn left">↶</button><button class="btn" id="driveStop" aria-label="Stop driving">■</button><button class="btn" data-drive="right" aria-label="Turn right">↷</button>
        <span></span><button class="btn" data-drive="backward" aria-label="Drive backward">↓</button><span></span>
      </div>
      <label class="workspace-check">Speed · m/s <input id="driveSpeed" type="range" min="0.05" max="0.8" value="0.25" step="0.05" aria-label="Drive speed"></label>
      <p id="driveNote">Select a wheeled robot to drive. Other robots can be placed and controlled with Joints, Reach or Motion.</p>
    </fieldset>
    <p>Browser motion preview. Environment contacts and grasping are not simulated.</p>`;
  const badge = document.createElement('div');
  badge.className = 'workspace-badge';
  badge.hidden = true;
  document.querySelector('#viewport').appendChild(badge);
  const $ = selector => panel.querySelector(selector);
  let environment = null, loadToken = 0, placing = false, running = false, previousTime = 0, animationId = 0;
  const requestedPlacement = parsePlacement(new URL(location.href).searchParams.get('pose'));
  const initialEnvironment = new URL(location.href).searchParams.get('environment');
  let restoring = !!initialEnvironment, placementEdited = false;
  let placement = requestedPlacement;
  let floorOffset = 0, model = null, environmentKey = null, follow = true;
  const held = new Set();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const keyMap = { w: 'forward', arrowup: 'forward', s: 'backward', arrowdown: 'backward',
    a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };

  function status(text, error = false) {
    $('#envStatus').textContent = text;
    $('#envStatus').toggleAttribute('data-error', error);
  }
  function updateLink() {
    if (restoring) return;
    const url = new URL(location.href);
    if (environmentKey) url.searchParams.set('environment', environmentKey);
    else url.searchParams.delete('environment');
    if (environmentKey && placement) url.searchParams.set('pose',
      [placement.x, placement.y, placement.z, placement.yaw * 180 / Math.PI]
        .map(n => Number(n.toFixed(6))).join(','));
    else url.searchParams.delete('pose');
    history.replaceState(null, '', url);
    document.querySelector('#shareBtn').hidden = getRobot()?.src.kind === 'files'
      || (!!environment && !environmentKey);
  }
  function updateFields() {
    if (!placement) return;
    for (const [id, value] of [['placeX', placement.x], ['placeY', placement.y],
      ['placeZ', placement.z], ['placeYaw', placement.yaw * 180 / Math.PI]]) {
      if (document.activeElement !== $('#' + id)) $('#' + id).value = Number(value.toFixed(6));
    }
  }
  function robotBounds() {
    const robot = getRobot();
    const box = new THREE.Box3();
    if (robot) for (const mesh of robot.visuals) {
      if (mesh.isMesh) box.union(new THREE.Box3().setFromObject(mesh));
    }
    return box;
  }
  function focus() {
    const box = robotBounds();
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.4, box.getSize(new THREE.Vector3()).length() / 2);
    const angle = placement?.yaw || 0;
    camera.position.copy(centre).add(new THREE.Vector3(-Math.cos(angle) * radius * 3,
      -Math.sin(angle) * radius * 3 - radius * 1.3, radius * 1.8));
    controls.target.copy(centre);
    controls.update();
    follow = true;
    requestRender();
  }
  function synchronize(moved = false) {
    const robot = getRobot();
    if (!robot || !placement) return;
    const before = robot.base.position.clone();
    robot.base.position.set(placement.x, placement.y, placement.z - floorOffset);
    robot.base.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), placement.yaw);
    robot.base.updateMatrixWorld(true);
    robot.floorZ = placement.z;
    if (moved && follow) {
      const delta = robot.base.position.clone().sub(before);
      camera.position.add(delta);
      controls.target.add(delta);
    }
    api.poseChanged();
    updateFields();
    requestRender();
  }
  function stop() {
    cancelAnimationFrame(animationId);
    animationId = 0;
    held.clear();
    for (const button of panel.querySelectorAll('[data-drive]')) button.removeAttribute('data-held');
    if (running) updateLink();
    running = false;
    previousTime = 0;
  }
  function applyPosition(pose) {
    if (!Object.values(pose).every(Number.isFinite)) return;
    stop();
    api.stopMotion();
    placement = { ...pose };
    placementEdited = true;
    synchronize();
    api.invalidateGround();
    updateLink();
  }
  function robotChanged() {
    stop();
    const robot = getRobot();
    if (!robot) return;
    model = robot;
    floorOffset = robot.bbox.min.z;
    if (environment && !placement) placement = { ...DEFAULT_SPAWN };
    if (placement) synchronize();
    else placement = { x: 0, y: 0, z: floorOffset, yaw: 0 };
    updateFields();
    const wheeled = api.wheels().length >= 2 && api.baseKind() === 'wheels';
    for (const input of panel.querySelectorAll('[data-drive], #driveEnable, #driveSpeed')) input.disabled = !wheeled;
    $('#driveEnable').checked = false;
    $('#driveNote').textContent = wheeled
      ? 'Hold buttons or enable keyboard drive. Turning spins the wheels; release or leave the page to stop.'
      : 'No wheeled base detected. Use placement, Joints, Reach and Motion for this robot.';
    if (environment) { api.grid.visible = false; focus(); }
    camera.near = 0.001;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    controls.maxDistance = environment ? 100 : controls.maxDistance;
    api.invalidateGround();
    updateLink();
  }
  function tick(time) {
    if (!running) return;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.08) : 0;
    previousTime = time;
    const robot = getRobot();
    if (!robot || model !== robot || !held.size || document.hidden) { stop(); return; }
    if (robot.motion?.playing || api.reachIsLive()) { stop(); return; }
    const linear = (Number(held.has('forward')) - Number(held.has('backward'))) * Number($('#driveSpeed').value);
    const angular = (Number(held.has('left')) - Number(held.has('right'))) * 0.8;
    const inverse = robot.base.matrixWorld.clone().invert();
    const inverseRotation = robot.base.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const wheel of api.wheels()) {
      const joint = robot.jointObjs.get(wheel.def.path);
      const position = joint.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
      const axis = joint.axis.clone().applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()))
        .applyQuaternion(inverseRotation);
      const increment = wheelIncrement(position.toArray(), axis.toArray(), wheel.radius, linear, angular, dt);
      robot.robot.setJointValue(wheel.def.path, (robot.robot.getJointValue(wheel.def.path) || 0) + increment);
    }
    robot.robot.updateKinematics();
    placement = advanceDrive(placement, linear, angular, dt);
    synchronize(true);
    animationId = requestAnimationFrame(tick);
  }
  function press(direction) {
    if ($('#driveEnable').disabled || !getRobot()) return;
    if (!running) {
      api.stopMotion();
      readCurrentPlacement();
      previousTime = 0; running = true; animationId = requestAnimationFrame(tick);
    }
    held.add(direction);
  }
  function setPlacing(enabled) {
    placing = enabled;
    $('#placePick').setAttribute('aria-pressed', String(enabled));
    canvas.style.cursor = enabled ? 'crosshair' : '';
  }
  function showCeiling() {
    if (!environment) return;
    for (const mesh of environment.root.children) mesh.visible = !mesh.userData.ceiling || $('#envCeiling').checked;
    api.lighting.refresh();
    requestRender();
  }
  function removeEnvironment() {
    loadToken++;
    stop();
    setPlacing(false);
    if (environment) disposeEnvironment(environment.root);
    api.lighting.clear();
    environment = null;
    environmentKey = null;
    restoring = false;
    badge.hidden = true;
    api.grid.visible = api.gridEnabled();
    $('#envOverview').disabled = $('#envRemove').disabled = true;
    status('No environment. The selected robot is kept.');
    updateDownloadButtons();
    updateLink();
    requestRender();
  }
  async function loadEnvironment(source, name, key = null) {
    const token = ++loadToken;
    status(`Loading ${name}…`);
    api.openEnvironment();
    try {
      const loaded = await api.readEnvironment(source, text => status(text), () => token !== loadToken);
      if (token !== loadToken) { disposeEnvironment(loaded); return; }
      status('Preparing environment instances…');
      await new Promise(resolve => setTimeout(resolve, 20));
      const candidate = batchEnvironment(THREE, loaded, { multiDraw: api.lighting.supportsMultiDraw });
      if (token !== loadToken) { disposeEnvironment(candidate.root); return; }
      if (environment) disposeEnvironment(environment.root);
      environment = { ...candidate, name, warnings: loaded.userData.warnings || [],
        textureCount: loaded.userData.textureCount || 0, download: loaded.userData.download };
      scene.add(environment.root);
      api.lighting.setEnvironment(environment.root, loaded.userData.lights || []);
      controls.maxDistance = Math.max(100, new THREE.Box3().setFromObject(environment.root)
        .getSize(new THREE.Vector3()).length() * 4);
      environmentKey = key;
      restoring = false;
      api.grid.visible = false;
      $('#envOverview').disabled = $('#envRemove').disabled = false;
      showCeiling();
      badge.textContent = `${name} · browser motion preview`;
      badge.hidden = false;
      status(`${name} · ${candidate.originalMeshes.toLocaleString()} parts · ${candidate.drawMeshes.toLocaleString()} draw groups`);
      updateDownloadButtons();
      if (!placement || (!key && placement.x === 0 && placement.y === 0)) placement = key === 'astera'
        ? { ...DEFAULT_SPAWN } : { x: 0, y: 0, z: 0, yaw: 0 };
      // The initial robot has an origin pose before its environment finishes.
      if (key === 'astera' && !requestedPlacement && !placementEdited) placement = { ...DEFAULT_SPAWN };
      if (getRobot()) { floorOffset = getRobot().bbox.min.z; synchronize(); api.invalidateGround(); focus(); }
      updateLink();
      requestRender();
    } catch (error) {
      if (token !== loadToken) return;
      status(`Could not load ${name}: ${error.message}. The previous environment is kept.`, true);
      console.error(error);
      restoring = false;
    }
  }
  $('#envAstera').onclick = () => loadEnvironment(new URL(ASTERA, document.baseURI).href, 'Astera office 2F', 'astera');
  $('#envOpen').onclick = () => $('#envFile').click();
  $('#envFile').onchange = event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) loadEnvironment(file, file.name);
  };
  $('#envLoadUrl').onclick = () => {
    try {
      const url = new URL($('#envUrl').value);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP(S) URL');
      loadEnvironment(url.href, url.pathname.split('/').pop() || 'Environment', url.href);
    } catch { status('Enter a valid HTTP(S) environment URL.', true); }
  };
  $('#envUrl').onkeydown = event => { if (event.key === 'Enter') $('#envLoadUrl').click(); };
  $('#envRemove').onclick = removeEnvironment;
  function isPackage(download) {
    return download.bytes[0] === 80 && download.bytes[1] === 75;
  }
  function updateDownloadButtons() {
    const packed = !environment || isPackage(environment.download);
    $('#envDownloadUsdz').textContent = packed ? 'USDZ · single file' : 'USD · original file';
    $('#envDownloadUsd').disabled = !packed;
    $('#envDownloadNote').textContent = environment
      ? `${environment.name}. Original asset, without the selected robot.`
      : 'Astera office. Downloads also work before loading the scene.';
  }
  async function downloadEnvironment(format) {
    stop();
    $('#envDownloadUsdz').disabled = $('#envDownloadUsd').disabled = true;
    $('#envDownloadNote').textContent = 'Preparing download…';
    try {
      const download = environment?.download || await fetch(new URL(ASTERA, document.baseURI))
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { name: 'astera_office_2f.usdz', bytes: new Uint8Array(await response.arrayBuffer()) };
        });
      // Use original bytes: visibility choices, robot pose and browser mesh
      // batching must never alter the downloadable environment's physics/assets.
      let bytes = download.bytes, name = download.name;
      if (format === 'usd') {
        if (!isPackage(download)) throw new Error('Use a USDZ to include its referenced files');
        $('#envDownloadNote').textContent = 'Packing USD and all embedded textures…';
        await new Promise(resolve => setTimeout(resolve, 20));
        const entries = api.unzip(bytes);
        for (const entry of Object.keys(entries)) {
          if (/^[\\/]|^[A-Za-z]:|\x00/.test(entry) || entry.split(/[\\/]/).includes('..')) {
            throw new Error('The package contains an unsafe file path');
          }
        }
        bytes = api.zip(entries, { level: 6 });
        name = name.replace(/\.[^.]+$/, '') + '_usd.zip';
      }
      await api.saveFile(bytes, name, format === 'usd' ? 'application/zip' : 'application/octet-stream');
      $('#envDownloadNote').textContent = `Downloaded ${name}. Environment only; no robot.`;
    } catch (error) {
      $('#envDownloadNote').textContent = `Download failed: ${error.message}`;
    } finally {
      $('#envDownloadUsdz').disabled = false;
      $('#envDownloadUsd').disabled = !!environment && !isPackage(environment.download);
    }
  }
  $('#envDownloadUsdz').onclick = () => downloadEnvironment('original');
  $('#envDownloadUsd').onclick = () => downloadEnvironment('usd');
  $('#envCeiling').onchange = showCeiling;
  try { const quality = localStorage.getItem('environmentQualityV2');
    if (['interactive', 'high'].includes(quality)) $('#envQuality').value = quality; } catch {}
  api.lighting.setQuality($('#envQuality').value);
  $('#envQuality').onchange = () => {
    api.lighting.setQuality($('#envQuality').value);
    try { localStorage.setItem('environmentQualityV2', $('#envQuality').value); } catch {}
  };
  $('#envOverview').onclick = () => {
    const box = new THREE.Box3().setFromObject(environment.root);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const halfFov = camera.getEffectiveFOV() * Math.PI / 360;
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = size / 2 / Math.sin(limitingFov) * 1.15;
    controls.maxDistance = Math.max(controls.maxDistance, distance * 2);
    camera.position.copy(centre).add(new THREE.Vector3(0.3, -0.4, 0.9).normalize().multiplyScalar(distance));
    controls.target.copy(centre); controls.update(); follow = false; requestRender();
  };
  $('#placeApply').onclick = () => {
    const pose = parsePlacement(['#placeX', '#placeY', '#placeZ', '#placeYaw'].map(id => $(id).value).join(','));
    if (!pose) { status('Position and heading must be finite numbers.', true); return; }
    applyPosition(pose); focus();
  };
  $('#placePick').onclick = () => { stop(); setPlacing(!placing); };
  $('#placeFocus').onclick = focus;
  canvas.addEventListener('pointerdown', event => {
    if (!placing || !environment || !getRobot() || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(environment.root.children.filter(mesh => mesh.visible), false)
      .find(hit => {
        if (!hit.face) return false;
        const matrix = hit.object.matrixWorld.clone();
        const instanceId = hit.instanceId ?? hit.batchId;
        if (instanceId !== undefined) {
          const instance = new THREE.Matrix4(); hit.object.getMatrixAt(instanceId, instance); matrix.multiply(instance);
        }
        return hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize().z > 0.5;
      });
    if (!hit) { status('Click an upward-facing floor or tabletop.'); return; }
    event.stopImmediatePropagation(); event.preventDefault();
    applyPosition({ x: hit.point.x, y: hit.point.y, z: hit.point.z, yaw: placement?.yaw || 0 });
    setPlacing(false); focus();
  }, true);
  for (const button of panel.querySelectorAll('[data-drive]')) {
    button.onpointerdown = event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      button.setAttribute('data-held', ''); press(button.dataset.drive);
    };
    button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => {
      button.removeAttribute('data-held'); held.delete(button.dataset.drive); if (!held.size) stop();
    };
  }
  $('#driveStop').onclick = () => { stop(); $('#driveEnable').checked = false; };
  $('#driveEnable').onchange = stop;
  const editing = target => target instanceof Element
    && target.closest('input:not([type="checkbox"]):not([type="button"]), textarea, select, [contenteditable="true"]');
  document.addEventListener('focusin', event => { if (editing(event.target)) stop(); });
  addEventListener('keydown', event => {
    if (event.key === 'Escape') { stop(); setPlacing(false); return; }
    if (!$('#driveEnable').checked || editing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = keyMap[event.key.toLowerCase()];
    if (direction) { event.preventDefault(); press(direction); }
    if (event.code === 'Space') { event.preventDefault(); stop(); }
  });
  addEventListener('keyup', event => { held.delete(keyMap[event.key.toLowerCase()]); if (!held.size) stop(); });
  addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.querySelector('#envBtn').onclick = () => api.openEnvironment();
  new MutationObserver(() => {
    if (document.querySelector('#inspector').hidden) { stop(); $('#driveEnable').checked = false; setPlacing(false); }
  }).observe(document.querySelector('#inspector'), { attributes: true, attributeFilter: ['hidden'] });
  document.querySelector('#shareBtn').addEventListener('click', () => {
    readCurrentPlacement();
    updateLink();
  }, true);
  function readCurrentPlacement() {
    const robot = getRobot();
    if (!robot || robot !== model) return;
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(robot.base.quaternion);
    placement = { x: robot.base.position.x, y: robot.base.position.y,
      z: robot.base.position.z + floorOffset, yaw: Math.atan2(forward.y, forward.x) };
  }
  if (initialEnvironment === 'astera') $('#envAstera').click();
  else if (initialEnvironment) { $('#envUrl').value = initialEnvironment; $('#envLoadUrl').click(); }
  return { robotChanged, beforeRobotChange: () => { stop(); readCurrentPlacement(); },
    tabChanged: tab => { if (tab !== 'env') { stop(); $('#driveEnable').checked = false; setPlacing(false); } },
    hasEnvironment: () => !!environment, groundZ: () => environment && placement ? placement.z : undefined,
    focus, debug: () => ({ environment: environment ? { name: environment.name,
      meshes: environment.originalMeshes, drawMeshes: environment.drawMeshes,
      triangles: environment.triangles, textureCount: environment.textureCount,
      visibleDrawMeshes: environment.root.children.filter(mesh => mesh.visible).length,
      warnings: environment.warnings, bounds: new THREE.Box3().setFromObject(environment.root)
        .getSize(new THREE.Vector3()).toArray() } : null,
      placement, driving: running, robot: getRobot()?.name, wheelCount: getRobot() ? api.wheels().length : 0 }) };
}

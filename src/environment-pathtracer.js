import * as THREE from 'three';
import { createEnvironmentDenoiser } from './environment-denoiser.js';

/** Progressive still views. Snapshots share source meshes/textures; never edit USD assets. */
export function createEnvironmentPathTracer({ renderer, camera, requestRender, rasterize, getRobot,
  scene, getRoot, getLights, getBackground, getNormals, interactionActive, status }) {
  let tracer = null, worker = null, snapshot = null, environment = null, denoise = null;
  let ready = false, busy = false, version = 0, geometryVersion = 0, builtVersion = -1;
  let cameraKey = '', robotKey = '', settledAt = 0, failure = '', mode = 'interactive';
  let robotRecords = [], model = null;
  let guideDirty = true;
  const maxSamples = 192;
  const visible = object => {
    for (let p = object; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  function addMesh(object, matrix) {
    const mesh = new THREE.Mesh(object.geometry, object.material);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); snapshot.add(mesh);
    return mesh;
  }
  function updateRobot() {
    const robot = getRobot();
    if (model !== robot) {
      for (const record of robotRecords) record.copy.removeFromParent();
      robotRecords = []; model = robot;
      if (robot) for (const source of robot.visuals) if (source.isMesh) {
        robotRecords.push({ source, copy: addMesh(source, source.matrixWorld) });
      }
    }
    for (const {source, copy} of robotRecords) {
      copy.matrix.copy(source.matrixWorld); copy.visible = visible(source);
    }
  }
  function reset() {
    version++; geometryVersion++; builtVersion = -1; ready = false;
    robotKey = ''; cameraKey = ''; failure = ''; settledAt = performance.now();
    guideDirty = true;
    if (!busy) dispose();
  }
  function dispose() {
    worker?.dispose(); worker = null;
    if (tracer) {
      tracer.dispose();
      // 0.0.24 does not release these auxiliary targets in dispose().
      tracer._lowResPathTracer.dispose();
      tracer._generator.geometry.dispose();
    }
    tracer = null; environment?.dispose(); environment = null;
    denoise?.dispose(); denoise = null;
    snapshot = null; robotRecords = []; model = null; ready = false;
  }
  async function prepare() {
    const token = version;
    busy = true; status('Preparing realistic lighting…');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (token !== version || !getRoot()) { busy = false; dispose(); requestRender(); return; }
    try {
      if (!tracer) {
        const { WebGLPathTracer, GradientEquirectTexture, GenerateMeshBVHWorker }
          = await import('./vendor/pathtracer.js');
        if (token !== version || mode !== 'realistic' || !getRoot()) return;
        snapshot = new THREE.Scene();
        snapshot.background = getBackground()?.clone() || new THREE.Color('#20262a');
        environment = new GradientEquirectTexture(64);
        environment.topColor.setRGB(1, 0.96, 0.9); environment.bottomColor.copy(environment.topColor);
        environment.update(); snapshot.environment = environment; snapshot.environmentIntensity = 0.3;
        getRoot().updateMatrixWorld(true);
        getRoot().traverseVisible(object => {
          if (!object.isMesh) return;
          if (object.isBatchedMesh && object.userData.batchSources) {
            for (const member of object.userData.batchSources) {
              addMesh(member, new THREE.Matrix4().multiplyMatrices(object.matrixWorld, member.matrix));
            }
          } else if (object.isInstancedMesh) {
            const matrix = new THREE.Matrix4();
            for (let i = 0; i < object.count; i++) {
              object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld); addMesh(object, matrix);
            }
          } else addMesh(object, object.matrixWorld);
        });
        for (const original of getLights()) {
          if (!original.isLight || original.isHemisphereLight || original.isSpotLight) continue;
          const light = original.clone();
          if (original.userData.luminance != null) light.intensity = original.userData.luminance;
          light.intensity *= 1.3;
          snapshot.add(light);
        }
        tracer = new WebGLPathTracer(renderer);
        worker = new GenerateMeshBVHWorker(); tracer.setBVHWorker(worker);
        tracer._generator.bvhOptions = { maxLeafSize: 8 };
        tracer.bounces = 4; tracer.filterGlossyFactor = 0.15;
        tracer.tiles.set(2, 2); tracer.renderDelay = 0;
        tracer.minSamples = 8; tracer.fadeDuration = 0;
        // The last interactive frame already fills the canvas while samples accumulate.
        tracer.rasterizeSceneCallback = () => {};
        denoise = createEnvironmentDenoiser(renderer, getNormals, scene, camera);
        tracer.renderToCanvasCallback = target => {
          if (Number.isInteger(tracer.samples)) denoise.render(target.texture);
        };
      }
      updateRobot();
      const geometryToken = geometryVersion;
      await tracer.setSceneAsync(snapshot, camera);
      if (token !== version || !getRoot()) { dispose(); return; }
      rasterize(); denoise.capture();
      guideDirty = false;
      builtVersion = geometryToken; ready = true; settledAt = performance.now();
    } catch (error) {
      dispose();
      if (token === version) {
        failure = error.message; console.warn('Realistic lighting unavailable:', error);
        status('Interactive lighting · realistic mode unavailable on this device');
      }
    } finally { busy = false; requestRender(); }
  }
  function render() {
    if (mode !== 'realistic' || failure || !getRoot()) return false;
    const robot = getRobot();
    const nextRobot = robot ? [robot.root.uuid, robot.root.visible, ...robot.base.matrixWorld.elements,
      ...robot.jdefs.map(d => robot.robot.getJointValue(d.path)), ...robot.visuals.map(o => visible(o))].join(',') : '';
    const nextCamera = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements,
      renderer.domElement.width, renderer.domElement.height].map(n => Math.round(n * 1e7)).join(',');
    if (robotKey !== nextRobot) {
      robotKey = nextRobot; geometryVersion++; settledAt = performance.now(); tracer?.reset();
    }
    if (cameraKey !== nextCamera) {
      cameraKey = nextCamera; settledAt = performance.now(); guideDirty = true;
      if (ready) tracer.updateCamera();
    }
    if (interactionActive() || document.hidden) {
      status('Interactive lighting · inspection tools active'); return false;
    }
    if (performance.now() - settledAt < 600) {
      status('Interactive lighting · settles when still'); requestRender(); return false;
    }
    if (!ready || builtVersion !== geometryVersion) {
      if (!busy) prepare();
      return false;
    }
    if (guideDirty) { rasterize(); denoise.capture(); guideDirty = false; }
    const pixels = renderer.domElement.width * renderer.domElement.height;
    tracer.renderScale = Math.min(1, Math.sqrt(1280 * 800 / pixels));
    tracer.pausePathTracing = tracer.samples >= maxSamples;
    tracer.renderSample();
    status(tracer.isCompiling ? 'Preparing realistic lighting…'
      : `Realistic lighting · ${Math.floor(tracer.samples)} / ${maxSamples} samples`);
    if (tracer.samples < maxSamples) requestRender();
    return true;
  }
  return { render, reset,
    setMode(value) { mode = value; if (value === 'realistic') { failure = ''; settledAt = performance.now(); }
      else { reset(); status('Real-time lighting'); } requestRender(); },
    debug: () => ({ mode, ready, busy, samples: tracer?.samples || 0, failure, builtVersion, geometryVersion }) };
}

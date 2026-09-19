import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createEnvironmentPathTracer } from './environment-pathtracer.js';

/** Scene lighting in metres. Owns preview resources, never changes downloadable USD. */
export function createEnvironmentLighting({ scene, renderer, camera, getRobot, requestRender, interactionActive }) {
  const studio = { background: scene.background, environment: scene.environment, intensity: scene.environmentIntensity,
    toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, shadowType: renderer.shadowMap.type,
    lights: scene.children.filter(o => o.isLight).map(light => ({ light, visible: light.visible })) };
  const group = new THREE.Group(); group.name = 'EnvironmentLighting';
  const size = new THREE.Vector2();
  let active = false, root = null, composer = null, ao = null;
  let panels = [], shadows = [], selection = '', pose = '', lightCount = 0;
  const lightScale = 1 / 1500;
  const pathTracer = createEnvironmentPathTracer({ scene, renderer, camera, getRobot, requestRender, interactionActive,
    getNormals: () => ao.normalRenderTarget.texture,
    getRoot: () => root, getLights: () => group.children, getBackground: () => scene.background,
    rasterize: renderRaster, status: text => {
      const label = document.querySelector('#envRenderStatus');
      if (label && label.textContent !== text) label.textContent = text;
    } });
  RectAreaLightUniformsLib.init();

  function prepareComposer() {
    if (composer) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.25, thickness: 0.1, distanceExponent: 1,
      distanceFallOff: 1, samples: 32, screenSpaceRadius: false });
    ao.updatePdMaterial({ radius: 8, samples: 32 });
    ao.blendIntensity = 0.65;
    // Glass should reveal the room behind it, including that room's contacts.
    const original = ao._overrideVisibility.bind(ao);
    ao._overrideVisibility = () => {
      original();
      scene.traverse(mesh => {
        if (mesh.isMesh && mesh.visible && (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .every(m => m.transparent && m.opacity < 0.95)) {
          ao._visibilityCache.push(mesh); mesh.visible = false;
        }
      });
    };
    composer.addPass(ao);
    composer.addPass(new OutputPass());
  }

  function clear() {
    active = false;
    group.removeFromParent();
    for (const light of shadows) { light.shadow.map?.dispose(); light.shadow.mapPass?.dispose(); }
    group.clear(); panels = []; shadows = []; selection = ''; pose = '';
    root = null;
    pathTracer.reset();
    for (const {light, visible} of studio.lights) light.visible = visible;
    scene.background = studio.background; scene.environment = studio.environment; scene.environmentIntensity = studio.intensity;
    renderer.toneMapping = studio.toneMapping; renderer.toneMappingExposure = studio.exposure;
    renderer.shadowMap.type = studio.shadowType;
  }

  function setEnvironment(environmentRoot, definitions) {
    clear();
    root = environmentRoot;
    active = true;
    for (const {light} of studio.lights) light.visible = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.environmentIntensity = 0.22;
    scene.background = new THREE.Color().setRGB(0.6, 0.62, 0.64);
    const dome = definitions.find(d => d.kind === 'dome');
    const ambient = new THREE.HemisphereLight(new THREE.Color(...(dome?.color || [1, 1, 1])),
      new THREE.Color(0.3, 0.27, 0.23), 0.25);
    ambient.position.set(0, 0, 1); group.add(ambient);
    lightCount = definitions.length;
    for (const definition of definitions) {
      if (definition.kind === 'dome') continue;
      const matrix = new THREE.Matrix4().fromArray(definition.matrix);
      const color = new THREE.Color(...definition.color);
      const intensity = definition.intensity * lightScale;
      const unit = definition.unitScale;
      let light;
      if (definition.kind === 'rect' || definition.kind === 'disk') {
        const width = (definition.width || definition.radius * 2) * unit;
        const height = (definition.height || definition.radius * 2) * unit;
        const luminance = intensity * (definition.kind === 'disk' ? Math.PI / 4 : 1);
        light = new THREE.RectAreaLight(color, luminance, width, height);
        light.userData.luminance = luminance;
        light.userData.area = width * height;
        panels.push(light);
      } else if (definition.kind === 'distant') {
        light = new THREE.DirectionalLight(color, intensity);
      } else {
        light = new THREE.PointLight(color, intensity, 12, 2);
      }
      light.position.setFromMatrixPosition(matrix);
      light.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrix));
      light.name = definition.name;
      group.add(light);
    }
    for (let i = 0; i < Math.min(4, panels.length); i++) {
      const light = new THREE.SpotLight(0xffffff, 0, 16, Math.PI * 0.43, 0.6, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 0.03; light.shadow.camera.far = 16;
      light.shadow.bias = -0.000025; light.shadow.normalBias = 0.002;
      light.shadow.radius = 2;
      light.shadow.autoUpdate = false;
      shadows.push(light); group.add(light, light.target);
    }
    const textures = new Set();
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) {
      texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
    }
    scene.add(group);
    prepareComposer();
    updateShadows();
  }

  function updateShadows() {
    const nearest = [...panels].sort((a, b) => a.position.distanceToSquared(camera.position)
      - b.position.distanceToSquared(camera.position)).slice(0, shadows.length);
    const key = nearest.map(p => p.uuid).join(',');
    if (key !== selection) {
      for (const light of panels) light.intensity = light.userData.luminance;
      nearest.forEach((panel, index) => {
        panel.intensity *= 0.22;
        const light = shadows[index];
        light.color.copy(panel.color);
        light.intensity = panel.userData.luminance * panel.userData.area * 0.78;
        light.position.copy(panel.position);
        light.target.position.copy(panel.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(panel.quaternion));
        light.shadow.needsUpdate = true;
      });
      selection = key;
    }
    const robot = getRobot();
    const current = robot ? [robot.name, ...robot.base.matrixWorld.elements,
      ...robot.jdefs.map(d => robot.robot.getJointValue(d.path))].join(',') : '';
    if (current !== pose) {
      for (const light of shadows) light.shadow.needsUpdate = true;
      pose = current;
    }
  }

  function renderRaster() {
    updateShadows();
    const next = renderer.getSize(new THREE.Vector2());
    if (!size.equals(next)) {
      size.copy(next); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(size.x, size.y);
    }
    composer.render();
  }
  return { get active() { return active; }, render: () => {
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      if (!pathTracer.render()) renderRaster();
    }, setEnvironment, clear, setQuality: pathTracer.setMode,
    refresh: () => { for (const light of shadows) light.shadow.needsUpdate = true; pathTracer.reset(); },
    debug: () => ({ active, authoredLights: lightCount, shadowLights: shadows.length,
      ao: !!ao, exposure: renderer.toneMappingExposure, lightScale, pathTracing: pathTracer.debug() }) };
}

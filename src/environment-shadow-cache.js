import * as THREE from 'three';

/** Reuse exact static PCF depth, then draw only the moving robot into its copy.
 * Owns cache targets and depth materials; never edits source geometry or USD data.
 * Static maps use the ordinary renderer, retaining its PCF clipping and bias.
 */
export function createEnvironmentShadowCache(renderer, scene, getRobot) {
  const cached = new Map(), depthMaterials = new Map();
  const dynamic = new THREE.Scene();
  // A millimetre-deep view collects the lights but no visible room geometry.
  // The standard renderer still renders each light's independent shadow frustum.
  const cacheCamera = new THREE.PerspectiveCamera(1, 1, 0.001, 0.002);
  const scratch = new THREE.WebGLRenderTarget(1, 1);
  let model = null, copies = [], previousPose = '', revision = 0;
  let staticUpdates = 0, dynamicUpdates = 0;
  function clear() {
    for (const target of cached.values()) target.dispose();
    for (const material of depthMaterials.values()) material.dispose();
    cached.clear(); depthMaterials.clear(); dynamic.clear(); scratch.dispose();
    copies = []; model = null; previousPose = ''; revision++;
  }
  function syncRobot(robot) {
    if (robot !== model) {
      dynamic.clear(); copies = []; model = robot;
      for (const source of robot?.visuals || []) {
        if (!source.isMesh) continue;
        const materials = (Array.isArray(source.material) ? source.material : [source.material]).map(original => {
          let material = depthMaterials.get(original.uuid);
          if (!material) {
            material = new THREE.MeshDepthMaterial({ colorWrite: false,
              side: original.shadowSide ?? (original.side === THREE.DoubleSide ? THREE.DoubleSide
                : original.side === THREE.BackSide ? THREE.FrontSide : THREE.BackSide),
              map: original.map, alphaMap: original.alphaMap, alphaTest: original.alphaTest,
              displacementMap: original.displacementMap, displacementScale: original.displacementScale,
              displacementBias: original.displacementBias });
            depthMaterials.set(original.uuid, material);
          }
          return material;
        });
        const copy = new THREE.Mesh(source.geometry, Array.isArray(source.material) ? materials : materials[0]);
        copy.matrixAutoUpdate = false; dynamic.add(copy); copies.push({source,copy});
      }
    }
    for (const {source,copy} of copies) {
      let visible = source.castShadow;
      for (let parent = source; parent; parent = parent.parent) visible &&= parent.visible;
      copy.visible = !!visible; copy.matrix.copy(source.matrixWorld);
    }
  }
  function update(lights, camera, invalid = false) {
    const robot = getRobot();
    const pose = robot ? [robot.root.uuid, robot.root.visible, ...robot.base.matrixWorld.elements,
      ...robot.jdefs.map(d => robot.robot.getJointValue(d.path)), ...robot.visuals.map(v => v.visible)].join(',') : '';
    const rebuild = invalid || lights.some(light => !cached.has(light.uuid));
    if (!rebuild && pose === previousPose) return;
    const previous = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear,
      shadows: renderer.shadowMap.enabled, robotVisible: robot?.root.visible };
    try {
      if (rebuild) {
        if (robot) robot.root.visible = false;
        for (const light of lights) light.shadow.needsUpdate = true;
        // Only depth is rendered here. The ordinary color/AO passes run once afterwards.
        cacheCamera.position.copy(camera.position); cacheCamera.quaternion.copy(camera.quaternion);
        cacheCamera.layers.mask = camera.layers.mask;
        renderer.setRenderTarget(scratch);
        renderer.render(scene, cacheCamera);
        for (const light of lights) {
          const source = light.shadow.map;
          let target = cached.get(light.uuid);
          if (!target || target.width !== source.width || target.height !== source.height) {
            target?.dispose();
            target = new THREE.WebGLRenderTarget(source.width, source.height, {
              depthTexture: new THREE.DepthTexture(source.width, source.height, source.depthTexture.type),
            });
            cached.set(light.uuid, target); renderer.initRenderTarget(target);
          }
          renderer.copyTextureToTexture(source.depthTexture, target.depthTexture);
        }
        staticUpdates++; revision++;
      }
      if (robot) robot.root.visible = previous.robotVisible;
      syncRobot(robot);
      renderer.autoClear = false; renderer.shadowMap.enabled = false;
      for (const light of lights) {
        const target = cached.get(light.uuid);
        renderer.copyTextureToTexture(target.depthTexture, light.shadow.map.depthTexture);
        renderer.setRenderTarget(light.shadow.map);
        renderer.render(dynamic, light.shadow.camera);
        light.shadow.needsUpdate = false;
      }
      dynamicUpdates++; previousPose = pose;
    } finally {
      if (robot) robot.root.visible = previous.robotVisible;
      renderer.autoClear = previous.autoClear; renderer.shadowMap.enabled = previous.shadows;
      renderer.setRenderTarget(previous.target);
    }
  }
  return { update, clear, debug: () => ({staticUpdates, dynamicUpdates, maps: cached.size, revision}) };
}

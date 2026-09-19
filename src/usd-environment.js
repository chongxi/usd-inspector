import { usdLightColor } from './usd-light-color.js';

/** Build a complete environment at its authored pose, independently of robot articulation discovery. */
export function createEnvironmentReader(THREE, runtime) {
  return async function readEnvironment(source, progress, cancelled) {
    const bytes = typeof source === 'string'
      ? await fetch(source).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      }) : await source.arrayBuffer();
    if (cancelled()) throw new Error('Load cancelled');
    progress('Reading USD layers and embedded textures…');
    await new Promise(resolve => setTimeout(resolve, 20));
    const warnings = [];
    const warn = message => { if (warnings.length < 80) warnings.push(message); };
    const loader = new runtime.USDLoader({ worldUp: 'Z', onWarn: warn });
    const { stage, resolver, baseUrl } = await loader.openSource(new Uint8Array(bytes),
      typeof source === 'string' ? source : source.name);
    const root = new THREE.Group();
    const unit = stage.GetMetersPerUnit();
    if (!Number.isFinite(unit) || unit <= 0) throw new Error('Invalid USD metres-per-unit');
    root.scale.setScalar(unit);
    if (stage.GetUpAxis() === 'Y') root.rotation.x = Math.PI / 2;
    else if (stage.GetUpAxis() === 'X') root.rotation.y = -Math.PI / 2;
    const images = new Map(), textures = new Map();
    const wrap = value => value === 'clamp' || value === 'black' ? THREE.ClampToEdgeWrapping
      : value === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
    function textureProvider(path, options = {}) {
      const resolved = resolver.resolve(path, baseUrl);
      const key = resolved + JSON.stringify(options);
      if (textures.has(key)) return textures.get(key);
      const texture = new THREE.Texture();
      texture.colorSpace = options.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = wrap(options.wrapS); texture.wrapT = wrap(options.wrapT);
      texture.channel = options.channel || 0;
      if (options.transform?.scale) texture.repeat.fromArray(options.transform.scale);
      if (options.transform?.translation) texture.offset.fromArray(options.transform.translation);
      if (options.transform?.rotation) texture.rotation = options.transform.rotation * Math.PI / 180;
      if (!images.has(resolved)) {
        const promise = resolver.fetchBytes(resolved).then(data => new Promise((resolve, reject) => {
          const url = URL.createObjectURL(new Blob([data]));
          const image = new Image();
          image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
          image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Cannot decode texture ${path}`)); };
          image.src = url;
        }));
        // Observe rejection immediately while meshes are still being built.
        promise.catch(() => {});
        images.set(resolved, promise);
      }
      const ready = images.get(resolved).then(image => { texture.image = image; texture.needsUpdate = true; });
      ready.catch(() => {});
      texture.userData.ready = ready;
      textures.set(key, texture);
      return texture;
    }
    const defaultPath = stage.GetDefaultPrim()?.GetPath();
    const prims = stage.Traverse();
    const lights = [];
    let count = 0;
    for (const prim of prims) {
      const path = prim.GetPath();
      if (defaultPath && path !== defaultPath && !path.startsWith(defaultPath + '/')) continue;
      let hidden = false;
      for (let parent = prim; parent && !parent.IsPseudoRoot(); parent = parent.GetParent()) {
        if (parent.GetAttribute('visibility').Get() === 'invisible'
          || ['guide', 'proxy'].includes(parent.GetAttribute('purpose').Get())) { hidden = true; break; }
      }
      if (hidden) continue;
      const light = runtime.getLight?.(prim);
      if (light) lights.push({ ...light, color: usdLightColor(prim), matrix: runtime.worldTransform(prim) });
      if (!runtime.isGeometry(prim)) continue;
      // CollisionAPI does not mean invisible: walls, floors and table surfaces
      // intentionally have both render geometry and a collision shape.
      const object = runtime.createMesh(prim, stage, { textureProvider, onWarn: warn });
      if (!object) continue;
      object.name = prim.GetName();
      object.userData.primPath = path;
      object.matrix.fromArray(runtime.worldTransform(prim));
      object.matrixAutoUpdate = false;
      root.add(object);
      if (++count % 200 === 0) {
        progress(`Building environment · ${count.toLocaleString()} parts…`);
        await new Promise(resolve => setTimeout(resolve, 0));
        if (cancelled()) throw new Error('Load cancelled');
      }
    }
    if (!count) throw new Error('No visible geometry found in the USD default prim');
    progress(`Loading ${images.size} textures…`);
    await Promise.all([...textures.values()].map(texture => texture.userData.ready));
    for (const texture of textures.values()) delete texture.userData.ready;
    root.userData.warnings = warnings;
    root.userData.textureCount = images.size;
    root.updateMatrixWorld(true);
    root.userData.lights = lights.map(light => ({ ...light,
      matrix: new THREE.Matrix4().multiplyMatrices(root.matrixWorld, new THREE.Matrix4().fromArray(light.matrix)).toArray(),
      unitScale: unit }));
    root.userData.download = { bytes: new Uint8Array(bytes), name: typeof source === 'string'
      ? decodeURIComponent(new URL(source).pathname.split('/').pop()) || 'environment.usdz'
      : source.name };
    return root;
  };
}

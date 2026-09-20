/** Identify architecture by its owning object, not appliance parts named ceiling_liner. */
export function isCeilingPart(path) {
  const owner = path.split('/Geometry/')[0];
  return /(?:ceiling|roof)(?:_|\/|$)/i.test(owner)
    || /\/(?:corridor_light_\d+|office_linear_light_[\d_]+)(?:\/|$)/.test(owner);
}

/** Batch opaque geometry by material; cull each instance in camera and shadow views. */
export function batchEnvironment(THREE, source, { multiDraw = true } = {}) {
  source.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'Environment';
  const geometries = new Map(), groups = new Map();
  const retainedGeometries = new Set();
  const attributes = geometry => [geometry.index, ...Object.keys(geometry.attributes).sort()
    .map(name => geometry.attributes[name])].filter(Boolean);
  function geometryKey(geometry) {
    let hash = 2166136261;
    for (const attribute of attributes(geometry)) {
      const bytes = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
      for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
    }
    return `${hash >>> 0}:${Object.keys(geometry.attributes).sort().join(',')}:${!!geometry.index}:${JSON.stringify(geometry.groups)}:${attributes(geometry)
      .map(a => `${a.itemSize}/${a.normalized}/${a.array.constructor.name}/${a.count}`).join('|')}`;
  }
  function sameGeometry(a, b) {
    const aa = attributes(a), bb = attributes(b);
    return aa.every((attr, n) => attr.array.every((value, i) => value === bb[n].array[i]));
  }
  function materialKey(material) {
    const result = {};
    for (const key of ['type', 'color', 'emissive', 'emissiveIntensity', 'metalness', 'roughness',
      'opacity', 'transparent', 'side', 'alphaTest', 'vertexColors', 'flatShading', 'depthWrite',
      'normalScale', 'normalMapType', 'bumpScale', 'displacementScale', 'displacementBias',
      'ior', 'transmission', 'thickness', 'clearcoat', 'clearcoatRoughness', 'clearcoatNormalScale',
      'sheen', 'sheenColor', 'sheenRoughness', 'specularIntensity', 'specularColor',
      'attenuationColor', 'attenuationDistance', 'iridescence', 'iridescenceIOR',
      'iridescenceThicknessRange', 'anisotropy', 'anisotropyRotation', 'aoMapIntensity',
      'lightMapIntensity', 'envMapIntensity', 'blending', 'depthTest', 'depthFunc',
      'alphaToCoverage', 'premultipliedAlpha', 'dithering', 'toneMapped', 'wireframe',
      'visible', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'shadowSide']) {
      const value = material[key];
      result[key] = value?.toArray ? value.toArray() : value;
    }
    for (const [key, value] of Object.entries(material)) {
      if (value?.isTexture) result[key] = value.uuid;
    }
    return JSON.stringify(result);
  }
  let originalMeshes = 0;
  source.traverse(mesh => {
    if (!mesh.isMesh && !mesh.isPoints && !mesh.isLine) return;
    for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    originalMeshes++;
    const ceiling = isCeilingPart(mesh.userData.primPath || mesh.name);
    if (!mesh.isMesh) {
      const copy = mesh.clone(false);
      copy.matrix.copy(mesh.matrixWorld);
      copy.matrixAutoUpdate = false;
      copy.userData.ceiling = ceiling;
      root.add(copy);
      return;
    }
    const key = geometryKey(mesh.geometry);
    let matches = geometries.get(key);
    if (!matches) geometries.set(key, matches = []);
    let geometry = matches.find(g => sameGeometry(g, mesh.geometry));
    if (!geometry) { geometry = mesh.geometry; matches.push(geometry); }
    else if (geometry !== mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const canInstance = materials.every(m => !m.transparent && !m.transmission)
      && mesh.matrixWorld.determinant() > 0;
    const layout = `${!!geometry.index}:${Object.keys(geometry.attributes).sort().map(name => {
      const a = geometry.attributes[name];
      return `${name}/${a.itemSize}/${a.normalized}/${a.array.constructor.name}`;
    }).join('|')}`;
    const canBatch = canInstance && materials.length === 1 && Object.keys(geometry.morphAttributes).length === 0;
    // Older WebGL implementations may lack WEBGL_multi_draw. Keep GPU instancing
    // in small spatial cells there instead of issuing one fallback draw per object.
    const position = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const cell = [position.x, position.y, position.z].map(v => Math.floor(v / 4)).join(',');
    const groupKey = canBatch
      ? `${ceiling}:${materialKey(materials[0])}:${layout}:${multiDraw ? 'batch' : `${geometry.uuid}:${cell}`}`
      : mesh.uuid;
    let group = groups.get(groupKey);
    if (!group) groups.set(groupKey, group = { geometry, material: mesh.material, ceiling, canBatch, members: [] });
    group.members.push({ geometry, material: mesh.material, matrix: mesh.matrixWorld.clone(), path: mesh.userData.primPath });
  });
  let triangles = 0;
  for (const group of groups.values()) {
    const { geometry, material, ceiling, members, canBatch } = group;
    let mesh;
    if (canBatch && multiDraw && members.length > 1) {
      const unique = [...new Set(members.map(m => m.geometry))];
      const vertices = unique.reduce((n, g) => n + g.attributes.position.count, 0);
      const indices = unique.reduce((n, g) => n + (g.index?.count || 0), 0);
      mesh = new THREE.BatchedMesh(members.length, vertices, indices, material);
      mesh.sortObjects = false;
      mesh.perObjectFrustumCulled = true;
      const ids = new Map(unique.map(g => [g, mesh.addGeometry(g)]));
      for (const member of members) {
        mesh.setMatrixAt(mesh.addInstance(ids.get(member.geometry)), member.matrix);
        retainedGeometries.add(member.geometry);
      }
      // Photo mode reads the exact originals, not the GPU's packed geometry.
      mesh.userData.batchSources = members;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    } else if (canBatch && members.length > 1) {
      mesh = new THREE.InstancedMesh(geometry, material, members.length);
      members.forEach((member, i) => mesh.setMatrixAt(i, member.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    } else {
      mesh = new THREE.Mesh(geometry, material);
      mesh.matrix.copy(members[0].matrix);
    }
    mesh.matrixAutoUpdate = false;
    mesh.userData.ceiling = ceiling;
    mesh.userData.members = members.map(member => member.path);
    mesh.receiveShadow = true;
    const materials = Array.isArray(material) ? material : [material];
    mesh.castShadow = materials.some(m => !m.transparent && (m.emissiveIntensity || 0)
      * ((m.emissive?.r || 0) + (m.emissive?.g || 0) + (m.emissive?.b || 0)) < 0.01);
    root.add(mesh);
    triangles += members.reduce((n, m) => n + (m.geometry.index?.count || m.geometry.attributes.position.count) / 3, 0);
  }
  root.userData.retainedGeometries = retainedGeometries;
  root.updateMatrixWorld(true);
  return { root, originalMeshes, drawMeshes: root.children.length, triangles, batching: multiDraw ? 'multi-draw' : 'spatial-instancing' };
}

/** Dispose only resources owned by this environment. Robots use separate loaders. */
export function disposeEnvironment(root) {
  const geometries = new Set(root?.userData.retainedGeometries), materials = new Set(), textures = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    for (const member of object.userData.batchSources || []) {
      for (const material of Array.isArray(member.material) ? member.material : [member.material]) materials.add(material);
    }
    object.dispose?.();
  });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
  root?.removeFromParent();
}

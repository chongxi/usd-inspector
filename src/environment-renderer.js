/** Identify architecture by its owning object, not appliance parts named ceiling_liner. */
export function isCeilingPart(path) {
  const owner = path.split('/Geometry/')[0];
  return /(?:ceiling|roof)(?:_|\/|$)/i.test(owner)
    || /\/(?:corridor_light_\d+|office_linear_light_[\d_]+)(?:\/|$)/.test(owner);
}

/** Batch only identical opaque meshes, preserving every authored world transform. */
export function batchEnvironment(THREE, source) {
  source.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'Environment';
  const geometries = new Map(), groups = new Map();
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
      'normalScale', 'ior', 'transmission', 'thickness', 'clearcoat', 'clearcoatRoughness']) {
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
    const groupKey = canInstance
      ? `${geometry.uuid}:${ceiling}:${materials.map(materialKey).join(';')}`
      : mesh.uuid;
    let group = groups.get(groupKey);
    if (!group) groups.set(groupKey, group = { geometry, material: mesh.material, ceiling, members: [] });
    group.members.push({ matrix: mesh.matrixWorld.clone(), path: mesh.userData.primPath });
  });
  let triangles = 0;
  for (const group of groups.values()) {
    const { geometry, material, ceiling, members } = group;
    const mesh = members.length > 1
      ? new THREE.InstancedMesh(geometry, material, members.length)
      : new THREE.Mesh(geometry, material);
    if (mesh.isInstancedMesh) {
      members.forEach((member, i) => mesh.setMatrixAt(i, member.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    } else {
      mesh.matrix.copy(members[0].matrix);
      mesh.matrixAutoUpdate = false;
    }
    mesh.userData.ceiling = ceiling;
    mesh.userData.members = members.map(member => member.path);
    mesh.receiveShadow = true;
    // The existing key light shadows the robot. Thousands of building parts
    // should not produce another full-building shadow render on every input.
    mesh.castShadow = false;
    root.add(mesh);
    triangles += ((geometry.index?.count || geometry.attributes.position.count) / 3) * members.length;
  }
  root.updateMatrixWorld(true);
  return { root, originalMeshes, drawMeshes: root.children.length, triangles };
}

/** Dispose only resources owned by this environment. Robots use separate loaders. */
export function disposeEnvironment(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    object.dispose?.();
  });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
  root?.removeFromParent();
}

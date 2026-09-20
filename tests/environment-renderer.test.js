import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchEnvironment, disposeEnvironment, isCeilingPart } from '../src/environment-renderer.js';

test('ceiling visibility affects architecture and its lights, never appliance liners', () => {
  for (const name of ['corridor_ceiling', 'ceiling_grid_x_4_48', 'corridor_light_0', 'office_linear_light_1_2_0']) {
    assert.equal(isCeilingPart(`/World/Objects/${name}/Geometry/panel`), true, name);
  }
  for (const path of [
    '/World/Objects/cooler_carcass/Geometry/ceiling_liner',
    '/World/Objects/phone_booth_west_1_shell/Geometry/oak_ceiling_liner',
    '/World/Objects/corridor_electrical_panel/Geometry/panel',
    '/World/Objects/stair_exit_sign/Geometry/sign',
  ]) assert.equal(isCeilingPart(path), false, path);
});


test('batching preserves distinct shapes, all world transforms and physical material values', () => {
  const root = new THREE.Group(); root.position.set(4, -2, 1); root.rotation.z = 0.4;
  const material = new THREE.MeshStandardMaterial({color: '#709897', roughness: 0.35, metalness: 0.8});
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), material.clone());
  a.position.set(-2, 1, 0); b.position.set(3, 1, 0.7); b.scale.set(2, 1, 0.8);
  root.add(a, b); root.updateMatrixWorld(true);
  const boxes = [a, b].map(m => new THREE.Box3().setFromObject(m));
  const {root: result, originalMeshes, drawMeshes} = batchEnvironment(THREE, root);
  assert.equal(originalMeshes, 2); assert.equal(drawMeshes, 1);
  const batch = result.children[0]; assert.ok(batch.isBatchedMesh);
  assert.equal(batch.material.metalness, 0.8); assert.equal(batch.material.roughness, 0.35);
  for (let i = 0; i < 2; i++) {
    const matrix = batch.getMatrixAt(i, new THREE.Matrix4());
    const box = batch.getBoundingBoxAt(batch.getGeometryIdAt(i), new THREE.Box3()).applyMatrix4(matrix);
    assert.ok(box.min.distanceTo(boxes[i].min) < 1e-6);
    assert.ok(box.max.distanceTo(boxes[i].max) < 1e-6);
  }
  disposeEnvironment(result);
});

test('glass, mirrored transforms, ceiling and different PBR materials remain separate', () => {
  const root = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({color: 'white'});
  const mats = [base, base.clone(), base.clone(), base.clone(), base.clone(), base.clone()];
  mats[1].transparent = true; mats[1].opacity = 0.4;
  mats[2].toneMapped = false; mats[3].roughness = 0.25;
  mats.forEach((mat, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    m.userData.primPath = `/World/Objects/${i === 5 ? 'corridor_ceiling' : 'wall'}/Geometry/${i}`;
    if (i === 4) m.scale.x = -1;
    root.add(m);
  });
  const result = batchEnvironment(THREE, root);
  assert.equal(result.drawMeshes, 6);
  assert.equal(result.root.children.filter(m => m.userData.ceiling).length, 1);
  assert.equal(result.root.children.filter(m => m.material.transparent).length, 1);
  disposeEnvironment(result.root);
});

test('floor picking uses each batch instance transform, including rotated surfaces', () => {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial({side: THREE.DoubleSide});
  for (let x of [-2, 2]) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), material);
    floor.position.set(x, 0, -0.05); floor.rotation.z = 0.25; root.add(floor);
  }
  root.updateMatrixWorld(true);
  const result = batchEnvironment(THREE, root);
  for (let x of [-2, 2]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 0, 2), new THREE.Vector3(0, 0, -1));
    const original = ray.intersectObjects(root.children, false)[0];
    const hit = ray.intersectObjects(result.root.children, false)[0];
    assert.ok(hit.point.distanceTo(original.point) < 1e-6);
    assert.ok(Number.isInteger(hit.batchId));
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(
      hit.object.getMatrixAt(hit.batchId, new THREE.Matrix4()))).normalize();
    assert.ok(normal.z > .99);
  }
  disposeEnvironment(result.root);
});


test('devices without multi-draw retain shared GPU instances with spatial culling', () => {
  const source = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  for (const x of [0, 1, 20, 21]) { const mesh = new THREE.Mesh(geometry, material); mesh.position.x = x; source.add(mesh); }
  const result = batchEnvironment(THREE, source, {multiDraw: false});
  assert.equal(result.batching, 'spatial-instancing');
  assert.equal(result.drawMeshes, 2);
  for (const mesh of result.root.children) { assert.ok(mesh.isInstancedMesh); assert.equal(mesh.count, 2); }
  assert.equal(result.triangles, 48);
  disposeEnvironment(result.root);
});

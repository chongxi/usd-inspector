import test from 'node:test';
import assert from 'node:assert/strict';
import { isCeilingPart } from '../src/environment-renderer.js';

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

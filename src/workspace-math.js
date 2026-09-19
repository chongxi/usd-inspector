/** Integrate an X-forward planar twist. Metres, radians, seconds; returns a new pose. */
export function advanceDrive(pose, linear, angular, dt) {
  if (![pose.x, pose.y, pose.yaw, linear, angular, dt].every(Number.isFinite) || dt < 0) {
    throw new RangeError('Drive pose, velocity and nonnegative time must be finite');
  }
  const turn = angular * dt;
  const distance = Math.abs(angular) < 1e-9
    ? linear * dt
    : 2 * linear * Math.sin(turn / 2) / angular;
  return {
    ...pose,
    x: pose.x + distance * Math.cos(pose.yaw + turn / 2),
    y: pose.y + distance * Math.sin(pose.yaw + turn / 2),
    yaw: Math.atan2(Math.sin(pose.yaw + turn), Math.cos(pose.yaw + turn)),
  };
}

/** Rolling angle for a wheel in the base frame; axis is a unit vector, radius in metres. */
export function wheelIncrement(position, axis, radius, linear, angular, dt) {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return ((linear - angular * position[1]) * axis[1]
    - angular * position[0] * axis[0]) * dt / radius;
}

/** Parse a share-link pose: x,y,support-z in metres, heading in degrees. */
export function parsePlacement(value) {
  if (!value) return null;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some(v => !v.trim())) return null;
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1], z: numbers[2], yaw: numbers[3] * Math.PI / 180 };
}

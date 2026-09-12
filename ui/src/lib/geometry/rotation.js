/**
 * 📄 geometry/rotation.js — put a lap the right way up.
 *
 * FastF1 gives X/Y in the circuit's own frame; each event carries a rotation
 * that orients it the way the track is drawn on TV. Every set of coordinates —
 * the outline, the corners, each driver's telemetry — has to go through the
 * same rotation or they end up in different frames, which is exactly how the
 * car once ended up driving beside the track instead of on it.
 */
// x' = x·cosθ - y·sinθ ,  y' = x·sinθ + y·cosθ
export const applyRotation = (x, y, angleDeg) => {
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
};

/** Rotate a telemetry frame list onto the circuit's official orientation. */
export const rotateFrames = (frames, angle) => frames.map((p) => {
    const r = applyRotation(p.x, p.y, angle);
    return { ...p, x: r.x, y: r.y };
});


/**
 * 📄 camera.js — how the map moves when it is following a car.
 *
 * A zoomed map that snaps straight to a car is unwatchable. The car is drawn
 * from a 2 Hz payload interpolated to the frame rate, so its position carries
 * the interpolation's small wobble; at 3x zoom that wobble is three times
 * wider, and a camera pinned exactly to it shakes the entire circuit around a
 * dot that is standing still on screen. Broadcast never does this — a real
 * camera has mass.
 *
 * So the camera LAGS its target, by a fixed time constant rather than a fixed
 * step. The difference matters: a per-frame step of "move 8% of the way" is a
 * different speed at 30fps than at 144fps, and this app already runs at both.
 * An exponential approach expressed in seconds is the same motion on every
 * machine, which is the whole reason `dt` is threaded through here.
 *
 * Everything in this file is pure and frame-rate independent, so the follow
 * can be tested without a browser, a clock or a car.
 */

/** Zoom factor while following a car. */
export const FOCUS_ZOOM = 3.2;

/** Zoom factor for the whole circuit. */
export const WIDE_ZOOM = 1;

/**
 * Follow time constant, in seconds of WALL time.
 *
 * Not race time: this is about how the motion feels to the eye, and the eye is
 * watching a screen at 1x whether the replay is at 1x or 10x. Tying it to race
 * time would make the camera ten times stiffer at 10x — exactly backwards,
 * because that is when the car is moving fastest across the map.
 *
 * 0.28 s lands between the two failures: at 0.1 the wobble comes straight
 * through, and at 0.6 the car visibly leads its own camera out of frame
 * through a fast corner.
 */
export const TAU = 0.28;

/**
 * The longest frame this will honour.
 *
 * A backgrounded tab hands back a dt of seconds, and the car will have
 * travelled half the circuit in that time. The cap has to sit ABOVE the time
 * constant or it silently becomes the time constant — at 0.25 against a tau of
 * 0.28 no frame could ever cover a full time constant's worth of ground. Two
 * time constants resolves a stall in one frame at 83% of the way there, which
 * reads as the camera catching up rather than as a teleport.
 */
const MAX_DT = TAU * 2;

/**
 * One step of an exponential approach from `cur` towards `target`.
 *
 * `1 - e^(-dt/tau)` is the fraction of the remaining distance to cover in this
 * frame. Two frames of dt cover exactly as much ground as one frame of 2·dt,
 * which is what makes the motion identical at any frame rate.
 */
export const followStep = (cur, target, dt, tau = TAU) => {
    if (!Number.isFinite(target)) return cur;
    if (!Number.isFinite(cur)) return target;
    if (!(dt > 0) || !(tau > 0)) return dt === 0 ? cur : target;
    const k = 1 - Math.exp(-Math.min(dt, MAX_DT) / tau);
    return cur + (target - cur) * k;
};

/**
 * Advance a whole camera one frame.
 *
 * `cam` and `target` are both { cx, cy, k } in TRACK units — the same units
 * the cars are moved in, so a target is just a car's position.
 *
 * A null target means "hold": the car being followed is off track for this
 * frame (in the pit lane's dead zone, or retired), and the last thing a viewer
 * wants is the camera diving to the origin because the data went quiet.
 *
 * `animate` FALSE MEANS CUT, and it is how a paused replay behaves.
 *
 * A glide is a sequence of frames, and while the clock is stopped there are
 * no frames — the map is repainted once when you pick a driver and then not
 * again. So an animated camera on a paused replay travelled about six percent
 * of the way and stopped: picking a driver crept slightly inwards, and
 * pressing Escape left the map frozen half zoomed (measured: a viewBox 12420
 * wide against 22589 at the wide shot). Driving it from its own animation
 * loop would fix the arithmetic and keep the dependency — on a stream of
 * frames that a stopped clock has no reason to produce.
 *
 * Cutting instead is both simpler and better: there is no motion on screen to
 * be smooth with, and an instant reframe is what a broadcast director does
 * between shots anyway. The glide is kept for when the race is actually
 * running, which is when there is something to follow.
 */
export const cameraStep = (cam, target, dt, animate = true, tau = TAU) => {
    if (!target) return cam;
    if (!animate) return { cx: target.cx, cy: target.cy, k: target.k };
    return {
        cx: followStep(cam.cx, target.cx, dt, tau),
        cy: followStep(cam.cy, target.cy, dt, tau),
        k: followStep(cam.k, target.k, dt, tau),
    };
};

/**
 * The projection a camera implies, and the viewBox that matches it.
 *
 * THE TRACK AND THE CARS ARE MOVED BY DIFFERENT MECHANISMS and they have to
 * agree to the pixel, or the field drifts off the circuit it is racing on.
 * The cars are projected in JS — they simply get this scale and offset. The
 * track is one SVG, and it is moved by rewriting its `viewBox`.
 *
 * NOT BY A CSS TRANSFORM, which is what this did first and which looks wrong
 * the moment you zoom: the SVG sits on its own compositor layer, so the
 * browser rasterises it once at 1x and then scales that bitmap. At 3.2x the
 * circuit came out visibly soft against the timing tower's text beside it. A
 * viewBox is geometry rather than a bitmap operation, so the track is redrawn
 * as vectors at whatever zoom it is asked for and stays sharp. It costs a
 * repaint per frame, which the race map — one path, a pit lane, four DRS
 * zones and three ticks — can afford; the 170-path speed view that the
 * compositor hint was added for is in lap mode, which has no camera.
 *
 * The window is centred on the camera and exactly the shape of the box, so
 * `preserveAspectRatio` has nothing to letterbox and the SVG's own mapping
 * reduces to the same `p·scale + off` the cars use. The test asserts that.
 *
 * @param base  the projection that fits the whole circuit in the box
 * @param cam   { cx, cy, k } in track units, or null for no camera
 */
export const camProjection = (base, cam, viewW, viewH) => {
    // No camera, or nothing to point it at. A box with no size is the one
    // that matters: the window it implies is viewW/scale, so a zero there
    // makes a viewBox of NaNs and an SVG given a viewBox of NaNs draws
    // NOTHING. Falling back to the authored one means the worst a
    // mid-resize frame can do is show the whole circuit.
    if (!cam || !(viewW > 0) || !(viewH > 0) || !(base.scale > 0)) {
        return { scale: base.scale, offX: base.offX, offY: base.offY, k: 1, vb: null };
    }
    const { cx, cy, k } = cam;
    const scale = base.scale * k;
    const w = viewW / scale;
    const h = viewH / scale;
    return {
        scale,
        offX: viewW / 2 - cx * scale,
        offY: viewH / 2 - cy * scale,
        k,
        vb: [cx - w / 2, cy - h / 2, w, h],
    };
};

/**
 * Has the camera finished pulling back out to the whole circuit?
 *
 * Asked because a camera at zoom 1.0001 is not the same thing as no camera at
 * all: the track is still being drawn through a CSS transform, so it is still
 * being composited and still rounding sub-pixel. Once the pull-back is
 * visually over, the map drops back to its untransformed self.
 */
export const isWide = (cam) => !cam || Math.abs(cam.k - WIDE_ZOOM) < 0.01;

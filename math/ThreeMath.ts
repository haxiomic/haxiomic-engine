import { PerspectiveCamera, Vector2, Vector3, Vector4 } from "three";

export function isFiniteVector4(v: Vector4) {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z) && isFinite(v.w);
}

export function isFiniteVector3(v: Vector3) {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
}

export function isFiniteVector2(v: Vector2) {
    return isFinite(v.x) && isFinite(v.y);
}

export function getPerspectiveFitDistance(camera: PerspectiveCamera, box: Vector3) {
    const width = box.x;
    const height = box.y;
    const depth = box.z;

    const fovY = camera.getEffectiveFOV();
    const fovY_radians = fovY * (Math.PI / 180);

    // tan(fov_radians * .5) = (worldSpaceSizeXY.y * .5) / distance
    const fitDistanceY = (height * 0.5) / Math.tan(fovY_radians * 0.5);

    // now we need to find fovX
    // what is height at distance 1 given fovY * .5
    // h = 2 * tan(fovY_radians * .5)
    // w = h * aspect
    // w = 2 * tan(fovX_radians * .5)
    // h * aspect = 2 * tan(fovX_radians * .5)
    // 2 * atan(h * aspect * .5) = fovX_radians
    // fovX_radians = 2 * atan(tan(fovY_radians * .5) * aspect)

    const fovX_radians = 2 * Math.atan(Math.tan(fovY_radians * 0.5) * (camera.aspect));
    const fitDistanceX = (width * 0.5) / Math.tan(fovX_radians * 0.5);
    return Math.max(fitDistanceX, fitDistanceY) + depth * .5;
}
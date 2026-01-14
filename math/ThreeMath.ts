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

/**
 * Calculates the distance a perspective camera needs to be from the center of a sphere to perfectly fit it in view in the vertical FOV.
 */
export function getPerspectiveFitDistanceSphere(
    camera: PerspectiveCamera,
    sphereRadius: number,
    fitAxis: 'vertical' | 'horizontal' | 'both',
    zoomMode: 'account-zoom' | 'ignore-zoom' = 'account-zoom',
    apparentScale: number = 1,
): number {
    // https://www.tldraw.com/f/TUarjjiCcGRndvWDyWpK1?d=v314.74.1589.1072.page

    const fovY_radians = (zoomMode === 'account-zoom' ? camera.getEffectiveFOV() : camera.fov) * (Math.PI / 180);
    const fovX_radians = 2 * Math.atan(Math.tan(fovY_radians * 0.5) * camera.aspect);

    let fovRad;
    switch (fitAxis) {
        default:
        case 'vertical':
            fovRad = fovY_radians;
            break;
        case 'horizontal':
            fovRad = fovX_radians;
            break;
        case 'both':
            fovRad = Math.min(fovX_radians, fovY_radians);
            break;
    }

    const apparentAngle = Math.atan(apparentScale * Math.tan(fovRad / 2));

    return sphereRadius / Math.sin(apparentAngle);
}

/**
 * Calculates the distance a perspective camera needs to be from the center of a box to perfectly fit it in view in both vertical and horizontal FOV.
 */
export function getPerspectiveFitDistanceBox(
    camera: PerspectiveCamera,
    box: Vector3,
    fitAxis: 'vertical' | 'horizontal' | 'both',
    zoomMode: 'account-zoom' | 'ignore-zoom' = 'account-zoom'
): number {
    const width = box.x;
    const height = box.y;
    const depth = box.z;

    const fovY = zoomMode === 'account-zoom' ? camera.getEffectiveFOV() : camera.fov;
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

    switch (fitAxis) {
        default:
        case 'vertical':
            return fitDistanceY + depth * .5;
        case 'horizontal':
            return fitDistanceX + depth * .5;
        case 'both':
            return Math.max(fitDistanceX, fitDistanceY) + depth * .5;
    }
}
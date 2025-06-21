import { Vector3, Vector4 } from "three";

export function isFiniteVector4(v: Vector4) {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z) && isFinite(v.w);
}

export function isFiniteVector3(v: Vector3) {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
}
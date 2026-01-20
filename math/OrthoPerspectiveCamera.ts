import { Camera, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

export enum OrthoPerspectiveCameraMode {
    Orthographic = 0,
    Perspective = 1,
}

/**
 * A camera that smoothly interpolates between perspective and orthographic projection.
 *
 * Extends PerspectiveCamera to maintain compatibility with Three.js utilities that
 * check `isPerspectiveCamera` (like OrbitControls, PhysicallyBasedViewer, etc.).
 *
 * ## Properties
 *
 * **`projectionBlend`** (0 to 1, default: 1)
 * - `1.0` = perspective projection (objects farther away appear smaller)
 * - `0.0` = orthographic projection (no perspective distortion)
 * - Intermediate values blend smoothly between the two
 *
 * **`focus`** (inherited from PerspectiveCamera, default: 10)
 * - The reference distance used to calculate orthographic frustum bounds
 * - At this distance, objects appear the same size in both perspective and ortho modes
 * - When camera distance equals `focus`, no internal zoom correction is applied
 *
 * **`zoom`** (inherited from PerspectiveCamera, default: 1)
 * - Works as expected - multiplies the effective focal length
 * - Increase to make objects appear larger, decrease to make them smaller
 *
 * ## Distance Scaling Behavior
 *
 * Objects scale with camera distance at ALL `projectionBlend` values. Dollying the
 * camera in/out produces consistent scaling whether in perspective, ortho, or between.
 * This matches the expected behavior of a PerspectiveCamera. For true orthographic
 * projection where distance doesn't affect size, use Three.js OrthographicCamera.
 *
 * ## Camera Type Detection
 *
 * `isPerspectiveCamera` and `isOrthographicCamera` return values based on `projectionBlend`:
 * - `projectionBlend >= 0.0`: `isPerspectiveCamera = true`, `isOrthographicCamera = false`
 * - `projectionBlend < 0.0`: `isPerspectiveCamera = false`, `isOrthographicCamera = true`
 *
 * This allows shaders and Three.js utilities to adapt their behavior accordingly.
 *
 * ## Automatic Updates
 *
 * The projection matrix updates automatically when the camera position changes
 * (detected via `updateMatrixWorld` which Three.js calls before rendering).
 * Call `updateProjectionMatrix()` manually only after changing camera properties
 * like `projectionBlend`, `focus`, `fov`, or `zoom`.
 *
 * @example
 * ```typescript
 * const camera = new OrthoPerspectiveCamera(50, aspect, 0.1, 100);
 * camera.position.z = 5;
 * camera.focus = 5; // Match initial camera distance
 * camera.projectionBlend = 0.5;
 * camera.updateProjectionMatrix(); // Call after changing properties
 * // Position changes are handled automatically
 * ```
 */
export class OrthoPerspectiveCamera extends PerspectiveCamera {
    readonly isHybridCamera = true;

    static Orthographic = 0;
    static Perspective = 1;

    /**
     * Blend factor between projection types.
     * - 1.0 = pure perspective projection
     * - 0.0 = pure orthographic projection
     * - Values in between give a smooth blend
     */
    projectionBlend: number = 1.0;

    constructor(fov?: number, aspect?: number, near?: number, far?: number, projectionBlend: OrthoPerspectiveCameraMode | number = OrthoPerspectiveCameraMode.Perspective, focus: number = 10) {
        super(fov, aspect, near, far);

        this.projectionBlend = projectionBlend;
        this.focus = focus;

        // Override isPerspectiveCamera and isOrthographicCamera with dynamic getters
        // These are checked by Three.js shaders and utilities to determine camera behavior
        // Runtime override - TypeScript still sees inherited types but actual values are dynamic
        Object.defineProperty(this, 'isPerspectiveCamera', {
            get: () => this.projectionBlend > 0.0,
            configurable: true,
        });
        Object.defineProperty(this, 'isOrthographicCamera', {
            get: () => this.projectionBlend <= 0.00,
            configurable: true,
        });
    }

    override updateProjectionMatrix(): void {
        // If pure perspective, use standard implementation for efficiency
        if (this.projectionBlend >= 1.0) {
            super.updateProjectionMatrix();
            return;
        }

        // Clamp blend to valid range
        const t = Math.max(0, Math.min(1, this.projectionBlend));
        const oneMinusT = 1 - t;

        const fovRad = this.fov * Math.PI / 180;
        const focalLength = (1 / Math.tan(fovRad / 2)) * this.zoom;

        // Orthographic half-extents sized to match perspective view at focus distance
        // At focus distance, perspective visible half-height = focus * tan(fov/2) / zoom = focus / focalLength
        // This makes objects at focus distance appear the same size in both projection modes
        const focusDistance = Math.max(0.0001, this.focus);
        const orthoHeight = focusDistance / focalLength;
        const orthoWidth = orthoHeight * this.aspect;

        // Depth mapping coefficients (matrix elements [10] and [14])
        // These transform view-space Z to NDC Z with proper blending
        //
        // Standard depth (NDC z in [-1, 1], near→-1, far→1):
        //   Perspective: c = -(far+near)/(far-near), d = -2*far*near/(far-near)
        //   Orthographic: c = -2/(far-near), d = -(far+near)/(far-near)
        //
        // Reversed depth (NDC z in [0, 1], near→1, far→0):
        //   Perspective: c = near/(far-near), d = far*near/(far-near)
        //   Orthographic: c = 1/(far-near), d = far/(far-near)
        //
        const delta = this.far - this.near;
        let A: number;
        let B: number;

        if (this.reversedDepth) {
            // Blended reversed depth: A and B linearly interpolate between
            // perspective and orthographic reversed formulas
            const blend = t * this.near + oneMinusT;
            A = blend / delta;
            B = this.far * blend / delta;
        } else {
            // Blended standard depth
            A = -(t * (this.far + this.near) + 2 * oneMinusT) / delta;
            B = -t * this.near - 1 + t + this.near * A;
        }

        const e = this.projectionMatrix.elements;

        // Column 0: X scaling
        e[0] = t * (focalLength / this.aspect) + oneMinusT / orthoWidth;
        e[1] = 0;
        e[2] = 0;
        e[3] = 0;

        // Column 1: Y scaling
        e[4] = 0;
        e[5] = t * focalLength + oneMinusT / orthoHeight;
        e[6] = 0;
        e[7] = 0;

        // Column 2: Z mapping and W contribution
        e[8] = 0;
        e[9] = 0;
        e[10] = A;
        e[11] = -t;

        // Column 3: Translation
        e[12] = 0;
        e[13] = 0;
        e[14] = B;
        e[15] = 1 - t;

        this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }

    /**
     * Copy properties from another camera, including projectionBlend if source is OrthoPerspectiveCamera.
     */
    override copy(source: PerspectiveCamera | OrthoPerspectiveCamera, recursive?: boolean): this {
        super.copy(source, recursive);

        if ((source as OrthoPerspectiveCamera).isHybridCamera) {
            this.projectionBlend = (source as OrthoPerspectiveCamera).projectionBlend;
        }

        return this;
    }

    /**
     * Create a clone of this camera with all properties including projectionBlend.
     */
    override clone(recursive?: boolean): this {
        const camera = new (this.constructor as new () => this)();
        camera.copy(this, recursive);
        return camera;
    }

    /**
     * Configure this camera to match an OrthographicCamera's view.
     * Sets projectionBlend to 0 (orthographic mode).
     *
     * @param orthoCamera The orthographic camera to copy from
     * @param fov Optional FOV to use (default: 50). Only affects perspective mode.
     */
    fromOrthographicCamera(orthoCamera: OrthographicCamera, fov: number = 50): this {
        // Copy transform
        this.position.copy(orthoCamera.position);
        this.quaternion.copy(orthoCamera.quaternion);
        this.scale.copy(orthoCamera.scale);

        // Copy clipping planes
        this.near = orthoCamera.near;
        this.far = orthoCamera.far;

        // Calculate focus from ortho frustum
        // orthoHeight = focus / focalLength, where focalLength = 1 / tan(fov/2) * zoom
        // So focus = orthoHeight * focalLength = orthoHeight / tan(fov/2) * zoom
        const orthoHeight = (orthoCamera.top - orthoCamera.bottom) / 2;
        const orthoWidth = (orthoCamera.right - orthoCamera.left) / 2;
        const fovRad = fov * Math.PI / 180;
        const focalLength = 1 / Math.tan(fovRad / 2);

        this.fov = fov;
        this.aspect = orthoWidth / orthoHeight;
        this.zoom = orthoCamera.zoom;
        this.focus = orthoHeight * focalLength * this.zoom;

        // Set to orthographic mode
        this.projectionBlend = 0;

        this.updateProjectionMatrix();
        return this;
    }

    /**
     * Copy this camera's current orthographic-equivalent settings to an OrthographicCamera.
     * Uses the current focus and fov to calculate ortho frustum bounds.
     *
     * @param orthoCamera The orthographic camera to copy to
     */
    toOrthographicCamera(orthoCamera: OrthographicCamera): OrthographicCamera {
        // Copy transform
        orthoCamera.position.copy(this.position);
        orthoCamera.quaternion.copy(this.quaternion);
        orthoCamera.scale.copy(this.scale);

        // Copy clipping planes
        orthoCamera.near = this.near;
        orthoCamera.far = this.far;

        // Calculate ortho bounds from focus and fov
        const fovRad = this.fov * Math.PI / 180;
        const focalLength = (1 / Math.tan(fovRad / 2)) * this.zoom;
        const focusDistance = Math.max(0.0001, this.focus);
        const orthoHeight = focusDistance / focalLength;
        const orthoWidth = orthoHeight * this.aspect;

        orthoCamera.left = -orthoWidth;
        orthoCamera.right = orthoWidth;
        orthoCamera.top = orthoHeight;
        orthoCamera.bottom = -orthoHeight;
        orthoCamera.zoom = this.zoom;

        orthoCamera.updateProjectionMatrix();
        return orthoCamera;
    }

    /**
     * Create a new OrthographicCamera matching this camera's current orthographic-equivalent view.
     */
    createOrthographicCamera(): OrthographicCamera {
        const orthoCamera = new OrthographicCamera();
        return this.toOrthographicCamera(orthoCamera);
    }
}

/**
 * Universal raycaster setup using two-point unprojection.
 * Works correctly for ANY camera type (perspective, orthographic, or hybrid)
 * because it relies purely on the camera's projection matrix inverse.
 *
 * Use this instead of `raycaster.setFromCamera(coords, camera)`.
 *
 * **Difference from Three.js `Raycaster.setFromCamera`:**
 *
 * Three.js uses different ray origin conventions per camera type:
 * - Perspective: `ray.origin` = camera world position
 * - Orthographic: `ray.origin` = unprojected point on near/mid plane
 *
 * This function always sets `ray.origin` to the unprojected near plane point.
 * The ray *direction* is mathematically equivalent, but the different origin
 * affects `Raycaster.near`/`far` distance filtering (measured from origin).
 *
 * For scene intersection, results are identical. For distance-based filtering,
 * be aware that distances are measured from the near plane, not camera position.
 *
 * @param raycaster The raycaster to configure
 * @param coords NDC coordinates (-1 to 1)
 * @param camera Any Three.js camera
 */
export function setRaycasterFromCamera(raycaster: Raycaster, coords: Vector2, camera: Camera): void {
    // Unproject two points at different Z depths in NDC space
    // This works for ANY projection type because it's pure matrix math
    const near = new Vector3(coords.x, coords.y, -1).unproject(camera);
    const far = new Vector3(coords.x, coords.y, 1).unproject(camera);

    raycaster.ray.origin.copy(near);
    raycaster.ray.direction.copy(far).sub(near).normalize();
    raycaster.camera = camera;
}

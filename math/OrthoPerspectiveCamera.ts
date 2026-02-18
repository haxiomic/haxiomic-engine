import {
    type Camera,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    ShaderChunk,
    type Vector2,
    Vector3,
} from 'three';

export enum OrthoPerspectiveCameraMode {
    Orthographic = 0,
    Perspective = 1,
}

/**
 * A camera that smoothly interpolates between perspective and orthographic projection.
 *
 * Can be thought of as a PerspectiveCamera that can transition to orthographic projection
 *
 * .projectionBlend = 1.0 is pure perspective projection
 * .projectionBlend = 0.0 is pure orthographic projection,
 *
 * Set .focus to define the distance at which objects appear the same size in both modes.
 *
 * @example
 * ```typescript
 * const camera = new OrthoPerspectiveCamera(50, aspect, 0.1, 100);
 * camera.projectionBlend = 0.5; // Blend halfway between perspective and orthographic
 * camera.position.z = 5;
 * camera.focus = camera.position.z;
 * camera.updateProjectionMatrix(); // Call after changing properties
 * ```
 */
export class OrthoPerspectiveCamera extends PerspectiveCamera {
    readonly isOrthoProjectiveCamera = true;

    static Orthographic = 0;
    static Perspective = 1;

    // Private backing fields for reactive properties
    private _projectionBlend = OrthoPerspectiveCameraMode.Perspective;
    private _focus = 10;

    /**
     * Distance to the focus plane. Controls the size of the orthographic frustum
     * when projectionBlend < 1.0. Objects at this distance appear the same size
     * in both perspective and orthographic modes.
     *
     * Automatically updates the projection matrix when changed.
     *
     * Note: This is defined via Object.defineProperty in constructor to override
     * the inherited property from PerspectiveCamera with a reactive accessor.
     */
    declare focus: number;

    /**
     * Blend factor between projection types.
     * - 1.0 = pure perspective projection
     * - 0.0 = pure orthographic projection
     * - Values in between give a smooth blend
     *
     * Automatically updates the projection matrix when changed.
     */
    get projectionBlend(): number {
        return this._projectionBlend;
    }

    set projectionBlend(value: number) {
        if (this._projectionBlend !== value) {
            this._projectionBlend = value;
            // Only auto-update after construction is complete.
            // _constructing is undefined during super(), true after field init, false after constructor body.{
            this.updateProjectionMatrix();
        }
    }

    /**
     * When true, the near plane position is relative to the frustum convergence point
     * rather than the camera position. As projectionBlend approaches 0 (orthographic),
     * the convergence point moves toward infinity, and the near plane follows.
     *
     * This allows geometry behind the camera position to be rendered in orthographic
     * or near-orthographic modes.
     *
     * @default true
     */
    relativeNear = true;

    /**
     * When relativeNear is enabled, this limits how far behind the camera (in world units)
     * the near plane can move. Prevents the near plane from going to infinity as
     * projectionBlend approaches 0.
     *
     * If unset, -far is used as the limit.
     *
     * @default -this.far
     */
    relativeNearNegativeLimit: number | undefined = undefined;

    /**
     * Minimum clip-space W allowed at the near plane when relativeNear is enabled.
     * Prevents the near plane from approaching the w=0 singularity during the blend
     * (which can cause driver-dependent depth/clipping instability).
     *
     * 0 disables the stabilization (original behavior).
     *
     * Typical values: 1/1024 (~0.00098) to 1/256 (~0.0039)
     */
    relativeNearMinW = 1 / 512;

    constructor(
        fov?: number,
        aspect?: number,
        near?: number,
        far?: number,
        projectionBlend:
            | OrthoPerspectiveCameraMode
            | number = OrthoPerspectiveCameraMode.Perspective,
        focus = 10
    ) {
        super(fov, aspect, near, far);

        // Set values directly to backing fields to avoid triggering updateProjectionMatrix
        // during construction. The setters would skip anyway due to _constructing check,
        // but this is more explicit and avoids the comparison overhead.
        this._projectionBlend = projectionBlend;
        this._focus = focus;

        // Override isPerspectiveCamera and isOrthographicCamera with dynamic getters
        // These are checked by Three.js shaders and utilities to determine camera behavior
        // Runtime override - TypeScript still sees inherited types but actual values are dynamic
        Object.defineProperty(this, 'isPerspectiveCamera', {
            get: () => true,
            configurable: true,
        });
        Object.defineProperty(this, 'isOrthographicCamera', {
            get: () => false,
            configurable: true,
        });

        // Override focus property with getter/setter that auto-updates projection matrix.
        // This shadows the inherited property from PerspectiveCamera.
        // Using Object.defineProperty because TypeScript doesn't allow class accessor to override property.
        Object.defineProperty(this, 'focus', {
            get: (): number => this._focus,
            set: (value: number) => {
                if (this._focus !== value) {
                    this._focus = value;
                    this.updateProjectionMatrix();
                }
            },
            configurable: true,
            enumerable: true,
        });

        this.updateProjectionMatrix();
    }

    override updateProjectionMatrix(): void {
        // Read from backing fields for safety during construction when getters may not work
        const blend = this._projectionBlend;
        const focusVal = this._focus;

        // Safety: if values aren't valid numbers, use perspective fallback.
        // This handles the case during super() constructor when fields are undefined.
        if (
            blend == null ||
            focusVal == null ||
            !Number.isFinite(blend) ||
            !Number.isFinite(focusVal) ||
            blend >= 1.0
        ) {
            // Pure perspective or invalid/uninitialized state - use standard implementation
            super.updateProjectionMatrix();
            return;
        }

        // Clamp blend to valid range
        const s = Math.max(0, Math.min(1, blend));
        const f = Math.max(0.000001, focusVal);

        // Perceptually linear blend parameter
        const t = s / (f * (1 - s) + s);
        const oneMinusT = 1 - t;

        const fovRad = (this.fov * Math.PI) / 180;
        const focalLength = (1 / Math.tan(fovRad / 2)) * this.zoom;

        // Orthographic half-extents sized to match perspective view at focus distance
        const focusDistance = f; // Already clamped above
        const orthoHeight = focusDistance / focalLength;
        const orthoWidth = orthoHeight * this.aspect;

        // Calculate effective near/far planes
        let effectiveNear = this.near;

        if (this.relativeNear) {
            const zConvergence = t > 0 ? (1 - t) / t : Infinity;

            // --- Stabilized relativeNear ---
            // Original behavior effectively makes wNear = t * near (before negative-limit clamp),
            // which can become tiny mid-transition and cause GPU-dependent clipping/depth issues.
            // We ensure the near plane stays a minimum homogeneous distance away from the w=0 plane
            // by increasing the offset from the convergence plane when needed.
            const wMin = Math.max(0, this.relativeNearMinW ?? 0);
            const tSafe = Math.max(t, 1e-9);

            // Offset from convergence plane (world units). Original: offset = this.near.
            // Stabilized: offset grows as 1/t to keep wNear ≳ wMin.
            const offset = wMin > 0 ? Math.max(this.near, wMin / tSafe) : this.near;

            effectiveNear = offset - zConvergence;

            const minimumNegativeNear =
                this.relativeNearNegativeLimit != null && isFinite(this.relativeNearNegativeLimit)
                    ? -Math.abs(this.relativeNearNegativeLimit)
                    : -Math.abs(this.far);

            effectiveNear = Math.max(minimumNegativeNear, effectiveNear);
        }

        // Depth mapping coefficients
        const delta = this.far - effectiveNear;
        let A: number;
        let B: number;

        if (this.reversedDepth) {
            // Blended reversed depth: A and B linearly interpolate between
            // perspective and orthographic reversed formulas
            const blend = t * effectiveNear + oneMinusT;
            A = blend / delta;
            B = (this.far * blend) / delta;
        } else {
            // Blended standard depth
            A = -(t * (this.far + effectiveNear) + 2 * oneMinusT) / delta;
            B = -t * effectiveNear - 1 + t + effectiveNear * A;
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

        if ((source as OrthoPerspectiveCamera).isOrthoProjectiveCamera) {
            const orthoSource = source as OrthoPerspectiveCamera;
            // Set backing fields directly to batch updates - avoids multiple updateProjectionMatrix calls
            this._projectionBlend = orthoSource.projectionBlend;
            this._focus = orthoSource.focus;
            this.relativeNear = orthoSource.relativeNear;
            this.relativeNearNegativeLimit = orthoSource.relativeNearNegativeLimit;
            this.relativeNearMinW = orthoSource.relativeNearMinW;
            // Single update with all new values
            this.updateProjectionMatrix();
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
    setFromOrthographicCamera(orthoCamera: OrthographicCamera, fov = 50): this {
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
        const fovRad = (fov * Math.PI) / 180;
        const focalLength = 1 / Math.tan(fovRad / 2);

        this.fov = fov;
        this.aspect = orthoWidth / orthoHeight;
        this.zoom = orthoCamera.zoom;

        // Set backing fields directly to batch updates - avoids multiple updateProjectionMatrix calls
        this._focus = orthoHeight * focalLength * this.zoom;
        this._projectionBlend = OrthoPerspectiveCameraMode.Orthographic;

        // Single update with all new values
        this.updateProjectionMatrix();
        return this;
    }

    /**
     * Copy this camera's current orthographic-equivalent settings to an OrthographicCamera.
     * Uses the current focus and fov to calculate ortho frustum bounds.
     *
     * @param orthoCamera The orthographic camera to copy to
     */
    copyToOrthographicCamera(orthoCamera: OrthographicCamera): OrthographicCamera {
        // Copy transform
        orthoCamera.position.copy(this.position);
        orthoCamera.quaternion.copy(this.quaternion);
        orthoCamera.scale.copy(this.scale);

        // Copy clipping planes
        orthoCamera.near = this.near;
        orthoCamera.far = this.far;

        // Calculate ortho bounds from focus and fov
        const fovRad = (this.fov * Math.PI) / 180;
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
        return this.copyToOrthographicCamera(orthoCamera);
    }

    static {
        // auto-apply the patch when this module is loaded
        patchRaycasterSetFromCamera();
        patchSmoothViewDirectionForOrthoPerspectiveCamera();
    }
}

// Reusable vectors for raycaster setup (avoid allocations per call)
const _rayNear = new Vector3();
const _rayFar = new Vector3();

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
 * **Important:** For reversed depth buffers, NDC z ranges from 1 (near) to 0 (far),
 * not the standard -1 (near) to 1 (far). This function detects reversed depth
 * and uses the correct NDC z values for unprojection.
 *
 * @param raycaster The raycaster to configure
 * @param coords NDC coordinates (-1 to 1)
 * @param camera Any Three.js camera
 */
export function setRaycasterFromCamera(
    raycaster: Raycaster,
    coords: Vector2,
    camera: Camera
): void {
    // Determine NDC z values based on depth buffer configuration
    // Standard depth: z_ndc in [-1, 1] with -1 at near, 1 at far
    // Reversed depth: z_ndc in [0, 1] with 1 at near, 0 at far
    const isReversedDepth = (camera as { reversedDepth?: boolean }).reversedDepth === true;
    const zNear = isReversedDepth ? 1 : -1;
    const zFar = isReversedDepth ? 0 : 1;

    // Unproject two points at different Z depths in NDC space
    // This works for ANY projection type because it's pure matrix math
    _rayNear.set(coords.x, coords.y, zNear).unproject(camera);
    _rayFar.set(coords.x, coords.y, zFar).unproject(camera);

    raycaster.ray.origin.copy(_rayNear);
    raycaster.ray.direction.copy(_rayFar).sub(_rayNear).normalize();
    raycaster.camera = camera;
}

/**
 * Get the perspective factor from a camera's projection matrix.
 * Works for any camera type: perspective, orthographic, or blended (OrthoPerspectiveCamera).
 *
 * @returns 1.0 for pure perspective, 0.0 for pure orthographic, values in between for blended
 */
export function getPerspectiveFactor(camera: Camera): number {
    // projectionMatrix.elements[11] = -1 for perspective, 0 for orthographic,
    // -projectionBlend for OrthoPerspectiveCamera
    return Math.max(0, Math.min(1, -camera.projectionMatrix.elements[11]!));
}

/**
 * Patches Three.js Raycaster.prototype.setFromCamera to use two-point unprojection.
 *
 * Three.js's default implementation checks camera.isPerspectiveCamera and camera.isOrthographicCamera
 * to determine ray setup. This fails for OrthoPerspectiveCamera which reports isPerspectiveCamera=true
 * always (for CameraControls compatibility) but may be in orthographic projection mode.
 *
 * The two-point unprojection method works correctly for ANY camera type (perspective, orthographic,
 * or hybrid) because it relies purely on the camera's projection matrix inverse.
 *
 * **Important:** For reversed depth buffers, NDC z ranges from 1 (near) to 0 (far),
 * not the standard -1 (near) to 1 (far). This patch detects reversed depth and uses
 * the correct NDC z values for unprojection.
 *
 * This patch is applied automatically when this module is imported.
 */
export function patchRaycasterSetFromCamera(): void {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSetFromCamera = Raycaster.prototype.setFromCamera;

    // Only patch once
    if ((originalSetFromCamera as { __patched?: boolean }).__patched) return;

    Raycaster.prototype.setFromCamera = function (
        this: Raycaster,
        coords: Vector2,
        camera: Camera
    ) {
        if ((camera as OrthoPerspectiveCamera).isOrthoProjectiveCamera) {
            // Use universal two-point unprojection for hybrid cameras
            setRaycasterFromCamera(this, coords, camera);
        } else {
            // Use original implementation for standard cameras
            originalSetFromCamera.call(this, coords, camera);
        }
    };

    // Mark as patched
    (Raycaster.prototype.setFromCamera as { __patched?: boolean }).__patched = true;
}

/**
 * Patch Three.js shader chunks to use smooth view direction interpolation
 * instead of binary isOrthographic switch.
 *
 * Uses projectionMatrix[2][3] which equals -projectionBlend in our hybrid camera:
 * - perspectiveFactor = 1.0 for perspective (use per-fragment view direction)
 * - perspectiveFactor = 0.0 for orthographic (use constant forward direction)
 */
function patchSmoothViewDirectionForOrthoPerspectiveCamera() {
    const patchHeader = '// SMOOTH_VIEW_DIR //';
    if (ShaderChunk.common.includes(patchHeader)) {
        return; // already patched
    }

    // 1. Add varying declaration to common chunk (included in both vertex and fragment)
    ShaderChunk.common =
        ShaderChunk.common +
        /* glsl */ `
        ${patchHeader}
        varying float vPerspectiveFactor;
        #define PERSPECTIVE_FACTOR 1
    `;

    // 2. Patch project_vertex to compute and set the varying
    // projectionMatrix[2][3] = -1 for perspective, 0 for orthographic
    // Our hybrid camera sets it to -projectionBlend
    const projectVertexPatch = /* glsl */ `
        ${patchHeader}
        vPerspectiveFactor = clamp(-projectionMatrix[2][3], 0.0, 1.0);
    `;
    ShaderChunk.project_vertex = ShaderChunk.project_vertex + projectVertexPatch;

    // 3. Patch lights_fragment_begin to use smooth interpolation
    const originalLine = /* glsl */ `vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );`;
    const patchedLine = /* glsl */ `
        // Smooth view direction interpolation using vPerspectiveFactor from vertex shader
        // vPerspectiveFactor: 1.0 = perspective, 0.0 = orthographic
        vec3 geometryViewDir = normalize( mix( vec3( 0.0, 0.0, 1.0 ), vViewPosition, vPerspectiveFactor ) );
    `;

    if (ShaderChunk.lights_fragment_begin.includes(originalLine)) {
        ShaderChunk.lights_fragment_begin = ShaderChunk.lights_fragment_begin.replace(
            originalLine,
            patchedLine
        );
    } else {
        console.warn('Could not find expected line in lights_fragment_begin to patch');
    }
}

export function isOrthoPerspectiveCamera(camera: Camera): camera is OrthoPerspectiveCamera {
    return (camera as OrthoPerspectiveCamera).isOrthoProjectiveCamera === true;
}
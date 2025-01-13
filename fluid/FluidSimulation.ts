import { ClampToEdgeWrapping, HalfFloatType, LinearFilter, LinearMipMapLinearFilter, NearestFilter, NoColorSpace, RawShaderMaterial, RenderTargetOptions, RepeatWrapping, RGBAFormat, Texture, Uniform, Vector3, WebGLRenderer, WebGLRenderTarget } from "three";
import { Rendering } from "../rendering/Rendering";
import { DualRenderTarget } from "../rendering/DualRenderTarget";

type Int = number;

export type FluidSharedUniforms = {
    invResolution: Uniform<Vector3>,
    dx: Uniform<number>,
    rdx: Uniform<number>,
    halfRdx: Uniform<number>,
    dxAlpha: Uniform<number>,
    dt: Uniform<number>,
    velocityBoundaryEnabled: Uniform<boolean>,
    velocity: Uniform<Texture>,
    pressure: Uniform<Texture>,
    divergence: Uniform<Texture>,
    color: Uniform<Texture>,
}

export class FluidSimulation {

    readonly sharedUniforms: FluidSharedUniforms;
    iterations = 25;

    // textures
    readonly colorTexture: DualRenderTarget;
    readonly velocityTexture: DualRenderTarget;
    readonly pressureTexture: DualRenderTarget;
    divergenceTexture: WebGLRenderTarget;

    width: Int;
    height: Int;
    private _periodicBoundary: boolean = false;
    get periodicBoundary(): boolean {
        return this._periodicBoundary;
    }
    set periodicBoundary(v: boolean) {
        this.sharedUniforms.velocityBoundaryEnabled.value = !v;
        this.textureOptions.wrapT = v ? RepeatWrapping : ClampToEdgeWrapping;
        this.textureOptions.wrapS = v ? RepeatWrapping : ClampToEdgeWrapping;
        this.colorTexture.setOptions(this.textureOptions);
        this.velocityTexture.setOptions(this.textureOptions);
        this.pressureTexture.setOptions(this.textureOptions);
        this.divergenceTexture.dispose();
        this.divergenceTexture = new WebGLRenderTarget(this.simulationWidth, this.simulationHeight, this.textureOptionsNearest);
        this.sharedUniforms.divergence.value = this.divergenceTexture.texture;
    }
    simulationTextureScale: number;
    simulationWidth: Int;
    simulationHeight: Int;

    // shaders
    readonly advectShader: Advect;
    readonly divergenceShader: Divergence;
    readonly pressureSolveShader: PressureSolve;
    readonly pressureGradientSubtractShader: PressureGradientSubtract;

    readonly textureOptions: RenderTargetOptions;
    readonly textureOptionsNearest: RenderTargetOptions;

    timeScale = 1.0;

    set physicsScale(v: number) {
        this.sharedUniforms.dx.value = v;
        this.sharedUniforms.rdx.value = 1.0 / v;
        this.sharedUniforms.halfRdx.value = 0.5 / v;
        this.sharedUniforms.dxAlpha.value = -v * v;
    }

    get physicsScale(): number {
        return this.sharedUniforms.dx.value;
    }

    constructor(
        private renderer: WebGLRenderer,
        width: Int,
        height: Int,
        periodicBoundary: boolean,
        physicsScale: number,
        simulationTextureScale = 0.25,
        generateMipmaps = false
    ) {
        this.width = width;
        this.height = height;
        this.simulationTextureScale = simulationTextureScale;
        this._periodicBoundary = periodicBoundary;

        this.simulationWidth = int32(width * simulationTextureScale);
        this.simulationHeight = int32(height * simulationTextureScale);

        this.textureOptions = {
            colorSpace: NoColorSpace,
            generateMipmaps: false,
            stencilBuffer: false,
            depthBuffer: false,
            anisotropy: 0,
            type: HalfFloatType,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            format: RGBAFormat,
            wrapT: periodicBoundary ? RepeatWrapping : ClampToEdgeWrapping,
            wrapS: periodicBoundary ? RepeatWrapping : ClampToEdgeWrapping,
        }

        this.textureOptionsNearest = {
            ...this.textureOptions,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
        };

        // use gamma decode when displaying the color texture (advection is still handled in linear-space)
        this.colorTexture = new DualRenderTarget(renderer, width, height, generateMipmaps ? {
            ...this.textureOptions,
            magFilter: LinearFilter,
            minFilter: LinearMipMapLinearFilter,
            generateMipmaps: true,
        } : this.textureOptions);
        this.velocityTexture = new DualRenderTarget(renderer, this.simulationWidth, this.simulationHeight, this.textureOptions);
        this.pressureTexture = new DualRenderTarget(renderer, this.simulationWidth, this.simulationHeight, this.textureOptionsNearest);
        this.divergenceTexture = new WebGLRenderTarget(this.simulationWidth, this.simulationHeight, this.textureOptionsNearest);

        this.sharedUniforms = {
            invResolution: new Uniform(new Vector3(1,1,1)), // set during step
            dt: new Uniform(0.), // set during step

            dx: new Uniform(physicsScale),
            rdx: new Uniform(1.0 / physicsScale),
            halfRdx: new Uniform(0.5 / physicsScale),
            dxAlpha: new Uniform(-physicsScale * physicsScale),
            velocityBoundaryEnabled: new Uniform(!periodicBoundary),
            velocity: this.velocityTexture.uniform,
            pressure: this.pressureTexture.uniform,
            divergence: new Uniform(this.divergenceTexture.texture),
            color: this.colorTexture.uniform,
        }

        this.advectShader = new Advect(this.sharedUniforms);
        this.divergenceShader = new Divergence(this.sharedUniforms);
        this.pressureSolveShader = new PressureSolve(this.sharedUniforms);
        this.pressureGradientSubtractShader = new PressureGradientSubtract(this.sharedUniforms);
    }

    public step(
        t_s: number,
        dt_s: number,
        applyForces: (velocityTarget: WebGLRenderTarget) => void,
        applyColor: (colorTarget: WebGLRenderTarget) => void
    ): void {
        Rendering.saveGlobalState(this.renderer);

        // resize simulation textures if required
        if (this.simulationWidth !== int32(this.width * this.simulationTextureScale)) {
            this.resize(this.width, this.height);
        } 

        this.sharedUniforms.dt.value = dt_s * this.timeScale;
        // simulation domain
        const simulationWidth = this.velocityTexture.width;
        const simulationHeight = this.velocityTexture.height;
        this.sharedUniforms.invResolution.value.set(1/simulationWidth, 1/simulationHeight, simulationHeight/simulationWidth);

        // advect velocity
        this.advectShader.uniforms.target.value = this.velocityTexture.getTexture();
        Rendering.shaderPass(this.renderer, {
            target: this.velocityTexture.getRenderTarget(),
            shader: this.advectShader,
            restoreGlobalState: false,
        })
        this.velocityTexture.swap();

        // apply user forces
        // write user-input to velocity texture
        applyForces(this.velocityTexture.getRenderTarget());
        this.velocityTexture.swap();

        // compute velocity field divergence
        Rendering.shaderPass(this.renderer, {
            target: this.divergenceTexture,
            shader: this.divergenceShader,
            restoreGlobalState: false,
        });

        // solve pressure
        for (let i = 0; i < this.iterations; i++) {
            Rendering.shaderPass(this.renderer, {
                target: this.pressureTexture.getRenderTarget(),
                shader: this.pressureSolveShader,
                restoreGlobalState: false,
            });
            this.pressureTexture.swap();
        }

        // subtract pressure gradient from velocity
        Rendering.shaderPass(this.renderer, {
            target: this.velocityTexture.getRenderTarget(),
            shader: this.pressureGradientSubtractShader,
            restoreGlobalState: false,
        });
        this.velocityTexture.swap();
        
        // color domain
        const colorWidth = this.colorTexture.width;
        const colorHeight = this.colorTexture.height;
        this.sharedUniforms.invResolution.value.set(1/colorWidth, 1/colorHeight, colorHeight/colorWidth);
        // apply user color
        applyColor(this.colorTexture.getRenderTarget());
        this.colorTexture.swap();

        // advect color
        this.advectShader.uniforms.target.value = this.colorTexture.getTexture();
        Rendering.shaderPass(this.renderer, {
            target: this.colorTexture.getRenderTarget(),
            shader: this.advectShader,
            restoreGlobalState: false,
        });
        this.colorTexture.swap();

        Rendering.restoreGlobalState(this.renderer);
    }

    public resize(newWidth: Int, newHeight: Int): void {
        this.width = newWidth;
        this.height = newHeight;
        this.simulationWidth = int32(newWidth * this.simulationTextureScale);
        this.simulationHeight = int32(newHeight * this.simulationTextureScale);

        this.colorTexture.resize(this.width, this.height);
        this.velocityTexture.resize(this.simulationWidth, this.simulationHeight);
        this.pressureTexture.resize(this.simulationWidth, this.simulationHeight);

        this.divergenceTexture.dispose();
        this.divergenceTexture = new WebGLRenderTarget(this.simulationWidth, this.simulationHeight, this.textureOptionsNearest);
        this.sharedUniforms.divergence.value = this.divergenceTexture.texture;
    }

    public clipSpaceToSimulationSpaceX(x: number): number {
        const aspect = this.simulationWidth / this.simulationHeight;
        return x * aspect;
    }

    public clipSpaceToSimulationSpaceY(y: number): number {
        return y;
    }

    static readonly precision = 'highp';

    static getVertexShader(uv: boolean, finiteDifferences: boolean, simulationPosition: boolean): string {
        return `
            precision ${FluidSimulation.precision} float;
            ${uv ? '#define UV' : ''}
            ${finiteDifferences ? '#define FINITE_DIFFERENCE' : ''}
            ${simulationPosition ? '#define SIMULATION_POSITION' : ''}

            ${FluidSimulation.vertexShader}
        `;
    }

    static sharedShader = /* glsl */`
vec2 clipToSimSpace(vec2 clipSpace){
    return vec2(clipSpace.x / invResolution.z, clipSpace.y);
}

vec2 simToTexelSpace(vec2 simSpace){
    return vec2(simSpace.x * invResolution.z + 1.0 , simSpace.y + 1.0)*.5;
}

// pure Neumann boundary conditions: 0 pressure gradient across the boundary
// dP/dx = 0
// this is implict applied with CLAMP_TO_EDGE when reading from the pressure texture so we don't actually need to to anything in the shader
// #define PRESSURE_BOUNDARY

// free-slip boundary: the average flow across the boundary is restricted to 0
// avg(uA.xy, uB.xy) dot (boundary normal).xy = 0
// this is applied by reflecting the velocity across the boundary (i.e, multipling the boundary velocity by -1 when reading outside)

// must not make any changes to coord after it arrives from vertex shader (including no swizzle) to enable inter-stage texture prefetching
#define samplePressure(texture, coord) ( texture2D(pressure, coord).x )
#define outOfBoundsVelocityMultiplier(coord) (velocityBoundaryEnabled ? (step(vec2(0.), coord) * step(coord, vec2(1.)) * 2. - 1. ) : vec2(1.0))

#define sampleVelocity(texture, coord) ( outOfBoundsVelocityMultiplier(coord) * texture2D(velocity, coord).xy )
`;

    static vertexShader = /* glsl */`
// clip-space
attribute vec2 position;

uniform vec3 invResolution; // (1/w, 1/h, h/w)

#ifdef UV
varying vec2 vUv;
#endif

#ifdef FINITE_DIFFERENCE
// precomute texel offsets as varyings to enable texture prefetching
varying vec2 vL;
varying vec2 vR;
varying vec2 vB;
varying vec2 vT;
#endif

#ifdef SIMULATION_POSITION
// clip-space where aspect ratio is maintained and height is fixed at 1
varying vec2 p;
#endif

void main() {
    vec2 texelCoord = position * 0.5 + 0.5;

    #ifdef FINITE_DIFFERENCE
    vL = texelCoord - vec2(invResolution.x,0);
    vR = texelCoord + vec2(invResolution.x,0);
    vB = texelCoord - vec2(0,invResolution.y);
    vT = texelCoord + vec2(0,invResolution.y);
    #endif

    #ifdef UV
    vUv = texelCoord;
    #endif

    #ifdef SIMULATION_POSITION
    p = vec2(position.x / invResolution.z, position.y);
    #endif

    gl_Position = vec4(position, 0.0, 1.0 );
}`;

}

class Advect extends RawShaderMaterial {

    public readonly target: Uniform<Texture | null>;

    constructor(sharedUniforms: FluidSharedUniforms) {
        const target = new Uniform<Texture | null>(null);
        super({
            uniforms: {
                ...sharedUniforms,
                target: target,
            },
            vertexShader: FluidSimulation.getVertexShader(true, false, true),
            fragmentShader: /*glsl*/`
                precision ${FluidSimulation.precision} float;

                uniform vec3 invResolution;
                uniform bool velocityBoundaryEnabled;
                uniform float rdx;
                uniform float dt;

                uniform sampler2D velocity;
                uniform sampler2D target;

                varying vec2 vUv;
                varying vec2 p;

                ${FluidSimulation.sharedShader}

                void main(void){
                    vec2 tracedPos = p - dt * rdx * texture2D(velocity, vUv).xy;

                    gl_FragColor = texture2D(target, simToTexelSpace(tracedPos));
                }
            `,
        });
        this.target = target;
    }
}

class Divergence extends RawShaderMaterial {
    constructor(sharedUniforms: FluidSharedUniforms) {
        super({
            uniforms: sharedUniforms,
            vertexShader: FluidSimulation.getVertexShader(false, true, false),
            fragmentShader: /*glsl*/`
                precision ${FluidSimulation.precision} float;

                uniform vec3 invResolution;
                uniform bool velocityBoundaryEnabled;
                uniform sampler2D velocity;
                uniform float halfRdx;

                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vB;
                varying vec2 vT;
            
                ${FluidSimulation.sharedShader}

                void main(void){
                    // compute the divergence according to the finite difference formula
                    vec2 L = sampleVelocity(velocity, vL);
                    vec2 R = sampleVelocity(velocity, vR);
                    vec2 B = sampleVelocity(velocity, vB);
                    vec2 T = sampleVelocity(velocity, vT);

                    gl_FragColor = vec4( halfRdx * ((R.x - L.x) + (T.y - B.y)), 0., 0., 1.);
                }
            `,
        });
    }
}

class PressureSolve extends RawShaderMaterial {
    constructor(sharedUniforms: FluidSharedUniforms) {
        super({
            uniforms: sharedUniforms,
            vertexShader: FluidSimulation.getVertexShader(true, true, false),
            fragmentShader: /*glsl*/`
                precision ${FluidSimulation.precision} float;

                uniform vec3 invResolution;
                uniform bool velocityBoundaryEnabled;

                uniform sampler2D pressure;
                uniform sampler2D divergence;
                uniform float dxAlpha; // alpha = -(dx)^2, where dx = grid cell size

                varying vec2 vUv;

                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vB;
                varying vec2 vT;

                ${FluidSimulation.sharedShader}

                void main(void){
                    // left, right, bottom, and top x samples
                    // texelSize = 1./resolution;
                    float L = samplePressure(pressure, vL);
                    float R = samplePressure(pressure, vR);
                    float B = samplePressure(pressure, vB);
                    float T = samplePressure(pressure, vT);

                    float bC = texture2D(divergence, vUv).x;

                    gl_FragColor = vec4( (L + R + B + T + dxAlpha * bC) * .25, 0, 0, 1 ); // rBeta = .25
                }
            `,
        });
    }
}

class PressureGradientSubtract extends RawShaderMaterial {
    constructor(sharedUniforms: FluidSharedUniforms) {
        super({
            uniforms: sharedUniforms,
            vertexShader: FluidSimulation.getVertexShader(true, true, false),
            fragmentShader: /*glsl*/`
                precision ${FluidSimulation.precision} float;

                uniform vec3 invResolution;
                uniform bool velocityBoundaryEnabled;

                uniform sampler2D pressure;
                uniform sampler2D velocity;
                uniform float halfRdx;

                varying vec2 vUv;

                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vB;
                varying vec2 vT;

                ${FluidSimulation.sharedShader}

                void main(void){
                    float L = samplePressure(pressure, vL);
                    float R = samplePressure(pressure, vR);
                    float B = samplePressure(pressure, vB);
                    float T = samplePressure(pressure, vT);

                    vec2 v = texture2D(velocity, vUv).xy;

                    gl_FragColor = vec4(v - halfRdx*vec2(R-L, T-B), 0, 1);
                }
            `,
        });
    }
}

function int32(value: number): Int {
    return value | 0;
}
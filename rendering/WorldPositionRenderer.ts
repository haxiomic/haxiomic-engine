import {
    Camera,
    DoubleSide,
    HalfFloatType,
    LinearFilter,
    MeshBasicMaterial,
    NoBlending,
    Object3D,
    RGBAFormat,
    Scene,
    ShaderMaterial,
    Side,
    TextureDataType,
    WebGLRenderTarget,
    WebGLRenderer
} from 'three';
import { Layer as RenderLayer } from '../Layer.js';

/**
    **Uses the `WorldPosition` layer**
    Make sure to enable `WorldPosition` on objects that should be rendered
**/
export class WorldPositionRenderer {

    width: number;
    height: number;
    
    readonly renderTarget: WebGLRenderTarget;
    readonly renderer: WebGLRenderer;
    readonly scene: Scene;
    readonly shaderMaterial: ShaderMaterial;
    readonly renderLayer: RenderLayer;
    readonly depthPrepassLayer: RenderLayer;
    readonly depthPrepassMaterial = new MeshBasicMaterial({color: 0x00FFFF, fog: false, side: DoubleSide});
    
    object: Object3D | null = null;
    depthPrepass: boolean = false;

    private replacementParent: Object3D;

    constructor(
        renderer: WebGLRenderer,
        width: number,
        height: number,
        renderLayer: RenderLayer = RenderLayer.WorldPosition,
        depthPrepassLayer: RenderLayer = RenderLayer.DepthPrepass,
        side: Side = DoubleSide,
        type: TextureDataType = HalfFloatType
    ) {
        this.renderer = renderer;
        this.width = width;
        this.height = height;
        this.renderLayer = renderLayer;
        this.depthPrepassLayer = depthPrepassLayer;

        this.renderTarget = new WebGLRenderTarget(width, height, {
            magFilter: LinearFilter,
            minFilter: LinearFilter,
            depthBuffer: true,
            generateMipmaps: false,
            stencilBuffer: false,
            anisotropy: 0,
            type: type,
            format: RGBAFormat,
        });

        this.scene = new Scene();
        this.replacementParent = new Object3D();
        this.scene.add(this.replacementParent);
        this.shaderMaterial = new ShaderMaterial({
            uniforms: {},
            vertexShader: /*glsl*/`
                varying vec3 vWorldPosition;

                void main() {
                    vec4 p = vec4( position, 1.0 );
                    vec4 worldP = modelMatrix * p;
                    vWorldPosition = worldP.xyz;

                    gl_Position = projectionMatrix * viewMatrix * worldP;
                }
            `,
            fragmentShader: /*glsl*/`
                varying vec3 vWorldPosition;
                
                void main() {
                    gl_FragColor = vec4(vWorldPosition, 1.0);
                }
            `,
            blending: NoBlending,
            side: side,
        });

        this.scene.overrideMaterial = this.shaderMaterial;
    }

    setSize(width: number, height: number) {
        this.renderTarget.setSize(width, height);
        this.width = width;
        this.height = height;
    }

    setObject(object: Object3D, depthPrepass: boolean) {
        this.object = object;
        this.depthPrepass = depthPrepass;
        // check layer mask and warn if not set
        if ((object.layers.mask & (1 << this.renderLayer)) === 0) {
            console.warn('WorldPositionRenderer: object does not have the correct layer mask set'); 
        }
        if (depthPrepass && (object.layers.mask & (1 << this.depthPrepassLayer)) === 0) {
            console.warn('WorldPositionRenderer: object does not have the correct depth prepass layer mask set');
        }
    }

    render(camera: Camera) {
        const { renderer, scene, renderTarget, object, depthPrepass, renderLayer, depthPrepassLayer } = this;
        renderer.setRenderTarget(renderTarget);
        var clearAlphaBefore = renderer.getClearAlpha();
        renderer.setClearAlpha(0);

        renderer.clear(true, true, false);

        if (object != null) {
            var parent = object.parent;
            
            parent?.updateWorldMatrix(true, false);

            let replacementParent = this.replacementParent;
            replacementParent.matrixAutoUpdate = false;
            if (parent?.matrixWorld) {
                replacementParent.matrix.copy(parent.matrixWorld);
            }

            replacementParent.add(object);

            var maskBefore = camera.layers.mask;

            // render depth prepass
            if (depthPrepass) {
                camera.layers.set(depthPrepassLayer);
                var gl = renderer.getContext();
                gl.colorMask(false, false, false, false);
                renderer.render(scene, camera);
                gl.colorMask(true, true, true, true);
            }

            camera.layers.set(renderLayer);
            renderer.render(scene, camera);
            camera.layers.mask = maskBefore;

            replacementParent.remove(object);
            if (parent != null) {
                parent.add(object);
            }
        }

        renderer.setClearAlpha(clearAlphaBefore);
    }

}
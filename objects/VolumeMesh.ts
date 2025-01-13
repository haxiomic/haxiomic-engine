/**
 * Template for volume rendering in a mesh
 */

import { CustomBlending, FrontSide, IUniform, Matrix4, NormalBlending, OneFactor, ShaderLib, ShaderMaterialParameters, Uniform, Vector3, Vector4 } from "three";
import { ShaderMaterial } from "../materials/ShaderMaterial";

type VolumeMeshMaterialUniforms = {
    cameraToModelMatrix: Uniform<Matrix4>,
    near: Uniform<Number>,
}

export class VolumeMeshMaterial<T extends Record<string, IUniform>> extends ShaderMaterial<VolumeMeshMaterialUniforms & T> {

    constructor(shaders: {
        /**
         * GLSL that defines function with signature `vec4 renderVolume(vec3 ro, vec3 rd);`
         */
        renderVolumeFunction: string,
        /**
         * Optional GLSL code to include in the vertex shader above main
         */
        vertexHead?: string,
        /**
         * Optional GLSL code to include in the vertex shader main function, after gl_Position is set
         */
        vertexMain?: string,
        /**
         * Optional GLSL code to include in the fragment shader above main
         */
        fragmentHead?: string,
        /**
         * Optional GLSL code to include in the fragment shader main function, after gl_FragColor is set
         */
        fragmentMain?: string,
    }, parameters?: ShaderMaterialParameters & {
        uniforms: T,
    }) {
        super({
            uniforms: {
                ...ShaderLib.physical.uniforms,
                cameraToModelMatrix: new Uniform(new Matrix4()),
                near: new Uniform(0.),
                ...parameters?.uniforms,
            } as any,
            vertexShader: /*glsl*/`
                uniform mat4 cameraToModelMatrix;
                uniform float near;

                #include <logdepthbuf_pars_vertex>
                bool isPerspectiveMatrix( mat4 m ) {
                    return m[2][3] == -1.0;
                }

                // fragment shader version
                varying vec3 vPosition_cameraSpace;

                ${shaders.vertexHead ?? ''}

                void main() {
                    vec4 mvPosition = vec4(position, 1.0); // aka camera-space / eye-space
                    mvPosition = modelViewMatrix * mvPosition;

                    // prevent object from passing through near plane
                    // mvPosition.z = min(mvPosition.z, near * 1.01);

                    gl_Position = projectionMatrix * mvPosition;

                    ${shaders.vertexMain ?? ''}

                    // fragment shader version
                    vPosition_cameraSpace = mvPosition.xyz;

                    #ifdef USE_LOGDEPTHBUF
                      vFragDepth = 1.0 + gl_Position.w;
                      vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
                    #endif
                }
            `,
            fragmentShader: /*glsl*/`
                #include <common>
                #include <dithering_pars_fragment>
                #include <logdepthbuf_pars_fragment>

                // fragment shader version
                uniform mat4 cameraToModelMatrix;
                varying vec3 vPosition_cameraSpace;

                vec4 renderVolume(vec3 ro, vec3 rd);

                ${shaders.fragmentHead ?? ''}

                ${shaders.renderVolumeFunction}

                void main() {
                    // camera position, object space, where 1.0 = on surface of sphere
                    vec3 cameraPos_objectSpace = cameraToModelMatrix[3].xyz;
                    // ray direction
                    vec3 cameraRay_objectSpace = normalize(mat3(cameraToModelMatrix) * vPosition_cameraSpace.xyz);

                    gl_FragColor = renderVolume(cameraPos_objectSpace, cameraRay_objectSpace);

                    ${shaders.fragmentMain ?? ''}

                    #include <tonemapping_fragment>
                    #include <premultiplied_alpha_fragment>
                    #include <dithering_fragment>
                    #include <logdepthbuf_fragment>
                }
            `,
            forceSinglePass: true,
            wireframe: false,
            fog: false,

            transparent: true,
            depthWrite: false,
            depthTest: false,

            // premultiplied alpha blending
            blending: NormalBlending,
            premultipliedAlpha: true,
            side: FrontSide,

            ...parameters,
        });

        let _inverseModel = new Matrix4();
        let nearCenter_clip = new Vector4(0, 0, -1, 1);
        this.onBeforeRender = (renderer, scene, camera, geom, object, group) => {
            // find extent of camera near plane in eye space
            nearCenter_clip.set(0, 0, -1, 1);
            // we do this by transforming the near plane corners into camera space
            nearCenter_clip.applyMatrix4(camera.projectionMatrixInverse);
            // perspective divide
            nearCenter_clip.divideScalar(nearCenter_clip.w);
            this.uniforms.near.value = nearCenter_clip.z;



            // coordinate transformation uniforms
            // we can assume matrixWorld is updated
            // position_cameraSpace = inverse(modelMatrix) * cameraMatrix * position_cameraSpace
            _inverseModel.copy(object.matrixWorld).invert();
            this.uniforms.cameraToModelMatrix.value.copy(_inverseModel).multiply(camera.matrixWorld);

            // handle transition to screen-space quad when inside volume
            // _cameraPos_objectSpace.setFromMatrixPosition(this.uniforms.cameraToModelMatrix.value);
            // let cameraInside = _cameraPos_objectSpace.length() < 1.1;
        }

    }

}
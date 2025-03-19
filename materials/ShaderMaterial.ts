/**
 * Improves typing of ShaderMaterial by adding a generic type parameter for uniforms.
 */

import { IUniform, ShaderMaterial as ShaderMaterialBase, ShaderMaterialParameters } from "three";

type UniformsRecord = Record<string, IUniform<any>>;
type DefinesRecord = Record<string, string>;

export class ShaderMaterial<
  U extends UniformsRecord = any,
  D extends DefinesRecord = any,
> extends ShaderMaterialBase {
  
  declare uniforms: U;
  declare defines: D;

  constructor(parameters: Omit<ShaderMaterialParameters, 'uniforms' | 'defines'> & {
    uniforms: U,
    defines?: D,
  }) {
    super(parameters);
  }
}
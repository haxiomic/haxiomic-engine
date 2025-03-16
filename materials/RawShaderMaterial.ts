/**
 * Improves typing of ShaderMaterial by adding a generic type parameter for uniforms.
 */

import { IUniform, RawShaderMaterial as RawShaderMaterialBase, ShaderMaterialParameters } from "three";

type UniformsRecord = Record<string, IUniform<any>>;

export class RawShaderMaterial<T extends UniformsRecord = any> extends RawShaderMaterialBase {
  declare uniforms: T;

  constructor(parameters: Omit<ShaderMaterialParameters, 'uniforms'> & { uniforms: T }) {
    super(parameters);
  }
}
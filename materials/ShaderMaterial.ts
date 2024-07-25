/**
 * Improves typing of ShaderMaterial by adding a generic type parameter for uniforms.
 */

import { IUniform, ShaderMaterial as ShaderMaterialBase, ShaderMaterialParameters } from "three";

type UniformsRecord = Record<string, IUniform<any>>;

export class ShaderMaterial<T extends UniformsRecord = any> extends ShaderMaterialBase {
  declare uniforms: T;

  constructor(parameters: Omit<ShaderMaterialParameters, 'uniforms'> & { uniforms: T }) {
    super(parameters);
    this.uniforms = parameters.uniforms;
  }
}
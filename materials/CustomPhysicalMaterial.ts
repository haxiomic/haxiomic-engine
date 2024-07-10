/**
 * PhysicalMaterial implemented with ShaderMaterial to enable customization
 * 
 * Ported from https://github.com/haxiomic/three-toolkit/blob/master/material/CustomPhysicalMaterial.hx
 */
import { Color, IUniform, MeshPhysicalMaterialParameters, NormalMapTypes, ShaderLib, ShaderMaterial, ShaderMaterialParameters, TangentSpaceNormalMap, Texture, Uniform, Vector2 } from "three";

export type CustomPhysicalMaterialParameters<UserUniforms extends { [uniform: string]: IUniform } | undefined = {}> = ShaderMaterialParameters & MeshPhysicalMaterialParameters & {
	transparency?: number, // missing from type definitions
	defaultAttributeValues?: { [name: string]: Array<number> }, // missing from type definitions
	uniforms?: UserUniforms;
}

export class CustomPhysicalMaterial<UserUniforms extends { [uniform: string]: IUniform } = {}> extends ShaderMaterial {

	public flatShading: boolean;

	public uniforms: UserUniforms;

	public color: Color;
	public roughness: number;
	public metalness: number;

	public map: Texture | null | undefined;

	public lightMap: Texture | null | undefined;
	public lightMapIntensity: number;

	public aoMap: Texture | null | undefined ;
	public aoMapIntensity: number;

	public emissive: Color;
	public emissiveIntensity: number;
	public emissiveMap: Texture | null | undefined;

	public bumpMap: Texture | null | undefined;
	public bumpScale: number;

	public normalMap: Texture | null | undefined;
	public normalMapType: NormalMapTypes;
	public normalScale: Vector2;

	public displacementMap: Texture | null | undefined;
	public displacementScale: number;
	public displacementBias: number;

	public roughnessMap: Texture | null | undefined;

	public metalnessMap: Texture | null | undefined;

	public alphaMap: Texture | null | undefined;

	public envMap: Texture | null | undefined;
	public envMapIntensity: number;

	public refractionRatio: number;

	public wireframeLinecap: String;
	public wireframeLinejoin: String;

	public readonly isMeshStandardMaterial: boolean;

	// MeshPhysicalMaterial
	protected _clearcoat: number = 0;
	public get clearcoat() {
		return this._clearcoat;
	}
	public set clearcoat(v: number) {
		if ((this._clearcoat > 0) != (v > 0)) this.version++;
		this._clearcoat = v;
	}

	public clearcoatMap: Texture | null | undefined;
	public clearcoatRoughness: number;
	public clearcoatRoughnessMap: Texture | null | undefined;
	public clearcoatNormalScale: Vector2;
	public clearcoatNormalMap: Texture | null | undefined;

	public get reflectivity() {
		return clamp(2.5 * ( this.ior - 1 ) / ( this.ior + 1 ), 0, 1);
	}
	public set reflectivity(v: number) {
		this.ior = ( 1 + 0.4 * v ) / ( 1 - 0.4 * v );
	}

	protected _sheen: number = 0;
	public get sheen() {
		return this._sheen;
	}
	public set sheen(v: number) {
		if ((this._sheen > 0) != (v > 0)) this.version++;
		this._sheen = v;
	}

	public sheenColor: Color;
	public sheenColorMap: Texture | null | undefined;

	public sheenRoughness: number;
	public sheenRoughnessMap: Texture | null | undefined;

	public transparency: number;

	protected _transmission: number = 0;
	public get transmission() {
		return this._transmission;
	}
	public set transmission(v: number) {
		if ((this._transmission > 0) != (v > 0)) this.version++;
		this._transmission = v;
	}

	public ior: number;

	protected _iridescence: number = 0;
	public get iridescence() {
		return this._iridescence;
	}
	public set iridescence( value ) {
		if ( this._iridescence > 0 !== value > 0 ) {
			this.version ++;
		}
		this._iridescence = value;
	}

	public iridescenceMap: Texture | null | undefined;
	public iridescenceIOR: number;
	public iridescenceThicknessRange: [number, number];
	public iridescenceThicknessMap: Texture | null | undefined;

	public transmissionMap: Texture | null | undefined;
	public thickness: number;
	public thicknessMap: Texture | null | undefined;
	public attenuationDistance: number;

	public attenuationColor: Color;

	public specularIntensity : number;
	public specularColor : Color;
	public specularIntensityMap : Texture | null | undefined;
	public specularColorMap : Texture | null | undefined;

	// public readonly isMaterial: boolean;
	public readonly isMeshPhysicalMaterial: boolean;
	public readonly isInitialized: boolean;

	constructor(
		parameters?: CustomPhysicalMaterialParameters<UserUniforms>
	) {
		let shaderMaterialParameters = {
			vertexShader: ShaderLib.physical.vertexShader,
			fragmentShader: ShaderLib.physical.fragmentShader,
			fog: true,

			...parameters,

			defines: {
				'STANDARD': '',
				'PHYSICAL': '',
				...parameters?.defines,
			},
			uniforms: {
				...ShaderLib.physical.uniforms,
				...parameters?.uniforms,
			},
		}
		super(shaderMaterialParameters);

		// keep typescript happy
		this.uniforms = shaderMaterialParameters.uniforms as UserUniforms;

		this.flatShading = false;
		this.color = new Color( 0xffffff ); // diffuse
		this.roughness = 1.0;
		this.metalness = 0.0;
		this.map = null;
		this.lightMap = null;
		this.lightMapIntensity = 1.0;
		this.aoMap = null;
		this.aoMapIntensity = 1.0;
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1.0;
		this.emissiveMap = null;
		this.bumpMap = null;
		this.bumpScale = 1;
		this.normalMap = null;
		this.normalMapType = TangentSpaceNormalMap;
		this.normalScale = new Vector2( 1, 1 );
		this.displacementMap = null;
		this.displacementScale = 1;
		this.displacementBias = 0;
		this.roughnessMap = null;
		this.metalnessMap = null;
		this.alphaMap = null;
		this.envMap = null;
		this.envMapIntensity = 1.0;
		this.refractionRatio = 0.98;
		this.wireframeLinecap = 'round';
		this.wireframeLinejoin = 'round';
		this.isMeshStandardMaterial = true;
		this.clearcoat = 0.0;
		this.clearcoatMap = null;
		this.clearcoatRoughness = 0.0;
		this.clearcoatRoughnessMap = null;
		this.clearcoatNormalScale = new Vector2( 1, 1 );
		this.clearcoatNormalMap = null;
		// this.reflectivity = 0.5; // maps to F0 = 0.04
		this.sheen = 0.0; // null will disable sheen bsdf
		this.sheenColor = new Color(0x0);
		this.sheenColorMap = null;
		this.sheenRoughness = 1.0;
		this.sheenRoughnessMap = null;
		this.transparency = 0.0;
		this.transmission = 0.;
		this.ior = 1.5;

		this.iridescence = 0.0;
		this.iridescenceIOR = 1.3;
		this.iridescenceMap = null;
		this.iridescenceThicknessRange = [ 100, 400 ];
		this.iridescenceThicknessMap = null;

		this.transmissionMap = null;

		this.thickness = 0.01;
		this.thicknessMap = null;
		this.attenuationDistance = 0.0;
		this.attenuationColor = new Color( 1, 1, 1 );

		this.specularIntensity = 1.0;
		this.specularColor = new Color(1, 1, 1);
		this.specularIntensityMap = null;
		this.specularColorMap = null;
		
		this.isMeshPhysicalMaterial = true;
		this.isInitialized = true;

		this.setValues(shaderMaterialParameters);
	}

	override setValues(parameters:ShaderMaterialParameters) {
		// fix "is not a property of this material" by defining null values initially
		if (!this.isInitialized) {
			for (let key in parameters) {
				(this as any)[key] = null;
			}
		}
	
		super.setValues(parameters);
	}

}

function clamp(v: number, min: number, max: number) {
	return v < min ? min : (v > max ? max : v);
}
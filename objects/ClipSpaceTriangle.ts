import { BufferGeometry, Float32BufferAttribute, Material, Mesh } from 'three';

export default class ClipSpaceTriangle<TMaterial extends Material> extends Mesh<BufferGeometry, TMaterial> {

	static globalGeometry = (() => {
		let geom = new BufferGeometry();
		const indices = [
			0, 1, 2,
		];
		const vertices = [
			-1, -1, 0,
			 3, -1, 0,
			-1,  3, 0,
		];
		const uvs = [
			0, 0,
			2, 0,
			0, 2,
		];
		geom.setIndex( indices );
		geom.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		geom.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
		return geom;
	})();

	constructor(material?: TMaterial) {
		super(ClipSpaceTriangle.globalGeometry, material);
		this.frustumCulled = false;
		this.castShadow = false;
		this.receiveShadow = false;
	}

}
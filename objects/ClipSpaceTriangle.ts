import { BufferGeometry, Float32BufferAttribute, Material, Mesh } from 'three';

export default class ClipSpaceTriangle extends Mesh {

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
		geom.setIndex( indices );
		geom.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		return geom;
	})();

	constructor(material?: Material) {
		super(ClipSpaceTriangle.globalGeometry, material);
		this.frustumCulled = false;
		this.castShadow = false;
		this.receiveShadow = false;
	}

}
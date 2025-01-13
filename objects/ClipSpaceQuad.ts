import { BufferGeometry, Float32BufferAttribute, Material, Mesh } from 'three';

export default class ClipSpaceQuad<TMaterial extends Material> extends Mesh<BufferGeometry, TMaterial> {

	static globalGeometry = (() => {
		let geom = new BufferGeometry();
		const indices = [
			0, 1, 2,
			2, 1, 3,
		];
		const vertices = [
			-1, -1, 0, // Bottom-left
			 1, -1, 0, // Bottom-right
			-1,  1, 0, // Top-left
			 1,  1, 0, // Top-right
		];
		geom.setIndex(indices);
		geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
		return geom;
	})();

	constructor(material?: TMaterial) {
		super(ClipSpaceQuad.globalGeometry, material);
		this.frustumCulled = false;
		this.castShadow = false;
		this.receiveShadow = false;
	}

}
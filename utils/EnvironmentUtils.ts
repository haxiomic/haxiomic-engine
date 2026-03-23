import { PMREMGenerator, Texture, WebGLRenderer } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export function loadEnvironment(renderer: WebGLRenderer, path: string): Promise<Texture> {
	return new Promise((resolve, reject) => {
		// environment
		let rgbeLoader = new HDRLoader().load(
			path,
			(texture: Texture) => {
				const pmremGenerator = new PMREMGenerator(renderer)
				pmremGenerator.compileEquirectangularShader();
				const environment = pmremGenerator.fromEquirectangular(texture).texture;

				resolve(environment);

				texture.dispose();
				pmremGenerator.dispose();
				rgbeLoader.dispose();
			},
			undefined,
			(error) => {
				console.error(error);
				reject(error);
			}
		);
	});
}
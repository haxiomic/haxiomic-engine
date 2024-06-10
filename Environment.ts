import { PMREMGenerator, Scene, Texture, WebGLRenderer } from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

export function loadEnvironment(renderer: WebGLRenderer, path: string): Promise<Texture> {
	return new Promise((resolve, reject) => {
		// environment
		let rgbeLoader = new RGBELoader().load(
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
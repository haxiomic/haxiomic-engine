import { Material, Mesh, Object3D, Scene } from "three";

export namespace ObjectUtils {

	export function forAllInstances<T extends new (...args: any[]) => any, I extends InstanceType<T>>(obj: Object3D, type: T, callback: (instance: I) => void) {
		obj.traverse((o) => {
			if (o instanceof type) {
				callback(o as I);
			}
		});
	}

	export function getAllInstances<T extends new (...args: any[]) => any, I extends InstanceType<T>>(obj: Object3D, type: T) {
		let result = new Array<I>();
		forAllInstances(obj, type, (instance) => {
			result.push(instance);
		});
		return result;
	}

	export function forEachMaterial(obj: Object3D, callback: (mesh: Mesh, material: Material) => void) {
		forAllInstances(obj, Mesh, (mesh) => {
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((material) => {
					callback(mesh, material);
				});
			} else {
				callback(mesh, mesh.material);
			}
		});
	}

	export function replaceMaterials(obj: Object3D, callback: (mesh: Mesh, material: Material | Array<Material>) => Material | Array<Material>) {
		let newMaterials = new Map<Mesh, Material | Array<Material>>();
		let previousMaterials = new Map<Mesh, Material | Array<Material>>();
		forAllInstances(obj, Mesh, (mesh) => {
			let _material = mesh.material;
			// replace
			mesh.material = callback(mesh, mesh.material);
			previousMaterials.set(mesh, _material);
			newMaterials.set(mesh, mesh.material);
		});
		return {
			materials: newMaterials,
			apply: (callback?: (mesh: Mesh, material: Material | Array<Material>) => void) => {
				newMaterials.forEach((material, mesh) => {
					callback?.(mesh, material);
					mesh.material = material;
				});
			},
			restore: (callback?: (mesh: Mesh, material: Material | Array<Material>) => void) => {
				previousMaterials.forEach((material, mesh) => {
					callback?.(mesh, material);
					mesh.material = material;
				});
			}
		}
	}

	export function getParentScene(obj: Object3D): Scene | null {
		let current: Object3D | null = obj;
		while (current) {
			if (current instanceof Scene) {
				return current;
			} else {
				current = current.parent;
			}
		}
		return null;
	}

}
import { Material, Mesh, Object3D, Scene } from "three";

export type ObjectWidthMaterial = Object3D & { material: Material | Material[] };
export function isObjectWidthMaterial(obj: Object3D): obj is ObjectWidthMaterial {
	return 'material' in obj;
}

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

	/**
	 * Replaces .material on **all** objects with a .material property 
	 */
	export function replaceMaterials(obj: Object3D, callback: (obj: ObjectWidthMaterial, material: Material | Array<Material>) => Material | Array<Material>) {
		let newMaterials = new Map<ObjectWidthMaterial, Material | Array<Material>>();
		let previousMaterials = new Map<ObjectWidthMaterial, Material | Array<Material>>();
		forAllInstances(obj, Object3D, (obj) => {
			if (isObjectWidthMaterial(obj)) {
				let _material = obj.material;
				// replace
				obj.material = callback(obj, obj.material);
				previousMaterials.set(obj, _material);
				newMaterials.set(obj, obj.material);
			}
		});
		return {
			newMaterials,
			previousMaterials,
			apply: (callback?: (obj: ObjectWidthMaterial, material: Material | Array<Material>) => void) => {
				newMaterials.forEach((material, obj) => {
					callback?.(obj, material);
					obj.material = material;
				});
			},
			restore: (callback?: (obj: ObjectWidthMaterial, material: Material | Array<Material>) => void) => {
				previousMaterials.forEach((material, obj) => {
					callback?.(obj, material);
					obj.material = material;
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
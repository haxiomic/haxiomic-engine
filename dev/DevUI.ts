import { AdditiveBlending, CustomBlending, Material, MultiplyBlending, NoBlending, NormalBlending, SubtractiveBlending } from 'three';
import { GUI, type Controller } from '../lib/lilgui.module.js';


// add hashController to GUI types

declare module '../lib/lilgui.module.js' {
	interface GUI {
		hashedControllers: Map<string, Controller> | undefined;
		hashedFolders: Map<string, GUI> | undefined;

		add<Obj extends object, PropertyName extends keyof Obj & string>(
			object: Obj,
			property: PropertyName,
			$1?: number | object | any[],
			max?: number,
			step?: number,
			name?: string
		): Controller;

		// update display of all controllers
		updateDisplay(): void;
	}
}

// monkey patch GUI to extend add and addFolder
let GUIAdd = GUI.prototype.add;
GUI.prototype.add = function<Obj extends object, PropertyName extends keyof Obj & string>(
	object: Obj,
	property: PropertyName,
	$1?: number | object | any[],
	max?: number,
	step?: number,
	name?: string
) {
	// use stack trace to get the name of the calling function
	let stack = new Error().stack;
	let caller = stack?.split('\n')[2]?.trim();
	let hash = `${caller} | ${object.constructor.name} | ${property} | ${name ?? ''}`;

	if (this.hashedControllers == null) {
		this.hashedControllers = new Map();
	}

	// find existing controller
	/*
	let existingController = this.hashedControllers.get(hash);
	if (existingController != null) {
		// update controller with $1, max, step
		if (typeof $1 == 'number') {
			existingController.min($1);
		} else if (Array.isArray($1)) {
			existingController.options($1);
		}
		if (max != null) {
			existingController.max(max);
		}
		if (step != null) {
			existingController.step(step);
		}
		if (name != null) {
			existingController.name(name);
		}
		// update object and field
		existingController.object = object;
		existingController.property = property;
		existingController.updateDisplay();
		return existingController;
	}
	*/

	let controller = GUIAdd.apply(this, arguments as any);
	if (name != null) {
		controller.name(name);
	}

	this.hashedControllers.set(hash, controller);

	return controller;
}

let GUIAddFolder = GUI.prototype.addFolder;
GUI.prototype.addFolder = function(name: string) {
	// use stack trace to get the name of the calling function
	let stack = new Error().stack;
	let caller = stack?.split('\n')[2]?.trim();
	let hash = `${caller} | ${name ?? ''}`;

	if (this.hashedFolders == null) {
		this.hashedFolders = new Map();
	}

	// find existing folder
	let existingFolder = this.hashedFolders.get(hash);
	if (existingFolder != null) {
		return existingFolder;
	}

	let folder = GUIAddFolder.apply(this, arguments as any);
	this.hashedFolders.set(hash, folder);
	return folder;
}

// add updateDisplay to GUI
GUI.prototype.updateDisplay = function() {
	for (let controller of this.controllersRecursive()) {
		controller.updateDisplay();
	}
}

// Wrap in getter/setter so it's only created when used
export class DevUI {

	static disabled = false;

	private static _ui: GUI | null = null;
	static get ui() {
		DevUI._ui = DevUI._ui ?? this.initUI();
		return DevUI._ui;
	}

	private static onKeyDown = (e: KeyboardEvent) => {
		let isTextInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable;

		const gui = DevUI.ui;

		if (!isTextInput && e.code == 'KeyH') {
			gui.show(gui._hidden);
		}
	}
	
	private static initUI(): GUI {
		let gui = new GUI();
		// use 'h' key to toggle GUI
		window.addEventListener('keydown', DevUI.onKeyDown, { passive: true });
		return gui;
	}

	static dispose() {
		if (DevUI._ui != null) {
			DevUI._ui.destroy();
			DevUI._ui = null;
		}
		window.removeEventListener('keydown', DevUI.onKeyDown);
	}

	// forward methods
	static add<Obj extends object, PropertyName extends keyof Obj & string>(
		object: Obj,
		property: PropertyName,
		$1?: number | object | any[],
		max?: number,
		step?: number,
		name?: string
	) {
		if (DevUI.disabled) {
			const fakeController = {
				set: () => fakeController,
				get: () => $1,
				onChange: () => fakeController,
				onFinishChange: () => fakeController,
				name: () => fakeController,
				min: () => fakeController,
				max: () => fakeController,
				step: () => fakeController,
			}
			return fakeController;
		}
		return DevUI.ui.add(object, property, $1, max, step, name);
	}

	static addFolder(name: string) {
		if (DevUI.disabled) {
			return this;
		}
		return DevUI.ui.addFolder(name);
	}

	static addColor(object: object, property: string) {
		if (DevUI.disabled) {
			return this;
		}
		return DevUI.ui.addColor(object, property);
	}

	static addMaterial(material: Material, name: string) {
		if (DevUI.disabled) {
			return this;
		}
		let materialFolder = DevUI.addFolder(name);

		if ('visible' in material) materialFolder.add(material, 'visible');
		if ('color' in material) materialFolder.addColor(material, 'color');
		if ('flatShading' in material) materialFolder.add(material, 'flatShading');
		if ('depthWrite' in material) materialFolder.add(material, 'depthWrite');
		if ('depthTest' in material) materialFolder.add(material, 'depthTest');
		if ('transparent' in material) materialFolder.add(material, 'transparent');
		if ('side' in material) {
			materialFolder.add(material, 'side', {
				FrontSide: 0,
				BackSide: 1,
				DoubleSide: 2,
			});
		}
		if ('blending' in material) {
			materialFolder.add(material, 'blending', {
				NoBlending,
				NormalBlending,
				AdditiveBlending,
				SubtractiveBlending,
				MultiplyBlending,
				CustomBlending,
			});
		}
		if ('premultipliedAlpha' in material) materialFolder.add(material, 'premultipliedAlpha');
		if ('opacity' in material) materialFolder.add(material, 'opacity', 0, 1);
		if ('alphaHash' in material) materialFolder.add(material, 'alphaHash', 0, 1);
		if ('metalness' in material) materialFolder.add(material, 'metalness', 0, 1);
		if ('roughness' in material) materialFolder.add(material, 'roughness', 0, 1);
		if ('emissiveIntensity' in material) materialFolder.add(material, 'emissiveIntensity', 0, 4);
		if ('envMapIntensity' in material) materialFolder.add(material, 'envMapIntensity', 0, 4);

		if ('iridescence' in material) {
			materialFolder.add(material, 'iridescence', 0, 1);
			if ('iridescenceIOR' in material) materialFolder.add(material, 'iridescenceIOR', 0, 3);
			if ('iridescenceThicknessRange' in material) {
				let iridescenceThicknessRange = { min: 0, max: 1 };
				materialFolder.add(iridescenceThicknessRange, 'min', 0, 1).onChange(() => {
					material.iridescenceThicknessRange = [iridescenceThicknessRange.min, iridescenceThicknessRange.max];
				});
				materialFolder.add(iridescenceThicknessRange, 'max', 0, 1).onChange(() => {
					material.iridescenceThicknessRange = [iridescenceThicknessRange.min, iridescenceThicknessRange.max];
				});
			}
		}

		if ('transmission' in material) {
			materialFolder.add(material, 'transmission', 0, 1);
			if ('ior' in material) materialFolder.add(material, 'ior', 0, 3);
			if ('thickness' in material) materialFolder.add(material, 'thickness', 0, 10);
			if ('attenuationColor' in material) materialFolder.addColor(material, 'attenuationColor');
			if ('attenuationDistance' in material) materialFolder.add(material, 'attenuationDistance', 0, 10);
			if ('dispersion' in material) materialFolder.add(material, 'dispersion', 0, 5);
		}

		if ('clearcoat' in material) {
			materialFolder.add(material, 'clearcoat', 0, 1);
			if ('clearcoatRoughness' in material) materialFolder.add(material, 'clearcoatRoughness', 0, 1);
		}
		
		if ('reflectivity' in material) materialFolder.add(material, 'reflectivity', 0, 1);

		if ('specularIntensity' in material) {
			materialFolder.add(material, 'specularIntensity', 0, 1);
			if ('specularColor' in material) materialFolder.addColor(material, 'specularColor');
		}

		if ('sheen' in material) {
			materialFolder.add(material, 'sheen', 0, 1);
			if ('sheenRoughness' in material) materialFolder.add(material, 'sheenRoughness', 0, 1);
			if ('sheenColor' in material) materialFolder.addColor(material, 'sheenColor');
		}

		if ('bumpScale' in material) materialFolder.add(material, 'bumpScale', -.01, 10);

		return materialFolder;
	}

	static updateDisplay() {
		if (DevUI.disabled) {
			return;
		}
		DevUI.ui.updateDisplay();
	}

	static onChange(callback: () => void) {
		if (DevUI.disabled) {
			return this;
		}
		DevUI.ui.onChange(callback);
		return this;
	}

	static close() {
		if (DevUI.disabled) {
			return this;
		}
		DevUI.ui.close();
		return this;
	}

}
import { Color, ColorRepresentation } from "three"

/**
 * Color that changes with system dark mode
 */
export class SystemSchemeColor extends Color {

    darkMode: ColorRepresentation
    lightMode: ColorRepresentation
    
    constructor(darkMode: ColorRepresentation, lightMode: ColorRepresentation) {
        super(darkMode)
        this.darkMode = darkMode
        this.lightMode = lightMode

        // listen to theme changes
        if (window.matchMedia) {
            let check = window.matchMedia('(prefers-color-scheme: dark)');
            this.set(check.matches ? this.darkMode : this.lightMode)
            check.addEventListener('change', event => {
                this.set(event.matches ? this.darkMode : this.lightMode)
            });
        }
    }

    clone(): this {
        return new SystemSchemeColor(this.darkMode, this.lightMode) as this
    }

}
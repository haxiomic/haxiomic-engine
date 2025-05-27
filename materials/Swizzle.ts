type C = 'r' | 'g' | 'b' | 'a';

/**
 * Swizzle of any length, including empty.
 */
export type Swizzle =
    | ''
    | `.${C}`
    | `.${C}${C}`
    | `.${C}${C}${C}`
    | `.${C}${C}${C}${C}`;

/**
 * Swizzle of rgba components, length 4 or empty.
 */
export type RGBASwizzle = `.${C}${C}${C}${C}` | '';
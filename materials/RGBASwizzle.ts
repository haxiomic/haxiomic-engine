type C = 'r' | 'g' | 'b' | 'a';

export type RGBASwizzle = `.${C}${C}${C}${C}` | '';

export type Swizzle =
    | ''
    | `.${C}`
    | `.${C}${C}`
    | `.${C}${C}${C}`
    | `.${C}${C}${C}${C}`;
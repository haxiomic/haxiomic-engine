// webpack-glsl-minify is an OPTIONAL peer dependency, loaded only when GLSL
// minification is enabled. Declared here so `tsc` resolves the lazy
// `import('webpack-glsl-minify/build/minify.js')` without the package being
// installed (it isn't, by default).
declare module "webpack-glsl-minify/build/minify.js";

declare module "*.glsl" {
  const value: string;
  export default value;
}

declare module "*.vs" {
  const value: string;
  export default value;
}

declare module "*.fs" {
  const value: string;
  export default value;
}
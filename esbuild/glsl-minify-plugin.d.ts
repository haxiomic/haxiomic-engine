// webpack-glsl-minify is an undeclared, optional dependency — loaded only when
// GLSL minification is enabled (off by default). Declared here so `tsc`
// resolves the lazy `import('webpack-glsl-minify/build/minify.js')` without the
// package being installed.
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
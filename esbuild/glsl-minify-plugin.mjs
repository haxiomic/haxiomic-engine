// @ts-check

import fs from 'fs';
import path from 'path';
import { GlslMinify } from 'webpack-glsl-minify/build/minify.js';
import esbuild from 'esbuild';

/** @type {(options: { minify: boolean }) => esbuild.Plugin} */
const glslMinifyPlugin = (options) => ({
  name: 'glsl-minify',
  setup(build) {
	// catch paths with the namespace 'glsl-minify'
	build.onLoad({ filter: /\.glsl|.vs|.fs|.vert|.fragment$/ }, async (args) => {
		let fileContents = fs.readFileSync(args.path, 'utf8');

		if (options.minify) {

			// list of glsl 300 keywords, built-in functions etc which are not included by minify.js by default
			let glsl300Keywords = ["atomic_uint","buffer","case","default","dmat2","dmat2x2","dmat2x3","dmat2x4","dmat3","dmat3x2","dmat3x3","dmat3x4","dmat4","dmat4x2","dmat4x3","dmat4x4","floatBitsToInt","floatBitsToUint","gl_FragCoord","gl_FragDepth","gl_FrontFacing","gl_InstanceID","gl_PointCoord","gl_PointSize","gl_Position","gl_VertexID","iimage1D","iimage1DArray","iimage2D","iimage2DArray","iimage2DMS","iimage2DMSArray","iimage2DRect","iimage3D","iimageBuffer","iimageCube","iimageCubeArray","image1D","image1DArray","image2D","image2DArray","image2DMArray","image2DMS","image2DRect","image3D","imageBuffer","imageCube","imageCubeArray","intBitsToFloat","isampler1Darray","packHalf2x16","packSnorm2x16","packUnorm2x16","patch","precise","sampler2DArrayshadow","sampler2DRectshadow","shared","subroutine","switch","texelFetch","texelFetchOffset","texture","textureGrad","textureGradOffset","textureLod","textureLodOffset","textureOffset","textureProj","textureProjGrad","textureProjGradOffset","textureProjLod","textureProjLodOffset","textureProjOffset","transpose","uimage1D","uimage1DArray","uimage2D","uimage2DArray","uimage2DMS","uimage2DMSArray","uimage2DRect","uimage3D","uimageBuffer","uimageCube","uimageCubeArray","uintBitsToFloat","unpackHalf2x16","unpackSnorm2x16","unpackUnorm2x16"];

			// find all _shaderHook_ functions and prevent them from being mangled
			let shaderHooks = [];
			for (let match of fileContents.matchAll( /(_shaderHook_\w+)\s*\(/g )) {
				shaderHooks.push(match[1]);
			}

			let noMangleList = glsl300Keywords.concat(shaderHooks);

			let glsl = new GlslMinify(
				{
					preserveAll: !options.minify,
					output: 'source',
					esModule: true,
					nomangle: noMangleList,
				},
				// to handle imports within the shader
				async (filename, directory) => {
					let filePath = directory ? path.join(directory, filename) : filename;
					return {
						path: filePath,
						contents: fs.readFileSync(filePath, 'utf8'),
					}
				}
			);

			let minifiedJsModule = await glsl.executeAndStringify(fileContents);

			return ({
				contents: minifiedJsModule,
				loader: 'js',
			});
		} else {
			return ({
				contents: `export default \`${fileContents.replaceAll(
					/`/g,
					'\\`'
				)}\`;`,
				loader: 'js',
			});
		}
	});
  },
});

export default glslMinifyPlugin;
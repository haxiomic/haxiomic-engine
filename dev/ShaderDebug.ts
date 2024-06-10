export function onShaderError(
	gl: WebGLRenderingContext,
	program: WebGLProgram,
	glVertexShader: WebGLShader,
	glFragmentShader: WebGLShader,
) {
	const parseForErrors = function(gl: WebGLRenderingContext, shader: WebGLShader, name: string) {
		const errors = gl.getShaderInfoLog(shader)?.trim() ?? "";
		const prefix = "Errors in " + name + ":" + "\n\n" + errors;
		
		if (errors !== "") {
			const code = gl.getShaderSource(shader)?.replace(/\t/g, "  ") ?? "";
			const lines = code.split("\n");
			var linedCode = "";
			var i = 1;
			for (var line of lines) {
				linedCode += (i < 10 ? " " : "") + i + ":\t\t" + line + "\n";
				i++;
			}
			
			console.error(prefix + "\n" + linedCode);
		}
	}
	
	parseForErrors(gl, glVertexShader, 'Vertex Shader');
	parseForErrors(gl, glFragmentShader, 'Fragment Shader');
}
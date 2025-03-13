/**
 * @author haxiomic
 */

uniform vec2 u_drawingBufferSize;
uniform float u_pixelRatio;
uniform vec3 u_camera;
uniform vec3 u_canvasDotsColor;

uniform float dotSize_px;
uniform float dotLargeScale;
uniform float smallSpacing_px;
uniform float largeInterval;
uniform float blending;
uniform float powerOf2Spacing;
uniform float smallOpacity;
uniform float largeOpacity;

float logBaseN(float n, float x) {
    return log2(x) / log2(n);
}

float grid(vec2 st, float z, float size_pixels, float d) {
    vec2 xy = st * z;
    vec2 d2 = vec2(d);
    vec2 g = mod(xy, d2)/d2;
    g.x = g.x > 0.5 ? (1. - g.x) : g.x;
    g.y = g.y > 0.5 ? (1. - g.y) : g.y;
    vec2 g_pixels = g * d2 * u_drawingBufferSize.y / z;
    return smoothstep(1.0, 0.0, length(g_pixels) - size_pixels * .5);
}

float gridBlend(float spacing, float dotSize, float n, vec2 st, float z) {
    // at a given zoom level z, determine visible grid levels and their proportions
    float logNZ = logBaseN(n, z);
    float u = fract(logNZ);
    float s = spacing * pow(n, floor(logNZ));

    float g1 = grid(st, z, dotSize, s    );
    float gn = grid(st, z, dotSize, s * n);

    float a = u;

    // compensate for spacing which changes apparent brightness
    float iu = 1. - u;
    float brightening = (1. + 1.5 * iu * iu * smoothstep(1.0, 1.-blending * .5, iu));

    return mix(
        g1,
        gn,
        smoothstep(0.0, blending, a) * smoothstep(1.0 - blending, 1.0, a)
    ) * brightening;
}

void main() {
    // pixel in dom coordinates (0, 0) is top left and independent of device pixel ratio
    vec2 dom_px = vec2(gl_FragCoord.x, u_drawingBufferSize.y - gl_FragCoord.y) / u_pixelRatio;

    vec2 xy_px = (dom_px / u_camera.z - u_camera.xy);
    // gl_FragColor = vec4(mod(xy, 100.) / 100., 0., 1.); return;

    // normalize coordinates to 0-1
    // where y ranges from 0-1 and x ranges from 0-1 * aspect ratio
    float domHeight_px = u_drawingBufferSize.y / u_pixelRatio;
    vec2 normalizedCoords = xy_px / domHeight_px;

    // gl_FragColor = vec4(normalizedCoords, 0., 1.); return;

    normalizedCoords *= u_camera.z;
    float z = 1. / u_camera.z;
    float smallSpacing_norm = (smallSpacing_px / domHeight_px);
    float largeSpacing_norm = smallSpacing_norm * largeInterval;

    float dotSize_pixels = dotSize_px * u_pixelRatio;

    float gridSmall = gridBlend(smallSpacing_norm, dotSize_pixels                , pow(2., powerOf2Spacing), normalizedCoords, z);
    float gridLarge = gridBlend(largeSpacing_norm, dotSize_pixels * dotLargeScale, pow(2., powerOf2Spacing), normalizedCoords, z);

    vec3 dotsColor = u_canvasDotsColor/255.;
    float dotsOpacity = min(gridSmall * smallOpacity + gridLarge * largeOpacity , 1.);

    gl_FragColor = vec4(dotsColor, dotsOpacity);
}
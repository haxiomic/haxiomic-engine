// https://www.shadertoy.com/view/dlfXDN
// 2023 myth0genesis
// 4D Simplex Noise Gradient
// I saw that Stefan Gustavson didn't seem to have published any shader
// with an analytic solution for the gradients of his variant
// of 4D simplex noise, so I thought I'd try solving it myself
// and publish it here for anyone who finds it useful.
// Compares the analytic solution to the numerically approximated one (for a sanity check)
// and shows the results of all four derivatives with respect to each dimension.
// Top : Analytic gradient            | Bottom: Forward differences approximated gradient
// Left: Gradient w/ respect to p.xyz | Right : Derivative w/ respect to p.w

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

float mod289(float x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 10.0) * x);
}

float permute(float x) {
    return mod289(((x * 34.0) + 10.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

float taylorInvSqrt(float r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

vec4 grad4(float j, vec4 ip) {
    const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
    vec4 p, s;

    p.xyz = floor(fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
    p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
    s = vec4(lessThan(p, vec4(0.0)));
    p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www; 

    return p;
}

// Stevan Gustavson's 4D simplex noise: https://github.com/stegu/webgl-noise/blob/master/src/noise4D.glsl
// I left the scalar output intact for anyone who just wants
// to copy and paste it to use for a project.

// (sqrt(5) - 1)/4 = F4
#define F4 0.309016994374947451

float snoise(vec4 v, out vec4 grad) {
    const vec4  C = vec4( 0.138196601125011,  // (5 - sqrt(5))/20  G4
                          0.276393202250021,  //  2 * G4
                          0.414589803375032,  //  3 * G4
                         -0.447213595499958); // -1 + 4 * G4

    vec4 i = floor(v + dot(v, vec4(F4)));
    vec4 x0 = v - i + dot(i, C.xxxx);

    vec4 i0;
    vec3 isX = step(x0.yzw, x0.xxx);
    vec3 isYZ = step(x0.zww, x0.yyz);
    i0.x = isX.x + isX.y + isX.z;
    i0.yzw = 1.0 - isX;
    i0.y += isYZ.x + isYZ.y;
    i0.zw += 1.0 - isYZ.xy;
    i0.z += isYZ.z;
    i0.w += 1.0 - isYZ.z;

    vec4 i3 = clamp(i0,  0.0, 1.0 );
    vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0 );
    vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0 );

    vec4 x1 = x0 - i1 + C.xxxx;
    vec4 x2 = x0 - i2 + C.yyyy;
    vec4 x3 = x0 - i3 + C.zzzz;
    vec4 x4 = x0 + C.wwww;

    i = mod289(i); 
    float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
    vec4 j1 = permute(permute(permute(permute(
                        i.w + vec4(i1.w, i2.w, i3.w, 1.0))
                      + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
                      + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
                      + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

    vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);

    vec4 p0 = grad4(j0,   ip);
    vec4 p1 = grad4(j1.x, ip);
    vec4 p2 = grad4(j1.y, ip);
    vec4 p3 = grad4(j1.z, ip);
    vec4 p4 = grad4(j1.w, ip);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    p4 *= taylorInvSqrt(dot(p4, p4));

    vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)             ), 0.0);
    vec3 m02 = m0 * m0;
    vec2 m12 = m1 * m1;
    vec3 m04 = m02 * m02;
    vec2 m14 = m12 * m12;
    vec3 pdotx0 = vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2));
    vec2 pdotx1 = vec2(dot(p3, x3), dot(p4, x4));
    
    vec3 temp0 = m02 * m0 * pdotx0;
    vec2 temp1 = m12 * m1 * pdotx1;
    
    // Here the gradient is calculated
    grad = -8.0 * (temp0.x * x0 + temp0.y * x1 + temp0.z * x2 + temp1.x * x3 + temp1.y * x4);
    grad += m04.x * p0 + m04.y * p1 + m04.z * p2 + m14.x * p3 + m14.y * p4;
    
    // There's probably an exact factor the result can be
    // multiplied by to get a range of -1.0 to 1.0,
    // but I didn't know how to find it, so I just normalized the vector
    grad = normalize(grad);

    return 49.0 * (dot(m04, pdotx0) + dot(m14, pdotx1));
}
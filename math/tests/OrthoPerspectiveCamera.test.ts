/**
 * Tests for OrthoPerspectiveCamera
 * Run with: npx tsx src/OrthoPerspectiveCamera.test.ts
 */

import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { OrthoPerspectiveCamera } from '../OrthoPerspectiveCamera.js';

const EPSILON = 1e-6;

function assertClose(actual: number, expected: number, message: string, epsilon = EPSILON) {
    if (Math.abs(actual - expected) > epsilon) {
        throw new Error(`${message}: expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected)})`);
    }
}

function assertVec4Close(actual: Vector4, expected: Vector4, message: string, epsilon = EPSILON) {
    assertClose(actual.x, expected.x, `${message} (x)`, epsilon);
    assertClose(actual.y, expected.y, `${message} (y)`, epsilon);
    assertClose(actual.z, expected.z, `${message} (z)`, epsilon);
    assertClose(actual.w, expected.w, `${message} (w)`, epsilon);
}

function projectPoint(matrix: Matrix4, point: Vector3): Vector4 {
    const v = new Vector4(point.x, point.y, point.z, 1);
    v.applyMatrix4(matrix);
    return v;
}

function projectPointNDC(matrix: Matrix4, point: Vector3): Vector3 {
    const v = projectPoint(matrix, point);
    return new Vector3(v.x / v.w, v.y / v.w, v.z / v.w);
}

// Test 1: At projectionBlend=1, should match PerspectiveCamera
function testPerspectiveMatch() {
    console.log('Test 1: projectionBlend=1 matches PerspectiveCamera');

    const fov = 60, aspect = 16/9, near = 0.1, far = 100;

    const perspCamera = new PerspectiveCamera(fov, aspect, near, far);
    perspCamera.updateProjectionMatrix();

    const hybridCamera = new OrthoPerspectiveCamera(fov, aspect, near, far, 1);
    hybridCamera.updateProjectionMatrix();

    // Compare projection matrices element by element
    const perspElements = perspCamera.projectionMatrix.elements;
    const hybridElements = hybridCamera.projectionMatrix.elements;

    for (let i = 0; i < 16; i++) {
        assertClose(hybridElements[i], perspElements[i], `Matrix element [${i}]`);
    }

    // Test projecting some points
    const testPoints = [
        new Vector3(0, 0, -1),
        new Vector3(0, 0, -10),
        new Vector3(1, 1, -5),
        new Vector3(-2, 3, -20),
    ];

    for (const p of testPoints) {
        const perspNDC = projectPointNDC(perspCamera.projectionMatrix, p);
        const hybridNDC = projectPointNDC(hybridCamera.projectionMatrix, p);
        assertClose(hybridNDC.x, perspNDC.x, `Point ${p.toArray()} NDC x`);
        assertClose(hybridNDC.y, perspNDC.y, `Point ${p.toArray()} NDC y`);
        assertClose(hybridNDC.z, perspNDC.z, `Point ${p.toArray()} NDC z`);
    }

    console.log('  ✓ Passed\n');
}

// Test 2: At projectionBlend=0, should match OrthographicCamera
function testOrthographicMatch() {
    console.log('Test 2: projectionBlend=0 matches OrthographicCamera');

    const fov = 60, aspect = 16/9, near = 0.1, far = 100, focus = 10;

    const hybridCamera = new OrthoPerspectiveCamera(fov, aspect, near, far, 0, focus);
    hybridCamera.updateProjectionMatrix();

    // Calculate expected ortho bounds
    const fovRad = fov * Math.PI / 180;
    const focalLength = 1 / Math.tan(fovRad / 2);
    const orthoHeight = focus / focalLength;
    const orthoWidth = orthoHeight * aspect;

    const orthoCamera = new OrthographicCamera(-orthoWidth, orthoWidth, orthoHeight, -orthoHeight, near, far);
    orthoCamera.updateProjectionMatrix();

    // Compare projection matrices
    const orthoElements = orthoCamera.projectionMatrix.elements;
    const hybridElements = hybridCamera.projectionMatrix.elements;

    for (let i = 0; i < 16; i++) {
        assertClose(hybridElements[i], orthoElements[i], `Matrix element [${i}]`);
    }

    // Test projecting some points
    const testPoints = [
        new Vector3(0, 0, -1),
        new Vector3(0, 0, -10),
        new Vector3(1, 1, -5),
        new Vector3(-2, 3, -20),
    ];

    for (const p of testPoints) {
        const orthoNDC = projectPointNDC(orthoCamera.projectionMatrix, p);
        const hybridNDC = projectPointNDC(hybridCamera.projectionMatrix, p);
        assertClose(hybridNDC.x, orthoNDC.x, `Point ${p.toArray()} NDC x`);
        assertClose(hybridNDC.y, orthoNDC.y, `Point ${p.toArray()} NDC y`);
        assertClose(hybridNDC.z, orthoNDC.z, `Point ${p.toArray()} NDC z`);
    }

    console.log('  ✓ Passed\n');
}

// Test 3: Objects at focus distance should have same screen size regardless of projectionBlend
function testFocusDistanceInvariance() {
    console.log('Test 3: Objects at focus distance have same screen size across projectionBlend');

    const fov = 60, aspect = 16/9, near = 0.1, far = 100, focus = 10;

    // A point at focus distance
    const pointAtFocus = new Vector3(1, 1, -focus);

    // Project at various blend values
    const blendValues = [0, 0.25, 0.5, 0.75, 1.0];
    const ndcResults: Vector3[] = [];

    for (const blend of blendValues) {
        const camera = new OrthoPerspectiveCamera(fov, aspect, near, far, blend, focus);
        camera.updateProjectionMatrix();
        ndcResults.push(projectPointNDC(camera.projectionMatrix, pointAtFocus));
    }

    // All NDC x and y should be the same (z will differ due to depth mapping)
    const referenceNDC = ndcResults[0];
    for (let i = 1; i < ndcResults.length; i++) {
        assertClose(ndcResults[i].x, referenceNDC.x, `Blend ${blendValues[i]} NDC x`, 1e-5);
        assertClose(ndcResults[i].y, referenceNDC.y, `Blend ${blendValues[i]} NDC y`, 1e-5);
    }

    console.log('  ✓ Passed\n');
}

// Test 4: Projection matrix element [2][3] encodes projectionBlend correctly
function testProjectionMatrixBlendEncoding() {
    console.log('Test 4: projectionMatrix[2][3] encodes -projectionBlend');

    const fov = 60, aspect = 16/9, near = 0.1, far = 100;

    const blendValues = [0, 0.25, 0.5, 0.75, 1.0];

    for (const blend of blendValues) {
        const camera = new OrthoPerspectiveCamera(fov, aspect, near, far, blend);
        camera.updateProjectionMatrix();

        // element[11] is projectionMatrix[2][3] (column 2, row 3)
        const element11 = camera.projectionMatrix.elements[11];
        assertClose(element11, -blend, `Blend ${blend}: element[11]`);

        // element[15] is projectionMatrix[3][3] (column 3, row 3)
        const element15 = camera.projectionMatrix.elements[15];
        assertClose(element15, 1 - blend, `Blend ${blend}: element[15]`);
    }

    console.log('  ✓ Passed\n');
}

// Test 5: clone() and copy() preserve projectionBlend
function testCloneAndCopy() {
    console.log('Test 5: clone() and copy() preserve projectionBlend');

    const original = new OrthoPerspectiveCamera(60, 16/9, 0.1, 100, 0.3, 15);
    original.position.set(1, 2, 3);
    original.updateProjectionMatrix();

    // Test clone
    const cloned = original.clone();
    assertClose(cloned.projectionBlend, 0.3, 'Cloned projectionBlend');
    assertClose(cloned.focus, 15, 'Cloned focus');
    assertClose(cloned.position.x, 1, 'Cloned position.x');

    // Test copy
    const copied = new OrthoPerspectiveCamera();
    copied.copy(original);
    assertClose(copied.projectionBlend, 0.3, 'Copied projectionBlend');
    assertClose(copied.focus, 15, 'Copied focus');

    console.log('  ✓ Passed\n');
}

// Test 6: toOrthographicCamera and fromOrthographicCamera are inverses
function testOrthographicConversion() {
    console.log('Test 6: toOrthographicCamera and fromOrthographicCamera roundtrip');

    const original = new OrthoPerspectiveCamera(60, 16/9, 0.1, 100, 0, 10);
    original.position.set(0, 0, 5);
    original.updateProjectionMatrix();

    // Convert to ortho
    const ortho = original.createOrthographicCamera();

    // Convert back
    const restored = new OrthoPerspectiveCamera();
    restored.setFromOrthographicCamera(ortho, 60);

    // Check key properties match
    assertClose(restored.focus, original.focus, 'Restored focus', 1e-4);
    assertClose(restored.aspect, original.aspect, 'Restored aspect');
    assertClose(restored.near, original.near, 'Restored near');
    assertClose(restored.far, original.far, 'Restored far');
    assertClose(restored.projectionBlend, 0, 'Restored projectionBlend');

    // Project a test point - should get same NDC
    const testPoint = new Vector3(1, 1, -10);
    const originalNDC = projectPointNDC(original.projectionMatrix, testPoint);
    const restoredNDC = projectPointNDC(restored.projectionMatrix, testPoint);

    assertClose(restoredNDC.x, originalNDC.x, 'Roundtrip NDC x', 1e-4);
    assertClose(restoredNDC.y, originalNDC.y, 'Roundtrip NDC y', 1e-4);

    console.log('  ✓ Passed\n');
}

// Test 7: Intermediate blend values produce valid projection
function testIntermediateBlends() {
    console.log('Test 7: Intermediate blend values produce valid projections');

    const fov = 60, aspect = 16/9, near = 0.1, far = 100, focus = 10;

    const blendValues = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    const testPoint = new Vector3(2, 1, -15);

    let prevNDC: Vector3 | null = null;

    for (const blend of blendValues) {
        const camera = new OrthoPerspectiveCamera(fov, aspect, near, far, blend, focus);
        camera.updateProjectionMatrix();

        const ndc = projectPointNDC(camera.projectionMatrix, testPoint);

        // Check NDC is in reasonable range
        if (Math.abs(ndc.x) > 10 || Math.abs(ndc.y) > 10 || Math.abs(ndc.z) > 10) {
            throw new Error(`Blend ${blend}: NDC out of range: ${ndc.toArray()}`);
        }

        // Check w is positive (valid projection)
        const projected = projectPoint(camera.projectionMatrix, testPoint);
        if (projected.w <= 0) {
            throw new Error(`Blend ${blend}: Invalid w=${projected.w}`);
        }

        // Check monotonic transition (NDC should change smoothly)
        if (prevNDC) {
            const dx = Math.abs(ndc.x - prevNDC.x);
            const dy = Math.abs(ndc.y - prevNDC.y);
            // Should be smooth - no huge jumps
            if (dx > 0.5 || dy > 0.5) {
                throw new Error(`Blend ${blend}: Large jump from previous: dx=${dx}, dy=${dy}`);
            }
        }

        prevNDC = ndc;
    }

    console.log('  ✓ Passed\n');
}

// Run all tests
function runTests() {
    console.log('=== OrthoPerspectiveCamera Tests ===\n');

    try {
        testPerspectiveMatch();
        testOrthographicMatch();
        testFocusDistanceInvariance();
        testProjectionMatrixBlendEncoding();
        testCloneAndCopy();
        testOrthographicConversion();
        testIntermediateBlends();

        console.log('=== All tests passed! ===');
    } catch (e) {
        console.error('TEST FAILED:', e);
        process.exit(1);
    }
}

runTests();

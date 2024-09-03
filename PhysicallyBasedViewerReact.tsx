import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CineonToneMapping } from 'three';
import { PhysicallyBasedViewer } from './PhysicallyBasedViewer';

interface ViewerProps extends React.HTMLProps<HTMLDivElement> {
    initialize: (viewer: PhysicallyBasedViewer, container: HTMLDivElement) => void;
}

const PhysicallyBasedViewerReact = forwardRef<HTMLDivElement, ViewerProps>((props, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const { initialize, style, ...divProps } = props;

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
        if (!containerRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.cursor = 'pointer';

        containerRef.current.appendChild(canvas);

        const viewer = new PhysicallyBasedViewer({
            canvas,
            defaultEnvironment: false,
            toneMapping: CineonToneMapping,
            toneMappingExposure: 1.0,
            postProcessing: {
                enabled: false,
                bloomStrength: 0.291,
                bloomRadius: 0.673,
                bloomThreshold: 0.0,
                msaaSamples: 4,
            },
        });

        props.initialize(viewer, containerRef.current);

        return () => {
            viewer.renderer.resetState();
            viewer.dispose();
            containerRef.current?.removeChild(canvas);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                contain: 'strict',
                ...style
            }}
            {...divProps}
        >
            {props.children}
        </div>
    );
});

export default PhysicallyBasedViewerReact;

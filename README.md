# Remix: Interactive Fluid Trails

An immersive, full-screen fluid dynamics simulation where you can paint with smoke-like trails to reveal a hidden blueprint of a 3D Among Us character. Built with React, Three.js, and GLSL shaders.

## Features
- **3D Among Us Model**: A cute red character built with Three.js primitives.
- **Blueprint Reveal**: Interactive fluid trails reveal a blueprint-style animated sketch render of the 3D model.
- **Parallax Camera**: Smooth camera motion tracking mouse moves and touch drags.
- **Fluid Simulation**: GPU-based Navier-Stokes simulation for smooth trails.
- **Mobile First**: Optimized for touch interactions and small screens.

## Architecture
- **Fluid Simulation**: GPU-based Navier-Stokes simulation for smooth trails.
- **Parallax Shader**: Custom GLSL shader for depth-based displacement.
- **Canvas Textures**: Dynamic texture generation for the scene and depth map.

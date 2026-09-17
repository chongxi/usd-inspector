# USD Robot Inspector

A browser-only inspector for OpenUSD robot assets, live at **https://chongxi.github.io/usd-inspector/**.

- Stage tree with every prim, its attributes, relationships and metadata
- Joint sliders and presets, driven by the UsdPhysics joint frames (mimic joints follow their leader)
- Visual, collision, frame, centre-of-mass and camera layers; X-ray, wireframe, section plane and point-to-point measuring
- Automatic checks: articulation root, joint-frame consistency, drives, mass, collisions, metadata, mesh budget
- Robot library streamed from NVIDIA's Isaac Sim 5.1 asset server (the Isaac Lab robot list) and from `enactic/openarm_isaac_lab`
- Open your own `.usd` / `.usda` / `.usdc` / `.usdz`, or a whole folder so references, payloads and sublayers resolve. Files are read in your browser and never uploaded.

## Share links

- `?sample=kakun`, `?sample=kakun-full`, `?sample=openarm-v2` open a hosted robot
- `?asset=Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd` opens a path on the Isaac Sim 5.1 server; a full `https://` URL also works if that server allows cross-origin requests

## Hosted samples (`samples/`)

| File | What it is |
| --- | --- |
| `kakun_full.usd.gz.001`, `.002` | Kakun, the original USD, gzipped and split in two to fit the web uploader (join them, then gunzip) |
| `kakun_preview.usdc.gz` | Kakun with meshes simplified to at most 0.2 mm error; everything else unchanged |
| `openarm_v2_bimanual.usdc.gz` | OpenArm v2.0 (default bimanual preset, pinch grippers), converted from the URDF in [enactic/openarm_description](https://github.com/enactic/openarm_description) at commit `14ff67b`. Not an official Enactic or NVIDIA asset. Visual meshes simplified to at most 0.15 mm, collision meshes to 0.5 mm (convex hulls). Joint axes are mapped to local +X; the original axis is kept in `urdf:axis`. |

## Notes

- USD is read by [three-usd-robot](https://github.com/neka-nat/three-usd-robot) 0.14.1 (MIT), bundled into `index.html` with two fixes: internal references into sublayers (Isaac Sim 5.x collision layers) and `PhysxMimicJointAPI:rot*` instances on prismatic joints. It is a pragmatic composer, not the full OpenUSD engine.
- Rendering uses [three.js](https://threejs.org) r186 (MIT) from jsDelivr; gzip decoding uses the browser's DecompressionStream; [fflate](https://github.com/101arrowz/fflate) (MIT) is bundled for `.usdz`.
- OpenArm meshes are © Enactic, Inc., licensed under Apache-2.0.

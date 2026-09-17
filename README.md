# USD Robot Inspector

A browser-only inspector for OpenUSD robot assets, live at **https://chongxi.github.io/usd-inspector/**.

- Stage tree with every prim, its attributes, relationships and metadata
- Joint sliders and presets, driven by the UsdPhysics joint frames (mimic joints follow their leader)
- Visual, collision, frame, centre-of-mass and camera layers; X-ray, wireframe, section plane and point-to-point measuring
- Automatic checks: articulation root, joint-frame consistency, drives, mass, collisions, metadata, mesh budget
- Robot library streamed from NVIDIA's Isaac Sim 5.1 asset server (the Isaac Lab robot list) and from `enactic/openarm_isaac_lab`
- Open your own `.usd` / `.usda` / `.usdc` / `.usdz`, or a whole folder so references, payloads and sublayers resolve. Files are read in your browser and never uploaded.

## Share links

- `?sample=kakun`, `?sample=kakun-full`, `?sample=panthera-ht`, `?sample=mini-pi-plus`, `?sample=mini-pi`, `?sample=hi`, `?sample=openarm-v2` open a hosted robot
- `?asset=Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd` opens a path on the Isaac Sim 5.1 server; a full `https://` URL also works if that server allows cross-origin requests

## Hosted samples (`samples/`)

| File | What it is |
| --- | --- |
| `kakun_full.usd.gz.001`, `.002` | Kakun, the original USD, gzipped and split in two to fit the web uploader (join them, then gunzip) |
| `kakun_preview.usdc.gz` | Kakun with meshes simplified to at most 0.2 mm error; everything else unchanged |
| `openarm_v2_bimanual.usdc.gz` | OpenArm v2.0 (default bimanual preset, pinch grippers), converted from the URDF in [enactic/openarm_description](https://github.com/enactic/openarm_description) at commit `14ff67b`. Not an official Enactic or NVIDIA asset. Visual meshes simplified to at most 0.15 mm, collision meshes to 0.5 mm (convex hulls). Joint axes are mapped to local +X; the original axis is kept in `urdf:axis`. |
| `panthera_ht.usdc.gz` | HighTorque Panthera-HT 6-axis arm with parallel gripper, from `HighTorque-Robotics/Panthera_HT_ROS2` (`src/panthera_ht_ros_description`, gripper xacro) at `b08633d`. Drive gains from its ros2_control block. |
| `mini_pi_plus_24dof.usdc.gz` | HighTorque Mini Pi+ (24 DOF), from `HighTorque-Robotics/robot_urdf` (`pi_plus_24dof`) at `5675b9a`. |
| `mini_pi_12dof.usdc.gz` | HighTorque Mini Pi (12 DOF), same repo (`pi_12dof`). Authored joint state = the training stance listed in that repo's README. |
| `hi_25dof.usdc.gz` | HighTorque Hi (25 DOF), same repo (`hi_25dof`). |

The HighTorque and OpenArm files were converted from the manufacturers' URDFs with `urdf_to_usd.py` (written for this site; not official assets). Visual meshes are simplified to at most 0.25 mm (HighTorque) or 0.15 mm (OpenArm), collision meshes to 0.5 mm as convex hulls; URDF box/cylinder/sphere collisions stay analytic. Joint axes are mapped to local +X (the original is kept in `urdf:axis`); mimic joints use `PhysxMimicJointAPI:rotX`. Where the source has no gains, drives carry only the URDF effort limit. In every converted robot, link poses match the URDF's forward kinematics to within 1e-7 m over random joint configurations.

## Notes

- USD is read by [three-usd-robot](https://github.com/neka-nat/three-usd-robot) 0.14.1 (MIT), bundled into `index.html` with two fixes: internal references into sublayers (Isaac Sim 5.x collision layers) and `PhysxMimicJointAPI:rot*` instances on prismatic joints. It is a pragmatic composer, not the full OpenUSD engine.
- Rendering uses [three.js](https://threejs.org) r186 (MIT) from jsDelivr; gzip decoding uses the browser's DecompressionStream; [fflate](https://github.com/101arrowz/fflate) (MIT) is bundled for `.usdz`.
- OpenArm meshes are © Enactic, Inc. (Apache-2.0). Panthera-HT description © 2026 HighTorque Robotics (MIT, per `Panthera_HT_ROS2/LICENSE`). Mini Pi, Mini Pi+ and Hi descriptions are from HighTorque Robotics' `robot_urdf`, whose `package.xml` files declare a BSD license (the repo has no separate LICENSE file).

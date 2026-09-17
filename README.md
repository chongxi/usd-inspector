# USD Robot Inspector

A browser-only inspector for OpenUSD robot assets, live at **https://chongxi.github.io/usd-inspector/**.

- Stage tree with every prim, its attributes, relationships and metadata
- Joint sliders and presets, driven by the UsdPhysics joint frames (mimic joints follow their leader)
- Joints grouped by body part for any robot: head, waist / torso, left / right arm, hand or gripper (with fingers for dexterous hands), legs (front / rear for quadrupeds) and base / wheels. Groups come from joint and link names plus the kinematic tree, with the robot's geometry as a fallback for unnamed chains. Each group can be collapsed, highlighted in the viewport or set to zero
- Selecting a part (in the viewport or the stage tree) lists the joint above it and the joints below it, including the joint that moves it through fixed joints. Clicking a joint opens its slider in the Joints tab
- Visual, collision, frame, centre-of-mass and camera layers; X-ray, wireframe, section plane and point-to-point measuring
- Automatic checks: articulation root, joint-frame consistency, drives, mass, collisions, metadata, mesh budget
- Robot library streamed from NVIDIA's Isaac Sim 5.1 asset server (the Isaac Lab robot list) and from `enactic/openarm_isaac_lab`
- Open your own `.usd` / `.usda` / `.usdc` / `.usdz`, or a whole folder so references, payloads and sublayers resolve. Files are read in your browser and never uploaded.
- **Download** any loaded robot as USD (the layers it loaded, zipped with their folder layout when there is more than one), URDF (+ STL meshes) or MuJoCo XML (robot + `scene.xml` + STL meshes, position actuators from the drives, a `home` keyframe from the joint state)

## Share links

- `?sample=worker-pi`, `?sample=kakun`, `?sample=kakun-full`, `?sample=panthera-ht`, `?sample=mini-pi-plus`, `?sample=mini-pi-plus-bm`, `?sample=mini-pi`, `?sample=hi`, `?sample=openarm-v2` open a hosted robot
- `?asset=Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd` opens a path on the Isaac Sim 5.1 server; a full `https://` URL also works if that server allows cross-origin requests

## Hosted samples (`samples/`)

| File | What it is |
| --- | --- |
| `worker_pi.usdc.gz` | **Worker Pi**, our variant of the Mini Pi+ Pro with 25 actuated joints. The Pi's wrist motor (HTDW-4438 inside each elbow link) now drives the gripper: Kakun's yellow rail gripper hangs directly under it, pointing at the ground, with the rails running front/back. Kakun's own gripper motor is cut out of its mesh (13 of 27 closed parts). The housing keeps a volume-scaled share of Kakun's palm mass (0.129 kg, an estimate). The Pi gripper is removed, 2 motors fewer in total. Finger drive (kp 3000 N/m, kd 100 N·s/m, 500 N, 0–40 mm per finger; second finger is a mimic joint) comes from `kakun (1).usd`. The rest is as in `mini_pi_plus_pro.usdc`. Built as MJCF with `make_worker_pi.py`, then converted with `mjcf_to_usd.py`. In MuJoCo it stands, opens both grippers and holds a 4 cm, 100 g cube while the arm swings. |
| `kakun_full.usd.gz.001`, `.002` | Kakun, the original USD, gzipped and split in two to fit the web uploader (join them, then gunzip) |
| `kakun_preview.usdc.gz` | Kakun with meshes simplified to at most 0.2 mm error; everything else unchanged |
| `openarm_v2_bimanual.usdc.gz` | OpenArm v2.0 (default bimanual preset, pinch grippers), converted from the URDF in [enactic/openarm_description](https://github.com/enactic/openarm_description) at commit `14ff67b`. Not an official Enactic or NVIDIA asset. Visual meshes simplified to at most 0.15 mm, collision meshes to 0.5 mm (convex hulls). Joint axes are mapped to local +X; the original axis is kept in `urdf:axis`. |
| `panthera_ht.usdc.gz` | HighTorque Panthera-HT 6-axis arm with parallel gripper, from `HighTorque-Robotics/Panthera_HT_ROS2` (`src/panthera_ht_ros_description`, gripper xacro) at `b08633d`. Drive gains from its ros2_control block. |
| `mini_pi_plus_pro.usdc.gz` | HighTorque Mini Pi+ Pro, 27 DOF (12 leg, 10 arm, 2 gripper, 2 head, 1 waist) with a ZED Mini camera link. Converted from the MJCF `PiPlusPro_S_12L10A2G2H1W_ZedMini.xml` published with [hanyang9/UMR](https://github.com/hanyang9/UMR) at `e24fc07` (meshes from its GitHub Pages copy, checked against the repo's LFS hashes). Collision shapes are the MJCF boxes and cylinders; inertias, joint limits, torque limits (`actuatorfrcrange`) and joint damping come from the MJCF. Drive gains, armature and velocity limits for the legs, feet and arms come from HighTorque's [Mini-Pi-Plus_BeyondMimic](https://github.com/HighTorque-Robotics/Mini-Pi-Plus_BeyondMimic) `robots/pi_plus.py`. The waist, head and gripper gains are **assumed placeholders** (waist uses the leg values, head and grippers kp 10 / kd 0.2) because no HighTorque source lists them. Authored joint state = that repo's standing stance. Replaces the earlier `mini_pi_plus_24dof.usdc.gz` (from `robot_urdf`, no waist or grippers), which the page no longer lists. |
| `mini_pi_plus_bm20.usdc.gz` | HighTorque Mini Pi+ as used by [Mini-Pi-Plus_BeyondMimic](https://github.com/HighTorque-Robotics/Mini-Pi-Plus_BeyondMimic) (`pi_plus_20dof.urdf` at `df3fcf1`): 20 actuated joints, head fixed, no waist or grippers. Drives use that repo's Isaac Lab `PI_PLUS_CFG` exactly (stiffness, damping, armature, effort and velocity limits); joint state = its `init_state`. The URDF's own effort/velocity stay in `urdf:effort` / `urdf:velocity`. |
| `mini_pi_12dof.usdc.gz` | HighTorque Mini Pi (12 DOF), same repo (`pi_12dof`). Authored joint state = the training stance listed in that repo's README. |
| `hi_25dof.usdc.gz` | HighTorque Hi (25 DOF), same repo (`hi_25dof`). |

The OpenArm, Panthera-HT, Mini Pi and Hi files were converted from the manufacturers' URDFs with `urdf_to_usd.py`, and Mini Pi+ Pro and Worker Pi from MJCF with `mjcf_to_usd.py`, which compiles the model with MuJoCo 3 first. Both scripts were written for this site; none of these files is an official asset. Visual meshes are simplified to at most 0.25 mm (HighTorque) or 0.15 mm (OpenArm), collision meshes to 0.5 mm as convex hulls; URDF box/cylinder/sphere collisions stay analytic. Joint axes are mapped to local +X (the original is kept in `urdf:axis`); mimic joints use `PhysxMimicJointAPI:rotX`. Where the source has no gains, drives carry only the URDF effort limit. In every converted robot, link poses match the source's forward kinematics (URDF, or MuJoCo for the MJCF) to within 1e-7 m over random joint configurations. MJCF joint terms are also kept verbatim as `mjc:damping`, `mjc:frictionloss`, `mjc:armature` and `mjc:actuatorfrcrange`.

## Download formats

URDF and MuJoCo XML are generated in the browser from the loaded USD, for any robot, including your own files and streamed Isaac assets:

- Kinematics come from the UsdPhysics joints (`localPos/Rot0/1` and the axis token). Each exported link frame sits on its parent joint's axis, so link origins can differ from the USD prims while every pose matches.
- Mass, centre of mass and principal inertia come from `MassAPI`. Drive stiffness and damping are converted from per-degree to per-radian. `maxForce` becomes the URDF effort and the MuJoCo force range, and `physxJoint:maxJointVelocity` becomes the URDF velocity. Armature, damping and friction are kept where authored.
- Cube, sphere, cylinder and capsule prims stay primitives; URDF has no capsule, so it gets a cylinder plus two spheres. Meshes are binary STL in metres, exactly as the page displays them.
- MuJoCo files: visual geoms are group 2 and collision geoms group 3. Mimic joints become joint equalities. A floating base starts with its lowest collision geometry on the floor.
- A README inside each zip lists what the USD did not author, such as massless moving links or missing torque limits.

Checked on every hosted sample, a Y-up centimetre test stage and the Isaac Sim OpenArm asset. Forward kinematics agree with the USD to within 1e-8 m, both in MuJoCo and with an independent URDF parser. Masses match, MuJoCo compiles both files, and 1 s of simulation stays finite.

## Notes

- USD is read by [three-usd-robot](https://github.com/neka-nat/three-usd-robot) 0.14.1 (MIT), bundled into `index.html` with two fixes: internal references into sublayers (Isaac Sim 5.x collision layers) and `PhysxMimicJointAPI:rot*` instances on prismatic joints. It is a pragmatic composer, not the full OpenUSD engine.
- Rendering uses [three.js](https://threejs.org) r186 (MIT) from jsDelivr; gzip decoding uses the browser's DecompressionStream; [fflate](https://github.com/101arrowz/fflate) (MIT) is bundled for `.usdz`.
- OpenArm meshes are © Enactic, Inc. (Apache-2.0). Panthera-HT description © 2026 HighTorque Robotics (MIT, per `Panthera_HT_ROS2/LICENSE`). Mini Pi and Hi descriptions are from HighTorque Robotics' `robot_urdf`, whose `package.xml` files declare a BSD license (the repo has no separate LICENSE file). The BeyondMimic model comes from `HighTorque-Robotics/Mini-Pi-Plus_BeyondMimic`, whose LICENCE file is the MIT licence text of its Isaac Lab template. The Mini Pi+ Pro model is HighTorque's robot as redistributed in `hanyang9/UMR`, which has no license file; it is used here for inspection only.

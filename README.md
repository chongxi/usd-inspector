# USD Robot Inspector

A browser-only inspector for OpenUSD robot assets, live at **https://chongxi.github.io/usd-inspector/**.

- Stage tree with every prim, its attributes, relationships and metadata
- Joint sliders and presets, driven by the UsdPhysics joint frames (mimic joints follow their leader)
- Joints grouped by body part for any robot: head, waist / torso, left / right arm, hand or gripper (with fingers for dexterous hands), legs (front / rear for quadrupeds) and base / wheels. Groups come from joint and link names plus the kinematic tree, with the robot's geometry as a fallback for unnamed chains. Each group can be collapsed, highlighted in the viewport or set to zero
- Selecting a part (in the viewport or the stage tree) lists the joint above it and the joints below it, including the joint that moves it through fixed joints. Clicking a joint opens its slider in the Joints tab
- **One reach task, one whole-body controller** (no physics, but no impossible movement either): the goal is a sphere you drag anywhere in the scene, and you pick which end-effector has to get inside it (each gripper's finger midpoint, or an arm's last link).
  - **The plan comes first, from the workspace.** 500 arm poses are sampled once in the robot's own stance and recorded in the base frame, and the base's squat range is measured by solving the legs with the feet planted. Height, distance and facing then decide the answer before anything moves: a sphere out of reach is reported as out of reach — "206 mm too high: with the feet on the floor this arm covers 162–844 mm, including 100 mm of squat" — instead of being half-attempted.
  - **Getting there is a real gait.** A wheeled base turns in place, drives, then turns again, because no chassis slides sideways, and its wheels turn exactly the distance their contact point covers. A legged base walks: one foot at a time, the centre of mass shifted over the feet that stay down, every frame solved rather than interpolated, and the body carried along by the planted feet. If the legs would swing into arms hanging at the side, the arms are tucked first — the posture is searched against the walk that was actually generated. Then the robot looks again from where it now stands, and takes another step or two if the body ended up short.
  - **The reach is solved frame by frame**, feet pinned, base free, centre of mass held over the support polygon, and a pose that puts a link through the floor is lifted and re-solved. If a straight line to the target takes the arm through the robot, the path bows around; if the arm locks at a limit short of the target, another posture is searched for and moved to.
  - **Every frame is then checked and the result is reported, not asserted**: joint limits, the floor the robot stands on in its authored pose, self-collision (boxes around the colliders, with the pairs that already touch in that pose ignored), the centre of mass against the polygon the feet cover, planted contacts that may lift off or stay put but not slide, and the authored velocity limits — frames are inserted where the motion would have been too fast, so the clip stays at 30 fps and simply takes longer. What cannot be done legally is named: a small biped that cannot bring its centre of mass over one foot is told it needs a **dynamic** gait, because geometry cannot certify that one, and the shortfall is given in millimetres.
  - The support polygon and the centre of mass are drawn on the floor while the tab is open. Damped least squares on the analytic Jacobian, with a centre-of-mass Jacobian for balance. Tick "follow the sphere while I drag it" for live IK while dragging.
- **Motion**: a timeline with keyframes (pose the robot, store a key, Catmull-Rom between keys), playback with speed and loop, and export as CSV or JSON. A planned reach lands on the same timeline as a clip, so you can scrub it, replay it or export it. Import a joint trajectory from a retargeting or simulation pipeline — CSV, JSON or `.npz` (the BeyondMimic layout: `fps`, `joint_pos`, `body_pos_w`, `body_quat_w`) — read in the browser, with a panel to map file columns onto robot joints. The viewport can be recorded to a `.webm`.
- Visual, collision, frame, centre-of-mass and camera layers; X-ray, wireframe, section plane and point-to-point measuring
- Automatic checks: articulation root, joint-frame consistency, drives, mass, collisions, metadata, mesh budget
- Robot library streamed from NVIDIA's Isaac Sim 5.1 asset server (the Isaac Lab robot list) and from `enactic/openarm_isaac_lab`
- **Environment workspace**: load the complete Astera office USDZ alongside the selected robot. Swap library robots without losing the office or placement; place arms on tables, use the existing joint/Reach/Motion controls, or drive wheeled robots with W/A/S/D or the on-screen buttons.
- Open your own `.usd` / `.usda` / `.usdc` / `.usdz`, or a whole folder so references, payloads and sublayers resolve. Files are read in your browser and never uploaded.
- **Download** any loaded robot as USD (the layers it loaded, zipped with their folder layout when there is more than one), URDF (+ STL meshes) or MuJoCo XML (robot + `scene.xml` + STL meshes, position actuators from the drives, a `home` keyframe from the joint state)

## Share links

- `?sample=worker-pi`, `?sample=kakun`, `?sample=kakun-full`, `?sample=panthera-ht`, `?sample=mini-pi-plus`, `?sample=mini-pi-plus-bm`, `?sample=mini-pi`, `?sample=hi`, `?sample=openarm-v2` open a hosted robot
- `?asset=Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd` opens a path on the Isaac Sim 5.1 server; a full `https://` URL also works if that server allows cross-origin requests
- [`?sample=kakun&environment=astera`](https://chongxi.github.io/usd-inspector/?sample=kakun&environment=astera) opens Kakun in the Astera office. Replace `kakun` with any hosted sample, or combine `environment=astera` with an `asset` URL.
- Optional `pose=x,y,z,heading` uses metres and heading in degrees, in a Z-up, X-forward world. `z` is the support surface height: the robot's lowest authored visual point is placed there. Astera defaults to `2.678,4.525414,0,0`.
- `environment=https://…/scene.usdz` loads another environment from a server allowing cross-origin requests. **Copy link** includes the environment and robot placement. Local files are never uploaded; their sessions cannot be shared by URL.

## Place and control a robot in Astera

1. Open **Environment → Astera office**, or use **Open USDZ…** inside that panel for a local environment. The top bar's **Open file…** continues to replace the robot.
2. Choose a robot from **Robot library**. All robot types can be placed; switching the robot keeps the environment and the selected location.
3. Enter X, Y, support height and heading, or choose **Click to place** and click an upward-facing floor/tabletop. **Follow robot** recentres the camera; **View environment** shows the full office. The ceiling is hidden initially for interior inspection and can be shown without changing the asset.
4. For a wheeled base, enable **Keyboard drive** and hold W/A/S/D or the arrow keys, or hold the on-screen direction buttons. Release, press Stop/Escape, close the panel, or leave the page to stop. Editing a position or joint field does not drive the robot. Other robots use placement and the existing Joints, Reach and Motion controls.

**Download environment** in the Environment panel offers **USDZ · single file** and **USD + textures · ZIP**. Before loading a scene these download Astera; after loading they download that environment. Both exclude the selected robot and preserve the original environment, including its physics and appliance joints. The ZIP contains the package's original USD and all embedded files with their paths preserved—extract the whole ZIP before opening the USD. Ceiling visibility and robot movement do not change either download. The top-bar **Download** button remains the robot exporter.

[Download the standalone Astera USDZ directly](samples/environments/astera_office_2f.usdz).

This is a browser kinematic preview. Environment geometry is static at its authored pose: appliance doors, drawers and loose objects are displayed but are not interactive here. There is no environment collision response, physical grasping, gravity, or connection to Isaac Lab. Existing Reach checks concern the robot and its support plane; they do not plan around office furniture. The USDZ retains its original joints and physics for use in a simulator. Robot downloads and motion exports still refer to the selected robot, not a merged robot/environment stage.

Environment loading uses the USD default-prim subtree, including visible collision-enabled geometry, metres-per-unit, up-axis and embedded textures. Identical opaque meshes are instanced to reduce draw calls. Materials use the inspector's three.js lighting; authored Isaac/MDL lighting is not reproduced exactly. The bundled USD reader supports a subset of OpenUSD. For reliable local sharing, use a self-contained USDZ; a loose local USD with external files requires packaging first.

## Run locally and test

```sh
python3 -m http.server 8088
# Open http://localhost:8088/?sample=kakun&environment=astera
```

No application build step or simulation server is required. Serve the repository root, including `src/` and `samples/`; copying only `index.html` is insufficient. three.js is fetched from jsDelivr as before.

```sh
npm ci
npm test
npx playwright install chromium  # unnecessary if Google Chrome is already installed
npm run test:browser
```

The browser test serves its own local site, opens the real Astera USDZ, checks textures, driving/stopping, placement, robot replacement, local file loading and failure recovery. Set `CHROMIUM_EXECUTABLE` for a custom browser path or `EVIDENCE_DIR` for screenshots and the JSON report; the default output is ignored `results/environment-browser/`.

## Hosted samples (`samples/`)

| File | What it is |
| --- | --- |
| `environments/astera_office_2f.usdz` | Astera office 2F, the standalone 2026-09-18 export from `Kakun_Curobov2`, with furniture/appliances and 17 embedded textures; no robot or external file dependencies. See [asset provenance](samples/environments/README.md). |
| `worker_pi.usdc.gz` | **Worker Pi**, our variant of the Mini Pi+ Pro with 27 actuated joints. Each arm keeps the Pi's wrist motor (HTDW-4438), so the gripper rolls about the wrist axis (-2.8 … 3.1 rad); Kakun's yellow rail gripper — with its own motor, as Kakun ships it — hangs under the wrist, approach pointing at the ground and the rails running front/back. The Pi's own gripper is removed, together with the lower part of the wrist link that carried its fixed jaw (cut at z = -44 mm; the kept piece is 66.0% of the link's volume, 0.189 kg by uniform density). Kakun's palm with its motor is 0.240 kg from `kakun (1).usd`, as are the finger drive (kp 3000 N/m, kd 100 N·s/m, 500 N, 0–40 mm per finger; the second finger is a mimic joint) and the finger inertias. The rest is as in `mini_pi_plus_pro.usdc`. Built as MJCF with `make_worker_pi.py`, then converted with `mjcf_to_usd.py`. In MuJoCo it stands (0.2° tilt), opens both grippers clear of the legs and floor, holds a 4 cm, 100 g cube while the arm swings, and the wrist rolls the loaded gripper. With the arm hanging at the side, rolling the gripper ±90° runs the 158 mm rails into the thigh — real interference, so roll with the arm out. |
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

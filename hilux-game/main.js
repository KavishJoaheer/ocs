import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 1. Initialize Three.js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 20, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// 2. Initialize Cannon-es
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
});
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.5;

// Ground
const groundMaterial = new CANNON.Material('ground');
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
groundBody.addShape(groundShape);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const groundGeo = new THREE.PlaneGeometry(200, 200);
const gridTexture = new THREE.GridHelper(200, 200);
gridTexture.position.y = 0.01;
scene.add(gridTexture);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x336633, roughness: 0.8 });
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Add Obstacles
function addObstacle(x, z, width, height, depth, color) {
    const shape = new CANNON.Box(new CANNON.Vec3(width/2, height/2, depth/2));
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(shape);
    body.position.set(x, height/2, z);
    world.addBody(body);

    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(body.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}
addObstacle(10, 10, 2, 2, 2, 0xff0000);
addObstacle(-10, 15, 3, 4, 3, 0x0000ff);
addObstacle(15, -10, 4, 1, 4, 0xffff00);
addObstacle(-15, -15, 2, 5, 2, 0xff00ff);

// 3. Car setup
const textureLoader = new THREE.TextureLoader();
const texFront = textureLoader.load('/textures/car_front.png');
const texBack = textureLoader.load('/textures/car_back.png');
const texSide = textureLoader.load('/textures/car_side.png');
const texTop = textureLoader.load('/textures/car_top.png');

texFront.colorSpace = THREE.SRGBColorSpace;
texBack.colorSpace = THREE.SRGBColorSpace;
texSide.colorSpace = THREE.SRGBColorSpace;
texTop.colorSpace = THREE.SRGBColorSpace;

const chassisWidth = 2.0;
const chassisHeight = 1.0;
const chassisLength = 5.0;

const carMaterials = [
    new THREE.MeshStandardMaterial({ map: texSide }), // Right
    new THREE.MeshStandardMaterial({ map: texSide }), // Left
    new THREE.MeshStandardMaterial({ map: texTop }),  // Top
    new THREE.MeshStandardMaterial({ color: 0x222222 }), // Bottom
    new THREE.MeshStandardMaterial({ map: texFront }), // Front
    new THREE.MeshStandardMaterial({ map: texBack })   // Back
];

const chassisGeo = new THREE.BoxGeometry(chassisWidth, chassisHeight, chassisLength);
const chassisMesh = new THREE.Mesh(chassisGeo, carMaterials);
chassisMesh.castShadow = true;
scene.add(chassisMesh);

const chassisShape = new CANNON.Box(new CANNON.Vec3(chassisWidth/2, chassisHeight/2, chassisLength/2));
const chassisBody = new CANNON.Body({ mass: 1500 });
chassisBody.addShape(chassisShape, new CANNON.Vec3(0, chassisHeight/2, 0));
chassisBody.position.set(0, 1, 0);

const vehicle = new CANNON.RaycastVehicle({
    chassisBody: chassisBody,
});

const wheelOptions = {
    radius: 0.4,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 30,
    suspensionRestLength: 0.3,
    frictionSlip: 5,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
};

const w1 = chassisWidth / 2;
const l1 = chassisLength / 2 - 0.5;
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-w1, 0, l1) }); // Front Left
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(w1, 0, l1) }); // Front Right
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-w1, 0, -l1) }); // Back Left
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(w1, 0, -l1) }); // Back Right

vehicle.addToWorld(world);

const wheelMeshes = [];
const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 20);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    const wheelMesh = new THREE.Mesh(wheelGeo, wheelMat);
    wheelMesh.castShadow = true;
    scene.add(wheelMesh);
    wheelMeshes.push(wheelMesh);
}

// Controls
const keys = { w: false, a: false, s: false, d: false, arrowup: false, arrowdown: false, arrowleft: false, arrowright: false };
window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});

// Animation Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.1);
    
    // Update physics
    const maxSteerVal = 0.5;
    const maxForce = 1500;
    const brakeForce = 10;

    let engineForce = 0;
    let steeringValue = 0;

    if (keys.w || keys.arrowup) engineForce = -maxForce;
    if (keys.s || keys.arrowdown) engineForce = maxForce;
    if (keys.a || keys.arrowleft) steeringValue = maxSteerVal;
    if (keys.d || keys.arrowright) steeringValue = -maxSteerVal;

    vehicle.applyEngineForce(engineForce, 2);
    vehicle.applyEngineForce(engineForce, 3);
    
    vehicle.setSteeringValue(steeringValue, 0);
    vehicle.setSteeringValue(steeringValue, 1);

    if (engineForce === 0) {
       vehicle.setBrake(brakeForce, 2);
       vehicle.setBrake(brakeForce, 3);
    } else {
       vehicle.setBrake(0, 2);
       vehicle.setBrake(0, 3);
    }

    world.step(1/60, dt, 3);

    // Sync mesh with physics body
    chassisMesh.position.copy(chassisBody.position);
    chassisMesh.quaternion.copy(chassisBody.quaternion);

    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
        vehicle.updateWheelTransform(i);
        const t = vehicle.wheelInfos[i].worldTransform;
        wheelMeshes[i].position.copy(t.position);
        wheelMeshes[i].quaternion.copy(t.quaternion);
    }

    // Camera follow
    const relativeCameraOffset = new THREE.Vector3(0, 3, 8);
    const cameraOffset = relativeCameraOffset.applyMatrix4(chassisMesh.matrixWorld);
    camera.position.lerp(cameraOffset, 0.1);
    camera.lookAt(chassisMesh.position);

    renderer.render(scene, camera);
}

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();

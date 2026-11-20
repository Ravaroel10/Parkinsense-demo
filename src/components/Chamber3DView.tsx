/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Layers, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

export interface Chamber3DViewProps {
  isConnected?: boolean;
  isStabilizing?: boolean;
  isRecording?: boolean;
  hasSample?: boolean;
  isLidOpen?: boolean;
  isPurging?: boolean;
  filterMounted?: boolean;
  activeSensor?: number | null; // null = all, 1-4 = specific channel
  onSelectSensor?: (sensor: number | null) => void;
  focusTarget?: 'iso' | 'sensors' | 'esp32' | 'top';
  className?: string;
}

type CameraPreset = 'iso' | 'sensors' | 'esp32' | 'top';

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { pos: [3.6, 2.75, 4.1], target: [0.25, 0.72, 0.05] },
  sensors: { pos: [2.15, 1.85, 2.35], target: [0, 0.92, 0] },
  esp32: { pos: [2.7, 1.35, 2.4], target: [1.35, 0.25, 0.45] },
  top: { pos: [0.15, 4.6, 1.1], target: [0.15, 0.65, 0] },
};

// Reusable math objects outside render loop (zero GC churn)
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createBaseAlignmentTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d4d4d8';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle brushed metal grain
  for (let y = 0; y < 512; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(0, y, 512, 1);
  }

  // Calibration grid markings
  ctx.strokeStyle = 'rgba(24, 24, 27, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(256, 256, 140, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(256, 256, 98, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosshair axes
  ctx.strokeStyle = 'rgba(24, 24, 27, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(76, 256);
  ctx.lineTo(436, 256);
  ctx.moveTo(256, 76);
  ctx.lineTo(256, 436);
  ctx.stroke();

  // Corner sensor alignment markings
  ctx.fillStyle = '#27272a';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CH1', 120, 128);
  ctx.fillText('CH2', 392, 128);
  ctx.fillText('CH3', 120, 396);
  ctx.fillText('CH4', 392, 396);

  ctx.font = '600 12px monospace';
  ctx.fillStyle = '#52525b';
  ctx.fillText('PARKINSENSE HEADSPACE STAGE', 256, 466);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createEspLabelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d4d4d8';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#a1a1aa';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 120);

  ctx.fillStyle = '#18181b';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ESP32-WROOM', 128, 56);
  ctx.font = '600 15px monospace';
  ctx.fillStyle = '#52525b';
  ctx.fillText('I2C MUX TELEMETRY', 128, 86);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 124);
  grad.addColorStop(0, 'rgba(9, 9, 11, 0.28)');
  grad.addColorStop(0.55, 'rgba(9, 9, 11, 0.10)');
  grad.addColorStop(1, 'rgba(9, 9, 11, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.65)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRoundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export default function Chamber3DView({
  isConnected = false,
  isStabilizing = false,
  isRecording = false,
  hasSample = true,
  isLidOpen = false,
  isPurging = false,
  filterMounted = true,
  activeSensor = null,
  onSelectSensor,
  focusTarget = 'iso',
  className = '',
}: Chamber3DViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<CameraPreset>(focusTarget);
  const [manualExploded, setManualExploded] = useState(false);
  const [internalSensor, setInternalSensor] = useState<number | null>(activeSensor);
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const selectedSensor = activeSensor !== undefined ? activeSensor : internalSensor;

  // Mutable state ref for Three.js loop without re-initializing WebGL context
  const stateRef = useRef({
    isConnected,
    isStabilizing,
    isRecording,
    hasSample,
    isLidOpen,
    isPurging,
    filterMounted,
    selectedSensor,
    manualExploded,
    preset,
    cameraTransitioning: false,
  });

  const triggerCameraRef = useRef<((nextPreset: CameraPreset) => void) | null>(null);
  const triggerRenderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setPreset(focusTarget);
    if (triggerCameraRef.current) {
      triggerCameraRef.current(focusTarget);
    }
  }, [focusTarget]);

  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      isConnected,
      isStabilizing,
      isRecording,
      hasSample,
      isLidOpen,
      isPurging,
      filterMounted,
      selectedSensor,
      manualExploded,
      preset,
    };
    triggerRenderRef.current?.();
  }, [
    isConnected,
    isStabilizing,
    isRecording,
    hasSample,
    isLidOpen,
    isPurging,
    filterMounted,
    selectedSensor,
    manualExploded,
    preset,
  ]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const width = container.clientWidth || 460;
    const height = container.clientHeight || 360;

    // 1. Scene & Studio Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f5);
    scene.fog = new THREE.Fog(0xf4f4f5, 9, 20);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 45);
    const initialCam = CAMERA_PRESETS[stateRef.current.preset as CameraPreset] || CAMERA_PRESETS.iso;
    camera.position.set(initialCam.pos[0], initialCam.pos[1], initialCam.pos[2]);

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // 4. Studio Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();
    track(envTarget);

    // 5. Studio 3-Point Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0xd4d4d8, 0.72);
    hemiLight.position.set(0, 8, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.55);
    keyLight.position.set(4.5, 6.5, 4.2);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 16;
      const d = 3.2;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.7);
    rimLight.position.set(-4.2, 3.8, -3.5);
    scene.add(rimLight);

    // 6. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(initialCam.target[0], initialCam.target[1], initialCam.target[2]);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = 1.8;
    controls.maxDistance = 8.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.update();

    // 7. Lab Bench Surface & Grounded Contact Shadow
    const benchGeo = track(new THREE.PlaneGeometry(24, 24));
    const benchMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf4f4f5,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    const benchMesh = new THREE.Mesh(benchGeo, benchMat);
    benchMesh.rotation.x = -Math.PI / 2;
    benchMesh.position.y = -0.02;
    benchMesh.receiveShadow = !isSoftwareGl;
    scene.add(benchMesh);

    const shadowTex = track(createContactShadowTexture());
    const contactPlaneGeo = track(new THREE.PlaneGeometry(4.4, 3.6));
    const contactPlaneMat = track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      })
    );
    const contactPlane = new THREE.Mesh(contactPlaneGeo, contactPlaneMat);
    contactPlane.rotation.x = -Math.PI / 2;
    contactPlane.position.set(0.35, -0.01, 0.1);
    scene.add(contactPlane);

    // Subtle coordinate grid on lab bench
    const gridHelper = new THREE.GridHelper(12, 24, 0xd4d4d8, 0xe4e4e7);
    gridHelper.position.y = -0.015;
    scene.add(gridHelper);

    // =========================================================================
    // 8. COMPOSITE APPARATUS ASSEMBLY (10+ Sub-Assemblies)
    // =========================================================================
    const apparatus = new THREE.Group();
    scene.add(apparatus);

    // Materials library
    const brushedAluminumMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xd4d4d8,
        metalness: 0.86,
        roughness: 0.26,
        anisotropy: 0.75,
      })
    );
    const darkAnodizedMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x27272a,
        metalness: 0.72,
        roughness: 0.34,
      })
    );
    const rubberMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x18181b,
        metalness: 0.05,
        roughness: 0.9,
      })
    );
    const ceramicMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.16,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
      })
    );
    const pcbGreenMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x065f46,
        metalness: 0.15,
        roughness: 0.48,
      })
    );
    const pcbDarkMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.18,
        roughness: 0.52,
      })
    );
    const sensorCapMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xe4e4e7,
        metalness: 0.92,
        roughness: 0.18,
      })
    );
    const goldPinMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.95,
        roughness: 0.22,
      })
    );
    const acrylicGlassMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xeaf6f6,
        metalness: 0.0,
        roughness: 0.06,
        transmission: isSoftwareGl ? 0 : 0.86,
        transparent: true,
        opacity: isSoftwareGl ? 0.26 : 0.95,
        ior: 1.49,
        thickness: 0.15,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        depthWrite: false,
      })
    );

    // 8A. Chamber Base Plinth (Beveled ExtrudeGeometry) + Feet + Alignment Plate
    const baseGroup = new THREE.Group();
    apparatus.add(baseGroup);

    const baseShape = createRoundedRectShape(2.15, 2.15, 0.14);
    const baseGeo = track(
      new THREE.ExtrudeGeometry(baseShape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.025,
        bevelSegments: 3,
      })
    );
    baseGeo.rotateX(-Math.PI / 2);
    const baseMesh = new THREE.Mesh(baseGeo, darkAnodizedMat);
    baseMesh.position.y = 0.04;
    baseMesh.castShadow = !isSoftwareGl;
    baseMesh.receiveShadow = !isSoftwareGl;
    baseGroup.add(baseMesh);

    // Alignment plate top graphic
    const alignTex = track(createBaseAlignmentTexture(maxAniso));
    const alignPlateGeo = track(new THREE.PlaneGeometry(1.94, 1.94));
    const alignPlateMat = track(
      new THREE.MeshStandardMaterial({
        map: alignTex,
        roughness: 0.35,
        metalness: 0.3,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    const alignPlate = new THREE.Mesh(alignPlateGeo, alignPlateMat);
    alignPlate.rotation.x = -Math.PI / 2;
    alignPlate.position.y = 0.186;
    alignPlate.receiveShadow = !isSoftwareGl;
    baseGroup.add(alignPlate);

    // 4 rubber feet
    const footGeo = track(new THREE.CylinderGeometry(0.08, 0.09, 0.04, 16));
    const footOffsets: Array<[number, number]> = [
      [-0.86, -0.86],
      [0.86, -0.86],
      [-0.86, 0.86],
      [0.86, 0.86],
    ];
    for (const [fx, fz] of footOffsets) {
      const foot = new THREE.Mesh(footGeo, rubberMat);
      foot.position.set(fx, 0.02, fz);
      baseGroup.add(foot);
    }

    // 8B. Central Ceramic Sample Dish + Sebum Cotton Swab
    const dishPoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.42, 0.0),
      new THREE.Vector2(0.46, 0.05),
      new THREE.Vector2(0.46, 0.09),
      new THREE.Vector2(0.39, 0.09),
      new THREE.Vector2(0.36, 0.03),
      new THREE.Vector2(0.0, 0.03),
    ];
    const dishGeo = track(new THREE.LatheGeometry(dishPoints, 32));
    const dishMesh = new THREE.Mesh(dishGeo, ceramicMat);
    dishMesh.position.set(0, 0.188, 0);
    dishMesh.castShadow = !isSoftwareGl;
    dishMesh.receiveShadow = !isSoftwareGl;
    apparatus.add(dishMesh);

    // Swab assembly (visibility driven by hasSample)
    const swabGroup = new THREE.Group();
    swabGroup.position.set(0, 0.235, 0);
    apparatus.add(swabGroup);

    const stickGeo = track(new THREE.CylinderGeometry(0.015, 0.015, 0.52, 12));
    const stickMat = track(
      new THREE.MeshStandardMaterial({ color: 0xe7d3b0, roughness: 0.72, metalness: 0.0 })
    );
    const stickMesh = new THREE.Mesh(stickGeo, stickMat);
    stickMesh.rotation.z = Math.PI / 2 - 0.14;
    stickMesh.position.set(0.11, 0.04, 0);
    stickMesh.castShadow = !isSoftwareGl;
    swabGroup.add(stickMesh);

    const cottonGeo = track(new THREE.SphereGeometry(0.068, 20, 16));
    cottonGeo.scale(1.65, 0.85, 0.85);
    const cottonMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xfef3c7,
        roughness: 0.94,
        metalness: 0.0,
      })
    );
    const cottonMesh = new THREE.Mesh(cottonGeo, cottonMat);
    cottonMesh.position.set(-0.14, 0.01, 0);
    cottonMesh.castShadow = !isSoftwareGl;
    swabGroup.add(cottonMesh);

    // 8C. PCA9548A I2C Multiplexer Module inside chamber
    const muxGroup = new THREE.Group();
    muxGroup.position.set(0, 0.21, -0.68);
    apparatus.add(muxGroup);

    const muxBoard = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.03, 0.30)), pcbDarkMat);
    muxBoard.castShadow = !isSoftwareGl;
    muxGroup.add(muxBoard);

    const muxIc = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.025, 0.14)), rubberMat);
    muxIc.position.y = 0.025;
    muxGroup.add(muxIc);

    // 8D. 4x BME680 Sensor Modules (CH1..CH4) on Vertical Standoffs
    const sensorCoords: Array<{ id: number; pos: [number, number, number]; rotY: number }> = [
      { id: 1, pos: [-0.68, 0.92, -0.68], rotY: Math.PI / 4 },
      { id: 2, pos: [0.68, 0.92, -0.68], rotY: -Math.PI / 4 },
      { id: 3, pos: [-0.68, 0.64, 0.68], rotY: (3 * Math.PI) / 4 },
      { id: 4, pos: [0.68, 0.64, 0.68], rotY: -(3 * Math.PI) / 4 },
    ];

    const sensorEntries: Array<{
      id: number;
      group: THREE.Group;
      ledMat: THREE.MeshStandardMaterial;
      heaterMat: THREE.MeshStandardMaterial;
      baseY: number;
    }> = [];

    const standoffGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 1, 12));
    const pcbGeo = track(new THREE.BoxGeometry(0.26, 0.24, 0.028));
    const bmeCapGeo = track(new THREE.BoxGeometry(0.095, 0.095, 0.032));
    const ledGeo = track(new THREE.SphereGeometry(0.018, 12, 12));
    const heaterRingGeo = track(new THREE.TorusGeometry(0.06, 0.008, 8, 20));

    for (const sc of sensorCoords) {
      const postHeight = sc.pos[1] - 0.18;
      const post = new THREE.Mesh(standoffGeo, brushedAluminumMat);
      post.scale.set(1, postHeight, 1);
      post.position.set(sc.pos[0], 0.18 + postHeight / 2, sc.pos[2]);
      post.castShadow = !isSoftwareGl;
      apparatus.add(post);

      const sensorGroup = new THREE.Group();
      sensorGroup.position.set(sc.pos[0], sc.pos[1], sc.pos[2]);
      sensorGroup.rotation.y = sc.rotY;
      sensorGroup.userData.sensorId = sc.id;
      apparatus.add(sensorGroup);

      const pcb = new THREE.Mesh(pcbGeo, pcbGreenMat);
      pcb.castShadow = !isSoftwareGl;
      pcb.userData.sensorId = sc.id;
      sensorGroup.add(pcb);

      const bmeCap = new THREE.Mesh(bmeCapGeo, sensorCapMat);
      bmeCap.position.set(-0.02, 0.015, 0.024);
      bmeCap.userData.sensorId = sc.id;
      sensorGroup.add(bmeCap);

      // Gold header pins at bottom of sensor PCB
      for (let p = -1; p <= 1; p++) {
        const pin = new THREE.Mesh(track(new THREE.BoxGeometry(0.018, 0.04, 0.018)), goldPinMat);
        pin.position.set(p * 0.05, -0.11, 0.02);
        sensorGroup.add(pin);
      }

      const ledMat = track(
        new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          emissive: 0x000000,
          emissiveIntensity: 0,
          roughness: 0.3,
        })
      );
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(0.075, 0.075, 0.022);
      sensorGroup.add(led);

      const heaterMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xf59e0b,
          emissiveIntensity: 0,
          transparent: true,
          opacity: 0.0,
        })
      );
      const heaterRing = new THREE.Mesh(heaterRingGeo, heaterMat);
      heaterRing.position.set(-0.02, 0.015, 0.042);
      sensorGroup.add(heaterRing);

      sensorEntries.push({
        id: sc.id,
        group: sensorGroup,
        ledMat,
        heaterMat,
        baseY: sc.pos[1],
      });
    }

    // 8E. Corner Acrylic Support Pillars & Outer Enclosure
    const pillarGeo = track(new THREE.CylinderGeometry(0.028, 0.028, 1.24, 14));
    const pillarCoords: Array<[number, number]> = [
      [-0.95, -0.95],
      [0.95, -0.95],
      [-0.95, 0.95],
      [0.95, 0.95],
    ];
    for (const [px, pz] of pillarCoords) {
      const pillar = new THREE.Mesh(pillarGeo, brushedAluminumMat);
      pillar.position.set(px, 0.80, pz);
      pillar.castShadow = !isSoftwareGl;
      apparatus.add(pillar);
    }

    // Acrylic wall panels (4 vertical panes, depthWrite: false, renderOrder: 10)
    const wallGeoX = track(new THREE.BoxGeometry(1.9, 1.20, 0.024));
    const wallGeoZ = track(new THREE.BoxGeometry(0.024, 1.20, 1.9));

    const frontWall = new THREE.Mesh(wallGeoX, acrylicGlassMat);
    frontWall.position.set(0, 0.79, 0.95);
    frontWall.renderOrder = 10;
    apparatus.add(frontWall);

    const backWall = new THREE.Mesh(wallGeoX, acrylicGlassMat);
    backWall.position.set(0, 0.79, -0.95);
    backWall.renderOrder = 10;
    apparatus.add(backWall);

    const leftWall = new THREE.Mesh(wallGeoZ, acrylicGlassMat);
    leftWall.position.set(-0.95, 0.79, 0);
    leftWall.renderOrder = 10;
    apparatus.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeoZ, acrylicGlassMat);
    rightWall.position.set(0.95, 0.79, 0);
    rightWall.renderOrder = 10;
    apparatus.add(rightWall);

    // 8F. Animated Canopy Lid + Charcoal Air Filter Cartridge
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 1.41, 0);
    apparatus.add(lidGroup);

    const lidRimShape = createRoundedRectShape(2.04, 2.04, 0.12);
    const lidRimGeo = track(
      new THREE.ExtrudeGeometry(lidRimShape, {
        depth: 0.055,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.015,
        bevelSegments: 2,
      })
    );
    lidRimGeo.rotateX(-Math.PI / 2);
    const lidRimMesh = new THREE.Mesh(lidRimGeo, brushedAluminumMat);
    lidRimMesh.castShadow = !isSoftwareGl;
    lidGroup.add(lidRimMesh);

    const lidTopPane = new THREE.Mesh(track(new THREE.BoxGeometry(1.74, 0.025, 1.74)), acrylicGlassMat);
    lidTopPane.position.y = 0.045;
    lidTopPane.renderOrder = 11;
    lidGroup.add(lidTopPane);

    // Charcoal filter cartridge mounted on top center of lid
    const filterGroup = new THREE.Group();
    filterGroup.position.set(0, 0.06, 0);
    lidGroup.add(filterGroup);

    const filterBase = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.24, 0.27, 0.14, 24)),
      darkAnodizedMat
    );
    filterBase.position.y = 0.07;
    filterBase.castShadow = !isSoftwareGl;
    filterGroup.add(filterBase);

    const filterCap = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.18, 0.22, 0.08, 24)),
      brushedAluminumMat
    );
    filterCap.position.y = 0.18;
    filterGroup.add(filterCap);

    const filterRingMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 0.2,
      })
    );
    const filterRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.245, 0.012, 8, 28)),
      filterRingMat
    );
    filterRing.rotation.x = Math.PI / 2;
    filterRing.position.y = 0.135;
    filterGroup.add(filterRing);

    // 8G. External ESP32-WROOM-32E Controller Dock + Ribbon Cables
    const espGroup = new THREE.Group();
    espGroup.position.set(1.52, 0.05, 0.42);
    espGroup.rotation.y = -0.22;
    apparatus.add(espGroup);

    const espDockBase = new THREE.Mesh(track(new THREE.BoxGeometry(0.68, 0.05, 0.96)), darkAnodizedMat);
    espDockBase.position.y = 0.025;
    espDockBase.castShadow = !isSoftwareGl;
    espDockBase.receiveShadow = !isSoftwareGl;
    espGroup.add(espDockBase);

    const espPcb = new THREE.Mesh(track(new THREE.BoxGeometry(0.54, 0.03, 0.84)), pcbDarkMat);
    espPcb.position.y = 0.07;
    espPcb.castShadow = !isSoftwareGl;
    espGroup.add(espPcb);

    const espLabelTex = track(createEspLabelTexture(maxAniso));
    const espShieldMat = track(
      new THREE.MeshStandardMaterial({
        map: espLabelTex,
        metalness: 0.78,
        roughness: 0.25,
      })
    );
    const espShield = new THREE.Mesh(track(new THREE.BoxGeometry(0.36, 0.05, 0.34)), espShieldMat);
    espShield.position.set(0, 0.11, -0.14);
    espShield.castShadow = !isSoftwareGl;
    espGroup.add(espShield);

    const usbPort = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.05, 0.12)), sensorCapMat);
    usbPort.position.set(0, 0.10, 0.39);
    espGroup.add(usbPort);

    const espLedMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 0.5,
      })
    );
    const espLed = new THREE.Mesh(track(new THREE.SphereGeometry(0.022, 12, 12)), espLedMat);
    espLed.position.set(-0.16, 0.095, 0.28);
    espGroup.add(espLed);

    // 4 I2C Cable tubes connecting chamber multiplexer to ESP32 dock
    const cableColors = [0xef4444, 0x18181b, 0x14b8a6, 0xf59e0b];
    cableColors.forEach((col, idx) => {
      const offset = (idx - 1.5) * 0.045;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.22, 0.22, -0.62 + offset),
        new THREE.Vector3(0.95, 0.26, -0.35 + offset),
        new THREE.Vector3(1.18, 0.12, 0.15 + offset),
        new THREE.Vector3(1.36, 0.13, 0.34 + offset),
      ]);
      const tubeGeo = track(new THREE.TubeGeometry(curve, 24, 0.014, 8, false));
      const tubeMat = track(
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.1 })
      );
      const cableMesh = new THREE.Mesh(tubeGeo, tubeMat);
      cableMesh.castShadow = !isSoftwareGl;
      apparatus.add(cableMesh);
    });

    // 8H. Volatile VOC Desorption Particles inside chamber
    const PARTICLE_COUNT = 90;
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleMeta: Array<{ radius: number; angle: number; speed: number; y: number }> = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 0.05 + Math.random() * 0.52;
      const a = Math.random() * Math.PI * 2;
      const y = 0.26 + Math.random() * 0.95;
      particleMeta.push({ radius: r, angle: a, speed: 0.18 + Math.random() * 0.28, y });
      particlePositions[i * 3] = Math.cos(a) * r;
      particlePositions[i * 3 + 1] = y;
      particlePositions[i * 3 + 2] = Math.sin(a) * r;
    }
    const particleGeo = track(new THREE.BufferGeometry());
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleTex = track(createParticleTexture());
    const particleMat = track(
      new THREE.PointsMaterial({
        size: 0.085,
        map: particleTex,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        color: 0x14b8a6,
      })
    );
    const particles = new THREE.Points(particleGeo, particleMat);
    apparatus.add(particles);

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // =========================================================================
    // 9. RAYCASTING FOR CLICKABLE SENSOR MODULES (CH1–CH4)
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // Ignore orbit drags

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNdc, camera);
      const sensorMeshes = sensorEntries.map((s) => s.group);
      const hits = raycaster.intersectObjects(sensorMeshes, true);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.sensorId as number | undefined;
        if (hitId) {
          const next = stateRef.current.selectedSensor === hitId ? null : hitId;
          setInternalSensor(next);
          onSelectSensor?.(next);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // =========================================================================
    // 10. CAMERA TRANSITIONS & PACED RENDER LOOP (GPU + Software WebGL safe)
    // =========================================================================
    triggerCameraRef.current = (nextPreset: CameraPreset) => {
      const cfg = CAMERA_PRESETS[nextPreset];
      _camGoalPos.set(...cfg.pos);
      _camGoalTarget.set(...cfg.target);
      stateRef.current.cameraTransitioning = true;
      requestRender();
    };

    const handleControlsStart = () => {
      stateRef.current.cameraTransitioning = false;
    };
    const handleControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();
    let disposed = false;

    let currentLidOffset = 0;
    let currentExplodeOffset = 0;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) return;
          const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (status === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function stepScene(dt: number, elapsedSec: number) {
      const st = stateRef.current;
      let needsAnotherFrame = false;

      // 1. Sample visibility
      swabGroup.visible = st.hasSample;
      filterGroup.visible = st.filterMounted;

      // 2. Lid open / Exploded smooth damping
      const targetLid = st.isLidOpen || st.manualExploded ? 0.58 : 0.0;
      const targetExplode = st.manualExploded ? 0.22 : 0.0;
      currentLidOffset = THREE.MathUtils.damp(currentLidOffset, targetLid, 6.5, dt);
      currentExplodeOffset = THREE.MathUtils.damp(currentExplodeOffset, targetExplode, 6.5, dt);

      lidGroup.position.y = 1.41 + currentLidOffset;
      lidGroup.rotation.x = THREE.MathUtils.damp(
        lidGroup.rotation.x,
        st.isLidOpen && !st.manualExploded ? -0.18 : 0,
        6.5,
        dt
      );
      filterGroup.position.y = 0.06 + currentExplodeOffset * 1.1;

      if (
        Math.abs(currentLidOffset - targetLid) > 0.002 ||
        Math.abs(currentExplodeOffset - targetExplode) > 0.002
      ) {
        needsAnotherFrame = true;
      }

      // 3. Sensor statuses & heater glow
      for (const s of sensorEntries) {
        s.group.position.y = s.baseY + currentExplodeOffset * 0.45;
        const isHighlighted = st.selectedSensor === null || st.selectedSensor === s.id;
        const pulse = 0.65 + 0.35 * Math.sin(elapsedSec * 4.5 + s.id);

        if (!isHighlighted) {
          s.ledMat.color.setHex(0x64748b);
          s.ledMat.emissive.setHex(0x000000);
          s.ledMat.emissiveIntensity = 0;
          s.heaterMat.opacity = 0;
        } else if (st.isRecording) {
          s.ledMat.color.setHex(0x10b981);
          s.ledMat.emissive.setHex(0x10b981);
          s.ledMat.emissiveIntensity = 0.9 * pulse;
          s.heaterMat.emissive.setHex(0x14b8a6);
          s.heaterMat.emissiveIntensity = 0.7;
          s.heaterMat.opacity = 0.65;
        } else if (st.isStabilizing) {
          s.ledMat.color.setHex(0xf59e0b);
          s.ledMat.emissive.setHex(0xf59e0b);
          s.ledMat.emissiveIntensity = 0.9 * pulse;
          s.heaterMat.emissive.setHex(0xf59e0b);
          s.heaterMat.emissiveIntensity = 0.85 * pulse;
          s.heaterMat.opacity = 0.75;
        } else if (st.isConnected) {
          s.ledMat.color.setHex(0x38bdf8);
          s.ledMat.emissive.setHex(0x0284c7);
          s.ledMat.emissiveIntensity = 0.45;
          s.heaterMat.opacity = 0;
        } else {
          s.ledMat.color.setHex(0x94a3b8);
          s.ledMat.emissive.setHex(0x000000);
          s.ledMat.emissiveIntensity = 0;
          s.heaterMat.opacity = 0;
        }
      }

      // 4. ESP32 & Filter Status LEDs
      if (st.isConnected) {
        espLedMat.color.setHex(0x10b981);
        espLedMat.emissive.setHex(0x10b981);
        espLedMat.emissiveIntensity = 0.9;
      } else {
        espLedMat.color.setHex(0xef4444);
        espLedMat.emissive.setHex(0xef4444);
        espLedMat.emissiveIntensity = 0.35;
      }

      filterRingMat.emissiveIntensity = st.isPurging ? 1.1 : st.filterMounted ? 0.25 : 0;

      // 5. VOC Desorption / Thermal Convection Particles
      const particlesActive = st.isRecording || st.isStabilizing || st.isPurging;
      if (particlesActive) {
        needsAnotherFrame = true;
        particleMat.opacity = st.isRecording ? 0.72 : st.isStabilizing ? 0.58 : 0.42;
        particleMat.color.setHex(
          st.isRecording ? 0x0d9488 : st.isStabilizing ? 0xf59e0b : 0x38bdf8
        );

        const posAttr = particleGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const m = particleMeta[i];
          if (st.isPurging) {
            m.y -= m.speed * dt * 1.4;
            if (m.y < 0.25) m.y = 1.25;
          } else {
            m.y += m.speed * dt * (st.isRecording ? 1.2 : 0.85);
            m.angle += dt * 0.45;
            if (m.y > 1.26) {
              m.y = 0.26;
              m.radius = 0.06 + Math.random() * 0.46;
            }
          }
          const swirl = m.radius * (0.75 + 0.35 * ((m.y - 0.26) / 1.0));
          posAttr.setXYZ(i, Math.cos(m.angle) * swirl, m.y, Math.sin(m.angle) * swirl);
        }
        posAttr.needsUpdate = true;
      } else {
        particleMat.opacity = 0;
      }

      // 6. Camera preset interpolation
      if (st.cameraTransitioning) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camGoalPos.x, 6, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camGoalPos.y, 6, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camGoalPos.z, 6, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _camGoalTarget.x, 6, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _camGoalTarget.y, 6, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _camGoalTarget.z, 6, dt);

        if (
          camera.position.distanceToSquared(_camGoalPos) < 0.0005 &&
          controls.target.distanceToSquared(_camGoalTarget) < 0.0005
        ) {
          camera.position.copy(_camGoalPos);
          controls.target.copy(_camGoalTarget);
          st.cameraTransitioning = false;
        } else {
          needsAnotherFrame = true;
        }
      }

      if (controls.enableDamping) {
        controls.update();
      }

      return needsAnotherFrame;
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;

      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        const keepAnimating = stepScene(dt, now / 1000);
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (!disposed && (renderDirty || keepAnimating)) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    triggerRenderRef.current = requestRender;
    requestRender();

    // 11. ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const w = Math.max(entry.contentRect.width, 100);
        const h = Math.max(entry.contentRect.height, 100);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);

      for (const item of disposables) {
        item.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleSelectSensor = (id: number | null) => {
    setInternalSensor(id);
    onSelectSensor?.(id);
  };

  const handlePresetClick = (next: CameraPreset) => {
    setPreset(next);
    triggerCameraRef.current?.(next);
  };

  const phaseLabel = isRecording
    ? 'LIVE VOC ADSORPTION'
    : isStabilizing
    ? 'THERMAL EQUILIBRIUM (320°C)'
    : isLidOpen
    ? 'HEADSPACE UNSEALED'
    : isConnected
    ? 'ESP32 SERIAL ONLINE'
    : 'STANDBY CHAMBER';

  return (
    <div
      className={`relative w-full h-[340px] sm:h-[380px] rounded-xl border border-zinc-200 bg-[#f4f4f5] overflow-hidden select-none ${className}`}
    >
      {/* Dedicated WebGL Mount (No sibling overlays inside) */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-Left Minimal Static Spec Badge */}
      <div className="absolute top-3 left-3 pointer-events-none bg-white/95 border border-zinc-200 rounded-lg px-2.5 py-1.5 shadow-xs">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isRecording
                ? 'bg-emerald-600'
                : isStabilizing
                ? 'bg-amber-500'
                : isConnected
                ? 'bg-sky-600'
                : 'bg-zinc-400'
            }`}
          />
          <span className="font-mono text-[10px] font-bold text-zinc-900 tracking-wider">
            {phaseLabel}
          </span>
        </div>
        <p className="font-mono text-[9px] text-zinc-500 mt-0.5">
          4× BME680 • PCA9548A • ESP32-WROOM
        </p>
      </div>

      {/* Bottom-Center Collapsible Control Dock (Zero Viewport Occlusion) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[95%] flex flex-col items-center z-10">
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          className="mb-1 px-2.5 py-0.5 rounded-t-md bg-white/95 border border-b-0 border-zinc-200 text-[9px] font-mono font-semibold text-zinc-600 hover:text-black flex items-center gap-1 cursor-pointer shadow-xs"
        >
          {dockCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span>{dockCollapsed ? 'Controls' : 'Hide'}</span>
        </button>

        {!dockCollapsed && (
          <div className="bg-white/95 border border-zinc-200 rounded-xl px-2.5 py-1.5 shadow-md flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono">
            {/* Camera Presets */}
            <div className="flex items-center gap-1 pr-1.5 border-r border-zinc-200">
              {(['iso', 'sensors', 'esp32', 'top'] as CameraPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePresetClick(p)}
                  className={`px-2 py-1 rounded-md uppercase font-semibold transition-colors cursor-pointer ${
                    preset === p
                      ? 'bg-black text-white'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-black'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Channel Focus */}
            <div className="flex items-center gap-1 pr-1.5 border-r border-zinc-200">
              <button
                type="button"
                onClick={() => handleSelectSensor(null)}
                className={`px-1.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                  selectedSensor === null
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                ALL
              </button>
              {[1, 2, 3, 4].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => handleSelectSensor(selectedSensor === ch ? null : ch)}
                  className={`px-1.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    selectedSensor === ch
                      ? 'bg-emerald-700 text-white'
                      : 'text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  CH{ch}
                </button>
              ))}
            </div>

            {/* Explode / Reset */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setManualExploded((e) => !e)}
                className={`px-2 py-1 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  manualExploded
                    ? 'bg-black text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-black'
                }`}
                title="Toggle exploded chamber assembly"
              >
                <Layers className="w-3 h-3" />
                <span>Explode</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setManualExploded(false);
                  handleSelectSensor(null);
                  handlePresetClick('iso');
                }}
                className="p-1 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-black transition-colors cursor-pointer"
                title="Reset 3D view"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

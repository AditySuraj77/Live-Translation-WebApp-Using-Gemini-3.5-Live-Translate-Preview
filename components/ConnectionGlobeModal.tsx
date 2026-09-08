"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type { UserLocation } from "@/lib/livekit-transport";
import { calculateDistance, type DistanceResult } from "@/lib/geo-distance";

interface ConnectionGlobeModalProps {
  isOpen: boolean;
  onClose: () => void;
  myLocation?: UserLocation | null;
  peerLocation?: UserLocation | null;
  myName: string;
  myAvatar: string;
  peerName?: string;
  peerAvatar?: string;
}

// Convert geographic (latitude, longitude) to Three.js 3D coordinates on a sphere
function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  const x = radius * Math.cos(phi) * Math.cos(theta);
  const y = radius * Math.sin(phi);
  const z = -radius * Math.cos(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

export default function ConnectionGlobeModal({
  isOpen,
  onClose,
  myLocation,
  peerLocation,
  myName,
  peerName = "Partner",
}: ConnectionGlobeModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [distanceInfo, setDistanceInfo] = useState<DistanceResult | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // References for Three.js state
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const photonRef = useRef<THREE.Mesh | null>(null);
  const curveRef = useRef<THREE.QuadraticBezierCurve3 | null>(null);
  const pulseRingsRef = useRef<THREE.Mesh[]>([]);

  // Dragging & Interaction State
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const touchDistanceRef = useRef<number | null>(null);
  const rotVelocityRef = useRef({ x: 0, y: 0.002 });
  const photonProgressRef = useRef(0);

  // Compute Great-Circle distance
  useEffect(() => {
    if (myLocation && peerLocation) {
      const dist = calculateDistance(
        myLocation.lat,
        myLocation.lon,
        peerLocation.lat,
        peerLocation.lon
      );
      setDistanceInfo(dist);
    }
  }, [myLocation, peerLocation]);

  // Center the globe view between both locations
  const focusOnCoordinates = useCallback(() => {
    if (!globeGroupRef.current) return;
    if (myLocation && peerLocation) {
      const midLon = (myLocation.lon + peerLocation.lon) / 2;
      const midLat = (myLocation.lat + peerLocation.lat) / 2;
      // Bring midLon to face camera (+Z in Three.js equirectangular is lon = -90)
      globeGroupRef.current.rotation.y = ((midLon + 90) * Math.PI) / 180;
      globeGroupRef.current.rotation.x = -((midLat * Math.PI) / 180) * 0.4;
    } else if (myLocation) {
      globeGroupRef.current.rotation.y = ((myLocation.lon + 90) * Math.PI) / 180;
      globeGroupRef.current.rotation.x = -((myLocation.lat * Math.PI) / 180) * 0.4;
    }
  }, [myLocation, peerLocation]);

  // Main Three.js Setup and Render Loop
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 240);
    cameraRef.current = camera;

    // 3. WebGL Renderer with High-DPI support (capped for mobile efficiency)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(120, 80, 150);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x6366f1, 1.2);
    rimLight.position.set(-150, -60, -100);
    scene.add(rimLight);

    // 5. Globe Group (holds earth, atmosphere, markers, arcs)
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const GLOBE_RADIUS = 75;

    // 6. Earth Mesh with Real World Map Texture
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(
      "/textures/earth.jpg",
      () => setIsLoaded(true),
      undefined,
      (err) => console.warn("Failed loading earth texture:", err)
    );
    earthTexture.colorSpace = THREE.SRGBColorSpace;

    const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.85,
      metalness: 0.1,
    });
    const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
    globeGroup.add(globeMesh);

    // 7. Atmosphere Outer Glow
    const atmosGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.025, 48, 48);
    const atmosMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(0.39, 0.45, 0.98, 1.0) * intensity * 1.5;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    });
    const atmosMesh = new THREE.Mesh(atmosGeometry, atmosMaterial);
    globeGroup.add(atmosMesh);

    // 8. Subtle Starfield Particles
    const starCount = 300;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 600;
      starPositions[i + 1] = (Math.random() - 0.5) * 600;
      starPositions[i + 2] = (Math.random() - 0.5) * 600;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 1.2,
      transparent: true,
      opacity: 0.6,
    });
    const starPoints = new THREE.Points(starGeometry, starMaterial);
    scene.add(starPoints);

    // Helper: Create Glowing Marker Pin & Radar Wave Ring
    const rings: THREE.Mesh[] = [];
    pulseRingsRef.current = rings;

    function addLocationMarker(lat: number, lon: number, hexColor: number) {
      const pos = latLonToVector3(lat, lon, GLOBE_RADIUS);

      // Core marker dot
      const dotGeom = new THREE.SphereGeometry(1.6, 16, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: hexColor });
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.position.copy(pos);
      globeGroup.add(dot);

      // Outer pulsing ring
      const ringGeom = new THREE.RingGeometry(1.5, 2.6, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2)); // orient outwards along sphere normal
      globeGroup.add(ring);
      rings.push(ring);
    }

    if (myLocation) {
      addLocationMarker(myLocation.lat, myLocation.lon, 0x818cf8); // Indigo for "You"
    }
    if (peerLocation) {
      addLocationMarker(peerLocation.lat, peerLocation.lon, 0x34d399); // Emerald for "Partner"
    }

    // 9. 3D Flight Arc & Traveling Voice Pulse
    if (myLocation && peerLocation) {
      const v1 = latLonToVector3(myLocation.lat, myLocation.lon, GLOBE_RADIUS);
      const v2 = latLonToVector3(peerLocation.lat, peerLocation.lon, GLOBE_RADIUS);

      // Great circle chord distance determines peak altitude
      const chordDist = v1.distanceTo(v2);
      const altitude = GLOBE_RADIUS + Math.min(chordDist * 0.45, 35);

      // Midpoint projected upwards
      const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize().multiplyScalar(altitude);

      const curve = new THREE.QuadraticBezierCurve3(v1, mid, v2);
      curveRef.current = curve;

      // 3D Tube for the Glowing Arc
      const tubeGeom = new THREE.TubeGeometry(curve, 48, 0.45, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
      });
      const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
      globeGroup.add(tubeMesh);

      // Traveling Voice Pulse (Photon)
      const photonGeom = new THREE.SphereGeometry(1.2, 16, 16);
      const photonMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
      });
      const photon = new THREE.Mesh(photonGeom, photonMat);
      globeGroup.add(photon);
      photonRef.current = photon;
    }

    // Auto-align to show both locations
    focusOnCoordinates();

    // 10. Animation Loop
    let lastTime = performance.now();

    const animate = (now: number) => {
      animFrameRef.current = requestAnimationFrame(animate);

      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Auto rotation with damping
      if (!isDraggingRef.current) {
        globeGroup.rotation.y += rotVelocityRef.current.y;
        globeGroup.rotation.x += rotVelocityRef.current.x;
        // Friction on vertical tilt
        rotVelocityRef.current.x *= 0.95;
        // Clamp vertical tilt to avoid tumbling upside down
        globeGroup.rotation.x = Math.max(-0.85, Math.min(0.85, globeGroup.rotation.x));
      }

      // Animate pulsing radar rings
      const pulsePhase = (now * 0.003) % (Math.PI * 2);
      const scale = 1 + (Math.sin(pulsePhase) + 1) * 0.6;
      rings.forEach((ring) => {
        ring.scale.set(scale, scale, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0.1,
          0.85 - (scale - 1) * 0.5
        );
      });

      // Animate traveling voice photon along the arc
      if (photonRef.current && curveRef.current) {
        photonProgressRef.current = (photonProgressRef.current + delta * 0.4) % 1;
        const pt = curveRef.current.getPoint(photonProgressRef.current);
        photonRef.current.position.copy(pt);
      }

      renderer.render(scene, camera);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // Handle responsive container resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    // 11. Cleanup on Unmount
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      // Deep GPU Resource Disposal to prevent WebGL memory leaks
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else if (obj.material) {
            obj.material.dispose();
          }
        }
      });

      earthTexture.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isOpen, myLocation, peerLocation, focusOnCoordinates]);

  // Touch & Mouse Pointer Event Handlers
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    rotVelocityRef.current = { x: 0, y: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current || !globeGroupRef.current) return;
    const deltaX = e.clientX - lastPointerRef.current.x;
    const deltaY = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    const sensitivity = 0.006;
    globeGroupRef.current.rotation.y += deltaX * sensitivity;
    globeGroupRef.current.rotation.x = Math.max(
      -0.85,
      Math.min(0.85, globeGroupRef.current.rotation.x + deltaY * sensitivity)
    );

    rotVelocityRef.current = {
      x: deltaY * sensitivity * 0.3,
      y: deltaX * sensitivity * 0.3,
    };
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Smooth default drift resumption
    rotVelocityRef.current = {
      x: rotVelocityRef.current.x * 0.5,
      y: Math.abs(rotVelocityRef.current.y) > 0.001 ? rotVelocityRef.current.y * 0.5 : 0.002,
    };
  }

  // Touch Pinch-to-Zoom
  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2 && cameraRef.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchDistanceRef.current !== null) {
        const delta = dist - touchDistanceRef.current;
        cameraRef.current.position.z = Math.max(
          160,
          Math.min(320, cameraRef.current.position.z - delta * 0.4)
        );
      }
      touchDistanceRef.current = dist;
    }
  }

  function handleTouchEnd() {
    touchDistanceRef.current = null;
  }

  // Mouse Wheel Zoom
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.max(
        160,
        Math.min(320, cameraRef.current.position.z + e.deltaY * 0.15)
      );
    }
  }

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-950 border border-gray-800 rounded-3xl w-full max-w-lg sm:max-w-xl md:max-w-2xl max-h-[94vh] overflow-y-auto flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-800/80 bg-gray-900/50 shrink-0">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <span className="text-lg sm:text-xl">🌍</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm sm:text-base text-white leading-tight">
                  3D Global Connection Radar
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 uppercase tracking-wide">
                  WebGL
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-gray-400">
                Visual 3D flight path between active speakers
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={focusOnCoordinates}
              className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg bg-indigo-950/50 hover:bg-indigo-900/50 border border-indigo-800/50 transition cursor-pointer flex items-center gap-1"
              title="Center View"
            >
              🎯 Center
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1.5 rounded-xl hover:bg-gray-800 transition cursor-pointer text-base leading-none"
              title="Close Map"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Location Comparison Bar */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 p-2.5 sm:p-4 bg-gray-900/30 border-b border-gray-800/60 text-xs shrink-0">
          {/* You */}
          <div className="flex items-center gap-2 sm:gap-2.5 bg-gray-900/60 p-2 sm:p-2.5 rounded-xl border border-gray-800/80 min-w-0">
            <span className="text-lg sm:text-xl shrink-0">{myLocation?.flag || "🇮🇳"}</span>
            <div className="min-w-0">
              <span className="text-[9px] sm:text-[10px] text-indigo-400 font-bold uppercase tracking-wider block truncate">
                You ({myName})
              </span>
              <p className="font-semibold text-white truncate text-[11px] sm:text-xs">
                {myLocation ? `${myLocation.city}, ${myLocation.countryCode}` : "Detecting location..."}
              </p>
            </div>
          </div>

          {/* Partner */}
          <div className="flex items-center gap-2 sm:gap-2.5 bg-gray-900/60 p-2 sm:p-2.5 rounded-xl border border-gray-800/80 min-w-0">
            <span className="text-lg sm:text-xl shrink-0">{peerLocation?.flag || "🌐"}</span>
            <div className="min-w-0">
              <span className="text-[9px] sm:text-[10px] text-emerald-400 font-bold uppercase tracking-wider block truncate">
                Partner ({peerName})
              </span>
              <p className="font-semibold text-white truncate text-[11px] sm:text-xs">
                {peerLocation ? `${peerLocation.city}, ${peerLocation.countryCode}` : "Connecting..."}
              </p>
            </div>
          </div>
        </div>

        {/* 3D WebGL Canvas Container */}
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          className="relative w-full h-[260px] xs:h-[290px] sm:h-[350px] md:h-[400px] bg-gradient-to-b from-gray-950 via-gray-900/60 to-gray-950 flex items-center justify-center overflow-hidden select-none cursor-grab active:cursor-grabbing touch-none shrink-0"
        >
          {/* Loading spinner until texture is fully initialized */}
          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10 pointer-events-none">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-indigo-300 font-medium">Loading 3D Earth...</span>
              </div>
            </div>
          )}

          {/* Drag & Zoom instruction overlay badge */}
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm border border-gray-800 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[10px] sm:text-[11px] text-gray-400 pointer-events-none flex items-center gap-1.5 whitespace-nowrap z-20">
            <span>👆</span>
            <span>Drag to rotate • Pinch / Scroll to zoom</span>
          </div>
        </div>

        {/* Distance & Telemetry Stats Bar */}
        <div className="p-3 sm:p-4 bg-gray-900/40 border-t border-gray-800 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">📏</span>
            <div>
              <span className="text-gray-400 text-[9px] sm:text-[10px] block">Great-Circle Distance</span>
              <span className="font-semibold text-indigo-300 text-xs sm:text-sm">
                {distanceInfo ? distanceInfo.formatted : "Awaiting partner location..."}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm">⚡</span>
            <div>
              <span className="text-gray-400 text-[9px] sm:text-[10px] block">Audio Latency</span>
              <span className="font-semibold text-emerald-300 text-xs sm:text-sm">Sub-second P2P Direct</span>
            </div>
          </div>

          <div className="w-full pt-2 border-t border-gray-800/60 flex items-center justify-between text-[10px] sm:text-[11px] text-gray-500">
            <span className="truncate mr-2">🔒 City-level location only. Zero GPS tracking.</span>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition cursor-pointer text-xs shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


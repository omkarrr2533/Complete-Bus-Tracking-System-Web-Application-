// CityBus Tracker — WebGL landing scene (Three.js, ES module via import map)
//
// A low-poly night city with a bus running a glowing loop. The camera starts
// on an aerial establishing shot and — as the user scrolls the landing stage
// (progress arrives in window.__scrollP from motion.js) — dives down to a
// street-level follow-cam behind the bus.
//
// Guards: WebGL failure hides the canvas (the dot-matrix hero still stands),
// prefers-reduced-motion renders one static frame, and the render loop
// pauses whenever the hero is off-screen or the tab is hidden.

import * as THREE from 'three';

const canvas = document.getElementById('hero-3d');
if (canvas) {
    try {
        init(canvas);
    } catch (err) {
        console.warn('WebGL unavailable, keeping flat hero:', err);
        canvas.remove();
    }
}

function init(canvas) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e18);
    scene.fog = new THREE.Fog(0x0a0e18, 18, 46);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

    // ── Lighting: moonlight + depot accents ───────────────────────────
    scene.add(new THREE.AmbientLight(0x2a3450, 1.4));
    const moon = new THREE.DirectionalLight(0x8fa3d0, 0.9);
    moon.position.set(-10, 16, 6);
    scene.add(moon);
    const yellowGlow = new THREE.PointLight(0xffc21a, 30, 26, 2);
    yellowGlow.position.set(6, 4, -4);
    scene.add(yellowGlow);
    const tealGlow = new THREE.PointLight(0x2dd4a7, 22, 24, 2);
    tealGlow.position.set(-7, 3, 5);
    scene.add(tealGlow);

    // ── Ground ─────────────────────────────────────────────────────────
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(60, 48),
        new THREE.MeshLambertMaterial({ color: 0x0d1322 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // ── The route: a closed loop through the city ─────────────────────
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-9, 0, -6),
        new THREE.Vector3(-2, 0, -10),
        new THREE.Vector3(7, 0, -7),
        new THREE.Vector3(10, 0, 1),
        new THREE.Vector3(5, 0, 8),
        new THREE.Vector3(-4, 0, 9),
        new THREE.Vector3(-10, 0, 3)
    ], true, 'catmullrom', 0.6);

    // Asphalt ribbon under the glow line
    scene.add(ribbonAlongCurve(curve, 1.5, 0x161d30, 0.015));
    // Glowing route line — the network, made physical
    const routeGlow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 220, 0.07, 8, true),
        new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.85 }));
    routeGlow.position.y = 0.03;
    scene.add(routeGlow);

    // ── Buildings: one instanced draw call, kept off the road ─────────
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    buildingGeo.translate(0, 0.5, 0); // grow upward from the ground
    const buildingMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const spots = [];
    for (let x = -22; x <= 22; x += 2.6) {
        for (let z = -22; z <= 22; z += 2.6) {
            const px = x + (Math.random() - 0.5) * 1.2;
            const pz = z + (Math.random() - 0.5) * 1.2;
            if (Math.hypot(px, pz) > 24) continue;
            if (distanceToCurve(curve, px, pz) < 3.1) continue; // keep the corridor clear (follow-cam flies here)
            spots.push([px, pz]);
        }
    }
    const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, spots.length);
    const m = new THREE.Matrix4();
    const shade = new THREE.Color();
    spots.forEach(([px, pz], i) => {
        const h = 0.8 + Math.random() * (Math.hypot(px, pz) < 9 ? 2.2 : 6.5);
        const w = 0.9 + Math.random() * 1.1;
        m.makeScale(w, h, w).setPosition(px, 0, pz);
        buildings.setMatrixAt(i, m);
        shade.setHSL(0.62 + Math.random() * 0.04, 0.28, 0.10 + Math.random() * 0.07);
        buildings.setColorAt(i, shade);
    });
    scene.add(buildings);

    // ── City lights: a bokeh of lit windows ───────────────────────────
    const lightPositions = [];
    const lightColors = [];
    const windowPalette = [new THREE.Color(0xffc21a), new THREE.Color(0xffe9b0),
                           new THREE.Color(0x2dd4a7), new THREE.Color(0x9fb6ff)];
    spots.forEach(([px, pz]) => {
        const count = Math.random() < 0.55 ? Math.floor(Math.random() * 4) : 0;
        for (let k = 0; k < count; k++) {
            lightPositions.push(px + (Math.random() - 0.5) * 0.9,
                                0.4 + Math.random() * 4.5,
                                pz + (Math.random() - 0.5) * 0.9);
            const c = windowPalette[Math.floor(Math.random() * windowPalette.length)];
            lightColors.push(c.r, c.g, c.b);
        }
    });
    const lightsGeo = new THREE.BufferGeometry();
    lightsGeo.setAttribute('position', new THREE.Float32BufferAttribute(lightPositions, 3));
    lightsGeo.setAttribute('color', new THREE.Float32BufferAttribute(lightColors, 3));
    scene.add(new THREE.Points(lightsGeo, new THREE.PointsMaterial({
        size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true })));

    // ── Stars ──────────────────────────────────────────────────────────
    const starPos = [];
    for (let i = 0; i < 260; i++) {
        const r = 40 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const y = 12 + Math.random() * 30;
        starPos.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xcdd8f2, size: 0.1, transparent: true, opacity: 0.8 })));

    // ── The bus ────────────────────────────────────────────────────────
    const bus = buildBus();
    scene.add(bus.group);

    // ── Stop beacons with pulsing rings ────────────────────────────────
    const rings = [];
    [0.12, 0.45, 0.78].forEach(t => {
        const p = curve.getPointAt(t);
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 1.15, 6),
            new THREE.MeshLambertMaterial({ color: 0x33456b }));
        pole.position.set(p.x + 0.9, 0.55, p.z + 0.9);
        scene.add(pole);
        const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 10, 10),
            new THREE.MeshBasicMaterial({ color: 0x2dd4a7 }));
        lamp.position.set(p.x + 0.9, 1.16, p.z + 0.9);
        scene.add(lamp);
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.5, 0.03, 8, 40),
            new THREE.MeshBasicMaterial({ color: 0x2dd4a7, transparent: true, opacity: 0.7 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x + 0.9, 0.05, p.z + 0.9);
        scene.add(ring);
        rings.push(ring);
    });

    // ── Camera choreography ────────────────────────────────────────────
    const aerial = new THREE.Vector3(15, 12, 15);
    const lookCenter = new THREE.Vector3(0, 0.6, 0);
    const camPos = aerial.clone();
    const camLook = lookCenter.clone();
    const mouse = { x: 0, y: 0 };
    addEventListener('pointermove', e => {
        mouse.x = (e.clientX / innerWidth) * 2 - 1;
        mouse.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });

    const clock = new THREE.Clock();
    let busT = 0;
    let running = true;

    // Render only while the hero is on screen and the tab is visible
    const hero = document.getElementById('hero');
    if (hero && 'IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            running = entries[0].isIntersecting && !document.hidden;
        }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) running = false;
    });

    function resize() {
        const w = canvas.clientWidth || canvas.parentElement.clientWidth;
        const h = canvas.clientHeight || canvas.parentElement.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    }
    addEventListener('resize', resize);

    const tmpTangent = new THREE.Vector3();
    const followPos = new THREE.Vector3();
    const followLook = new THREE.Vector3();
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();

    function frame(dt, elapsed) {
        // Bus rolls forever; wheels spin with it
        busT = (busT + dt * 0.016) % 1;
        const p = curve.getPointAt(busT);
        curve.getTangentAt(busT, tmpTangent);
        bus.group.position.set(p.x, 0.26, p.z);
        bus.group.lookAt(p.x + tmpTangent.x, 0.26, p.z + tmpTangent.z);
        bus.wheels.forEach(w => { w.rotation.x += dt * 6; });

        // Stop rings breathe
        rings.forEach((ring, i) => {
            const s = 1 + 0.25 * Math.sin(elapsed * 2.2 + i * 2.1);
            ring.scale.setScalar(s);
            ring.material.opacity = 0.45 + 0.3 * Math.sin(elapsed * 2.2 + i * 2.1);
        });

        // Scroll progress: 0 = aerial establishing shot, 1 = ride-along
        const scrollP = THREE.MathUtils.clamp(window.__scrollP || 0, 0, 1);
        const dive = smoothstep(scrollP);

        // Aerial view slowly orbits and answers the pointer
        const orbit = elapsed * 0.05;
        const aerialNow = desiredPos.set(
            Math.cos(orbit) * aerial.x + mouse.x * 1.6 * (1 - dive),
            aerial.y - mouse.y * 1.2 * (1 - dive),
            Math.sin(orbit) * aerial.z + aerial.z * 0.3);

        // Ride-along: chase drone behind and above the bus, looking down the road
        followPos.copy(p).addScaledVector(tmpTangent, -4.4).y = 2.6;
        followLook.copy(p).addScaledVector(tmpTangent, 2.6).y = 0.4;

        desiredPos.lerpVectors(aerialNow, followPos, dive);
        desiredLook.lerpVectors(lookCenter, followLook, dive);

        camPos.lerp(desiredPos, Math.min(1, dt * 4));
        camLook.lerp(desiredLook, Math.min(1, dt * 4));
        camera.position.copy(camPos);
        camera.lookAt(camLook);

        renderer.render(scene, camera);
    }

    resize();

    if (reduced) {
        // One considered still frame, no motion
        busT = 0.3;
        window.__scrollP = 0;
        frame(0.016, 1.5);
        return;
    }

    renderer.setAnimationLoop(() => {
        resize();
        if (!running) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        frame(dt, clock.elapsedTime);
    });
}

// ── Helpers ────────────────────────────────────────────────────────────

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function distanceToCurve(curve, x, z) {
    let best = Infinity;
    for (let i = 0; i <= 60; i++) {
        const p = curve.getPointAt(i / 60);
        best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    }
    return best;
}

/** Flat triangle-strip ribbon following the curve (the asphalt). */
function ribbonAlongCurve(curve, width, color, y) {
    const segments = 200;
    const positions = [];
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        normal.crossVectors(up, tangent).setLength(width / 2);
        positions.push(p.x - normal.x, y, p.z - normal.z,
                       p.x + normal.x, y, p.z + normal.z);
    }
    const indices = [];
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}

/** Low-poly night bus: yellow body, teal glass, headlights that throw light. */
function buildBus() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.4, metalness: 0.15 }));
    body.position.y = 0.14;
    group.add(body);

    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.64, 0.16, 1.28),
        new THREE.MeshStandardMaterial({
            color: 0x0f2b33, roughness: 0.1, metalness: 0.4,
            emissive: 0x2dd4a7, emissiveIntensity: 0.55 }));
    glass.position.y = 0.24;
    group.add(glass);

    const roofSign = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
    roofSign.position.set(0, 0.44, 0.55);
    group.add(roofSign);

    const wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.9 });
    [[-0.3, 0.5], [0.3, 0.5], [-0.3, -0.5], [0.3, -0.5]].forEach(([x, z]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(x, -0.13, z);
        group.add(wheel);
        wheels.push(wheel);
    });

    // Headlights: emissive dots + a real spotlight washing the road
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6da });
    [[-0.18], [0.18]].forEach(([x]) => {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), lampMat);
        lamp.position.set(x, 0.08, 0.76);
        group.add(lamp);
    });
    const beam = new THREE.SpotLight(0xfff2c8, 26, 9, Math.PI / 5.5, 0.6, 1.6);
    beam.position.set(0, 0.25, 0.7);
    const beamTarget = new THREE.Object3D();
    beamTarget.position.set(0, 0, 5);
    group.add(beamTarget);
    beam.target = beamTarget;
    group.add(beam);

    // Taillights
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
    [[-0.2], [0.2]].forEach(([x]) => {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), tailMat);
        tail.position.set(x, 0.1, -0.76);
        group.add(tail);
    });

    return { group, wheels };
}

// IndoorNav App - Main Controller
(function () {
    const sensors = new SensorManager();
    const navigator = new IndoorNavigator();
    const canvas = document.getElementById('map-canvas');
    const renderer = new MapRenderer(canvas);
    const poiStore = new PoiStore();

    // UI Elements
    const btnStart = document.getElementById('btn-start');
    const btnReset = document.getElementById('btn-reset');
    const btnSetFloor = document.getElementById('btn-set-floor');
    const btnCalibrate = document.getElementById('btn-calibrate');
    const stepCountEl = document.getElementById('step-count');
    const headingEl = document.getElementById('heading-display');
    const accuracyEl = document.getElementById('accuracy-indicator');
    const floorPanel = document.getElementById('floor-panel');
    const calibrationPanel = document.getElementById('calibration-panel');
    const infoPanel = document.getElementById('info-panel');
    const sensorDebug = document.getElementById('sensor-debug');
    const strideSlider = document.getElementById('stride-slider');
    const strideValue = document.getElementById('stride-value');
    const addPoiPanel = document.getElementById('add-poi-panel');
    const poiNameInput = document.getElementById('poi-name-input');
    const addPoiPositionEl = document.getElementById('add-poi-position');
    const poiListPanel = document.getElementById('poi-list-panel');
    const poiListEl = document.getElementById('poi-list');
    const poiEmptyEl = document.getElementById('poi-empty');
    const targetBar = document.getElementById('target-bar');
    const targetInfoEl = document.getElementById('target-info');

    let isTracking = false;
    let animFrameId = null;
    let currentView = 'map';
    let targetId = null;          // POI currently being navigated to
    let pendingPoiPos = null;     // position captured when "Marker sted" was pressed
    let redrawQueued = false;
    let lastListUpdate = 0;
    let wakeLock = null;
    let saveTimer = null;
    let sensorStalled = false;

    const SESSION_KEY = 'indoornav-session';
    const resumePanel = document.getElementById('resume-panel');

    // Initialize floor buttons
    function initFloorButtons() {
        const container = document.getElementById('floor-buttons');
        for (let i = -1; i <= 5; i++) {
            const btn = document.createElement('button');
            btn.textContent = i === -1 ? 'K' : `${i}`;
            btn.dataset.floor = i;
            if (i === 0) btn.classList.add('active');
            btn.addEventListener('click', () => setFloor(i));
            container.appendChild(btn);
        }
    }

    function setFloor(floor) {
        navigator.setFloor(floor);
        scheduleSave();
        document.querySelectorAll('#floor-buttons button').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.floor, 10) === floor);
        });
        requestRedraw();
    }

    function floorLabel(floor) {
        return floor === -1 ? 'K' : `${floor}`;
    }

    // ---- Session persistence ----
    // iOS may reload the page after it has been in the background or under
    // memory pressure. Keep the navigation state in localStorage so it survives.

    const round2 = v => Math.round(v * 100) / 100;

    function saveSession() {
        clearTimeout(saveTimer);
        saveTimer = null;
        const data = {
            v: 1,
            savedAt: Date.now(),
            wasTracking: isTracking,
            position: { x: navigator.position.x, y: navigator.position.y },
            path: navigator.path.map(p => [round2(p.x), round2(p.y), p.floor]),
            floor: navigator.floor,
            heading: navigator._filteredHeading,
            stepCount: sensors.stepCount,
            strideLength: navigator.strideLength,
            targetId,
        };
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(data));
        } catch (e) {
            // Storage full: drop the oldest half of the path and try once more
            try {
                data.path = data.path.slice(Math.floor(data.path.length / 2));
                localStorage.setItem(SESSION_KEY, JSON.stringify(data));
            } catch (e2) { /* give up */ }
        }
    }

    // Coalesce frequent changes (every step) into at most one write per second
    function scheduleSave() {
        if (!saveTimer) saveTimer = setTimeout(saveSession, 1000);
    }

    function loadSession() {
        try {
            const d = JSON.parse(localStorage.getItem(SESSION_KEY));
            if (!d || d.v !== 1 || !Array.isArray(d.path) || !d.position) return null;
            return d;
        } catch (e) {
            return null;
        }
    }

    function restoreSession() {
        const d = loadSession();
        if (!d) return;

        navigator.position = { x: d.position.x, y: d.position.y };
        navigator.path = d.path.map(([x, y, floor]) => ({ x, y, floor }));
        if (navigator.path.length === 0) navigator.path = [{ x: 0, y: 0, floor: d.floor }];
        if (Number.isFinite(d.heading)) navigator._filteredHeading = d.heading;
        sensors.stepCount = d.stepCount || 0;
        stepCountEl.textContent = `${sensors.stepCount} skritt`;

        if (Number.isFinite(d.strideLength)) {
            navigator.strideLength = sensors.strideLength = d.strideLength;
            strideSlider.value = d.strideLength;
            strideValue.textContent = `${d.strideLength.toFixed(2)} m`;
        }
        if (d.targetId && poiStore.get(d.targetId)) targetId = d.targetId;
        setFloor(d.floor);

        if (d.wasTracking) {
            const mins = Math.round((Date.now() - d.savedAt) / 60000);
            const ago = mins < 1 ? 'nettopp' : mins < 60 ? `for ${mins} min siden` : `for ${Math.round(mins / 60)} t siden`;
            document.getElementById('resume-info').textContent =
                `Appen ble lastet på nytt (sist lagret ${ago}). Posisjon og ${sensors.stepCount} skritt er gjenopprettet. ` +
                'Stå på samme sted som da den stoppet, om mulig.';
            resumePanel.classList.remove('hidden');
            btnStart.textContent = 'Fortsett navigasjon';
        }
    }

    // ---- Screen wake lock ----
    // Keeps the screen on while navigating, so iOS does not lock the phone and
    // suspend the page (which stops sensor events and may later reload it).
    async function acquireWakeLock() {
        const wl = window.navigator.wakeLock; // `navigator` is shadowed by IndoorNavigator
        if (!wl || wakeLock || document.visibilityState !== 'visible') return;
        try {
            wakeLock = await wl.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (e) {
            wakeLock = null;
        }
    }

    function releaseWakeLock() {
        if (wakeLock) {
            wakeLock.release().catch(() => {});
            wakeLock = null;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveSession();
        } else if (isTracking) {
            acquireWakeLock(); // the lock is released automatically when hidden
        }
    });
    window.addEventListener('pagehide', saveSession);

    // Start/stop tracking
    async function toggleTracking() {
        if (!isTracking) {
            if (!sensors.hasPermission) {
                const granted = await sensors.requestPermission();
                if (!granted) {
                    alert('Sensorene krever tillatelse. Vennligst tillat tilgang til bevegelsessensorer.');
                    return;
                }
            }

            sensors.start();
            isTracking = true;
            sensorStalled = false;
            resumePanel.classList.add('hidden');
            btnStart.textContent = 'Stopp';
            btnStart.classList.add('active');
            accuracyEl.textContent = 'Aktiv';
            accuracyEl.style.color = '#30D158';
            acquireWakeLock();
            saveSession();

            startRenderLoop();
        } else {
            sensors.stop();
            isTracking = false;
            releaseWakeLock();
            saveSession();
            btnStart.textContent = 'Start navigasjon';
            btnStart.classList.remove('active');
            accuracyEl.textContent = 'Stoppet';
            accuracyEl.style.color = '#FF9F0A';

            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
        }
    }

    function drawMap() {
        renderer.render(
            navigator.position,
            navigator.path,
            sensors.heading,
            navigator.floor,
            poiStore.list(),
            targetId ? poiStore.get(targetId) : null
        );
        updateTargetBar();
    }

    // Redraw once when not tracking (tracking already redraws every frame)
    function requestRedraw() {
        if (isTracking || redrawQueued) return;
        redrawQueued = true;
        requestAnimationFrame(() => {
            redrawQueued = false;
            drawMap();
        });
    }

    // Render loop
    function startRenderLoop() {
        function frame() {
            drawMap();

            // Update UI
            stepCountEl.textContent = `${sensors.stepCount} skritt`;
            headingEl.textContent = `${Math.round(sensors.heading)}°`;

            // Watchdog: warn if motion events have stopped arriving
            const stalled = Date.now() - sensors.lastMotionTime > 3000;
            if (stalled !== sensorStalled) {
                sensorStalled = stalled;
                accuracyEl.textContent = stalled ? 'Ingen sensordata!' : 'Aktiv';
                accuracyEl.style.color = stalled ? '#FF453A' : '#30D158';
            }

            // Update sensor debug panel if visible
            if (currentView === 'info') {
                updateSensorDebug();
            } else if (currentView === 'pois') {
                const now = performance.now();
                if (now - lastListUpdate > 500) {
                    lastListUpdate = now;
                    updatePoiDistances();
                }
            }

            animFrameId = requestAnimationFrame(frame);
        }
        frame();
    }

    function updateSensorDebug() {
        const data = sensors.getSensorData();
        const dist = navigator.getDistanceTraveled();

        sensorDebug.innerHTML = `
            <div><span class="label">Akselerasjon X:</span> <span class="value">${data.acceleration.x.toFixed(3)}</span> m/s²</div>
            <div><span class="label">Akselerasjon Y:</span> <span class="value">${data.acceleration.y.toFixed(3)}</span> m/s²</div>
            <div><span class="label">Akselerasjon Z:</span> <span class="value">${data.acceleration.z.toFixed(3)}</span> m/s²</div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Rotasjon Alpha:</span> <span class="value">${data.rotationRate.alpha.toFixed(2)}</span> °/s</div>
            <div><span class="label">Rotasjon Beta:</span> <span class="value">${data.rotationRate.beta.toFixed(2)}</span> °/s</div>
            <div><span class="label">Rotasjon Gamma:</span> <span class="value">${data.rotationRate.gamma.toFixed(2)}</span> °/s</div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Kompassretning:</span> <span class="value">${data.heading.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Alpha:</span> <span class="value">${data.orientation.alpha.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Beta:</span> <span class="value">${data.orientation.beta.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Gamma:</span> <span class="value">${data.orientation.gamma.toFixed(1)}°</span></div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Skritt:</span> <span class="value">${data.stepCount}</span></div>
            <div><span class="label">Skrittlengde:</span> <span class="value">${sensors.strideLength.toFixed(2)} m</span></div>
            <div><span class="label">Distanse:</span> <span class="value">${dist.toFixed(1)} m</span></div>
            <div><span class="label">Posisjon:</span> <span class="value">X: ${navigator.position.x.toFixed(2)}, Y: ${navigator.position.y.toFixed(2)}</span></div>
            <div><span class="label">Etasje:</span> <span class="value">${navigator.floor}</span></div>
        `;
    }

    // ---- Points of interest ----

    // Distance (m), absolute bearing (0 = north) and direction relative to current heading
    function poiRelation(poi) {
        const dx = poi.x - navigator.position.x;
        const dy = poi.y - navigator.position.y;
        const distance = Math.hypot(dx, dy);
        const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const relative = ((bearing - sensors.heading + 540) % 360) - 180; // -180..180
        return { distance, bearing, relative };
    }

    function directionArrow(relative) {
        const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
        const idx = Math.round(((relative + 360) % 360) / 45) % 8;
        return arrows[idx];
    }

    function formatDistance(m) {
        return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
    }

    function describePoi(poi) {
        if (poi.floor !== navigator.floor) {
            return `Etasje ${floorLabel(poi.floor)}`;
        }
        const r = poiRelation(poi);
        if (r.distance < 1.5) return 'Her';
        return `${directionArrow(r.relative)} ${formatDistance(r.distance)}`;
    }

    function updateTargetBar() {
        const target = targetId ? poiStore.get(targetId) : null;
        if (!target) {
            targetBar.classList.add('hidden');
            return;
        }
        targetBar.classList.remove('hidden');
        let text;
        if (target.floor !== navigator.floor) {
            text = `${target.name} · gå til etasje ${floorLabel(target.floor)}`;
        } else {
            const r = poiRelation(target);
            text = r.distance < 1.5
                ? `${target.name} · Du er fremme!`
                : `${directionArrow(r.relative)} ${target.name} · ${formatDistance(r.distance)}`;
        }
        if (targetInfoEl.textContent !== text) targetInfoEl.textContent = text;
    }

    function openAddPoi() {
        pendingPoiPos = {
            x: navigator.position.x,
            y: navigator.position.y,
            floor: navigator.floor,
        };
        addPoiPositionEl.textContent =
            `Posisjon: X ${pendingPoiPos.x.toFixed(1)} m, Y ${pendingPoiPos.y.toFixed(1)} m, etasje ${floorLabel(pendingPoiPos.floor)}`;
        poiNameInput.value = '';
        poiNameInput.placeholder = poiStore.defaultName();
        floorPanel.classList.add('hidden');
        calibrationPanel.classList.add('hidden');
        addPoiPanel.classList.remove('hidden');
        poiNameInput.focus();
    }

    function closeAddPoi() {
        addPoiPanel.classList.add('hidden');
        poiNameInput.blur();
        pendingPoiPos = null;
    }

    function savePoi() {
        if (!pendingPoiPos) return;
        const name = poiNameInput.value.trim() || poiNameInput.placeholder;
        poiStore.add(name, pendingPoiPos.x, pendingPoiPos.y, pendingPoiPos.floor);
        closeAddPoi();
        renderPoiList();
        requestRedraw();
    }

    function renderPoiList() {
        poiListEl.textContent = '';
        const pois = poiStore.list();
        poiEmptyEl.classList.toggle('hidden', pois.length > 0);

        for (const poi of pois) {
            const li = document.createElement('li');
            li.className = 'poi-item';
            li.dataset.id = poi.id;
            if (poi.id === targetId) li.classList.add('is-target');

            const head = document.createElement('div');
            head.className = 'poi-head';
            const name = document.createElement('span');
            name.className = 'poi-name';
            name.textContent = poi.name;
            const meta = document.createElement('span');
            meta.className = 'poi-meta';
            meta.textContent = describePoi(poi);
            head.append(name, meta);

            const actions = document.createElement('div');
            actions.className = 'poi-actions';
            const mk = (label, cls, handler) => {
                const b = document.createElement('button');
                b.textContent = label;
                if (cls) b.className = cls;
                b.addEventListener('click', handler);
                actions.appendChild(b);
            };
            mk(poi.id === targetId ? 'Stopp' : 'Naviger hit', 'poi-go', () => {
                targetId = poi.id === targetId ? null : poi.id;
                scheduleSave();
                if (targetId) {
                    if (poi.floor !== navigator.floor) setFloor(poi.floor);
                    switchView('map');
                    renderer.centerOnPosition();
                }
                renderPoiList();
                requestRedraw();
            });
            mk('Vis på kart', '', () => {
                if (poi.floor !== navigator.floor) setFloor(poi.floor);
                switchView('map');
                renderer.centerOn(poi.x, poi.y);
                requestRedraw();
            });
            mk('Gi nytt navn', '', () => {
                const newName = prompt('Nytt navn:', poi.name);
                if (newName && newName.trim()) {
                    poiStore.rename(poi.id, newName);
                    renderPoiList();
                    requestRedraw();
                }
            });
            mk('Slett', 'poi-delete', () => {
                if (!confirm(`Slette «${poi.name}»?`)) return;
                poiStore.remove(poi.id);
                if (targetId === poi.id) targetId = null;
                scheduleSave();
                renderPoiList();
                requestRedraw();
            });

            li.append(head, actions);
            poiListEl.appendChild(li);
        }
    }

    // Update only the distance labels so buttons are not recreated while tapping
    function updatePoiDistances() {
        poiListEl.querySelectorAll('.poi-item').forEach(li => {
            const poi = poiStore.get(li.dataset.id);
            if (!poi) return;
            const meta = li.querySelector('.poi-meta');
            const text = describePoi(poi);
            if (meta.textContent !== text) meta.textContent = text;
        });
    }

    function switchView(view) {
        currentView = view;
        document.querySelectorAll('.nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });
        infoPanel.classList.toggle('hidden', view !== 'info');
        poiListPanel.classList.toggle('hidden', view !== 'pois');
        if (view === 'pois') renderPoiList();
        if (view === 'info') updateSensorDebug();
    }

    document.getElementById('btn-add-poi').addEventListener('click', openAddPoi);
    document.getElementById('btn-save-poi').addEventListener('click', savePoi);
    document.getElementById('btn-cancel-poi').addEventListener('click', closeAddPoi);
    poiNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') savePoi();
        else if (e.key === 'Escape') closeAddPoi();
    });
    document.getElementById('btn-clear-target').addEventListener('click', () => {
        targetId = null;
        scheduleSave();
        renderPoiList();
        requestRedraw();
    });

    // Step callback
    sensors.onStep = function (count, heading) {
        navigator.addStep(heading);
        scheduleSave();
    };

    // Event listeners
    btnStart.addEventListener('click', toggleTracking);

    btnReset.addEventListener('click', () => {
        sensors.reset();
        navigator.reset();
        renderer.centerOnPosition();
        stepCountEl.textContent = '0 skritt';
        saveSession();
        requestRedraw();
    });

    btnSetFloor.addEventListener('click', () => {
        floorPanel.classList.toggle('hidden');
        calibrationPanel.classList.add('hidden');
        addPoiPanel.classList.add('hidden');
    });

    document.getElementById('btn-close-floor').addEventListener('click', () => {
        floorPanel.classList.add('hidden');
    });

    btnCalibrate.addEventListener('click', () => {
        calibrationPanel.classList.toggle('hidden');
        floorPanel.classList.add('hidden');
        addPoiPanel.classList.add('hidden');
    });

    document.getElementById('btn-close-calibration').addEventListener('click', () => {
        calibrationPanel.classList.add('hidden');
    });

    document.getElementById('btn-do-calibrate').addEventListener('click', async () => {
        const btn = document.getElementById('btn-do-calibrate');
        btn.textContent = 'Kalibrerer...';
        btn.disabled = true;
        await sensors.calibrate();
        btn.textContent = 'Ferdig!';
        setTimeout(() => {
            btn.textContent = 'Kalibrer sensorer';
            btn.disabled = false;
        }, 1000);
    });

    strideSlider.addEventListener('input', () => {
        const val = parseFloat(strideSlider.value);
        strideValue.textContent = `${val.toFixed(2)} m`;
        sensors.strideLength = val;
        navigator.strideLength = val;
        scheduleSave();
    });

    // Bottom navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => { renderer.zoomIn(); requestRedraw(); });
    document.getElementById('zoom-out').addEventListener('click', () => { renderer.zoomOut(); requestRedraw(); });

    // Keep the map responsive to pan/zoom while tracking is stopped
    ['touchmove', 'touchend', 'wheel', 'mousemove'].forEach(evt =>
        canvas.addEventListener(evt, requestRedraw, { passive: true })
    );
    window.addEventListener('resize', requestRedraw);

    // Double-tap to re-center
    let lastTapTime = 0;
    canvas.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTapTime < 300 && e.changedTouches.length === 1) {
            renderer.centerOnPosition();
        }
        lastTapTime = now;
    });

    // Init
    initFloorButtons();
    restoreSession();

    document.getElementById('btn-resume').addEventListener('click', () => {
        if (!isTracking) toggleTracking();
    });
    document.getElementById('btn-resume-reset').addEventListener('click', () => {
        resumePanel.classList.add('hidden');
        btnReset.click();
        btnStart.textContent = 'Start navigasjon';
    });

    // Initial render
    drawMap();
})();

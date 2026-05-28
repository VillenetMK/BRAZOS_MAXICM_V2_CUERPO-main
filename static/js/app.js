let listaSecuencia = [];
let servosCached = {};
let quickActionsCached = {};
let movementsCached = {};

// ===============================
// ESTADO GENERAL
// ===============================

async function actualizarEstado() {
    const res = await fetch("/api/status");
    const data = await res.json();

    servosCached = data.servos || {};
    quickActionsCached = data.quick_actions || {};
    movementsCached = data.movements || {};

    renderSerialInfo(data);

    renderBrazo([0, 1, 2], "brazo1-container", servosCached);
    renderBrazo([4, 5, 6], "brazo2-container", servosCached);

    renderTablaPasos(data.steps || {});
    renderAccionesRapidas(quickActionsCached);
    renderMovimientosCreados(movementsCached);
}

function renderSerialInfo(data) {
    const box = document.getElementById("serial-info");
    if (!box) return;

    let serialText = "";

    if (data.serial_connected) {
        serialText = `✅ ESP32 conectado en <b>${data.serial_port}</b>`;
    } else {
        serialText = `⚠️ ESP32 no conectado. Modo simulación activo.`;
    }

    if (data.sequence_running) {
        serialText += ` | ⏳ Secuencia ejecutándose`;
    } else {
        serialText += ` | 🟢 Libre`;
    }

    box.innerHTML = serialText;
}

// ===============================
// CONTROLES DE BRAZOS
// ===============================

function renderBrazo(canales, containerId, servos) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    canales.forEach(ch => {
        const s = servos[ch];

        if (!s) return;

        container.innerHTML += `
            <div class="servo-control">
                <div class="servo-header">
                    <span>${s.name} (Ch ${ch})</span>
                    <span class="servo-angle" id="val-display-${ch}">${s.current}°</span>
                </div>

                <div class="controls">
                    <button class="btn-orange" onclick="mover(${ch}, 'step_down')">
                        -1°
                    </button>

                    <input
                        type="range"
                        min="${s.min}"
                        max="${s.max}"
                        value="${s.current}"
                        id="slider-${ch}"
                        onchange="mover(${ch}, 'angle', this.value)"
                        oninput="document.getElementById('val-display-${ch}').innerText = this.value + '°'"
                    >

                    <button class="btn-orange" onclick="mover(${ch}, 'step_up')">
                        +1°
                    </button>
                </div>
            </div>
        `;
    });
}

async function mover(channel, action, value = 0) {
    const res = await fetch("/api/move", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            channel,
            action,
            value
        })
    });

    const data = await res.json();

    if (data.status === "success") {
        const slider = document.getElementById(`slider-${channel}`);
        const display = document.getElementById(`val-display-${channel}`);

        if (slider) slider.value = data.current_angle;
        if (display) display.innerText = data.current_angle + "°";

        document.getElementById("info-global").innerHTML =
            `Movimiento Manual: Canal ${channel} -> ${data.current_angle}°.`;

        actualizarAnguloSugerido();
    }
}

async function irAHomeGlobal() {
    document.getElementById("info-global").innerHTML =
        "🚀 Enviando HOME al robot...";

    const res = await fetch("/api/home", {
        method: "POST"
    });

    const data = await res.json();

    if (data.status === "started") {
        document.getElementById("info-global").innerHTML =
            "✅ HOME enviado. El robot se está reposicionando.";
    } else if (data.status === "busy") {
        document.getElementById("info-global").innerHTML =
            "⚠️ Ya hay una secuencia ejecutándose.";
    } else {
        alert(data.message || "Error enviando HOME.");
    }

    actualizarEstado();
}

// ===============================
// PASOS INDIVIDUALES
// ===============================

function actualizarAnguloSugerido() {
    const ch = document.getElementById("step-channel").value;

    if (servosCached[ch]) {
        document.getElementById("step-angle").value = servosCached[ch].current;
    }
}

function renderTablaPasos(steps) {
    const tbody = document.getElementById("steps-table-body");
    tbody.innerHTML = "";

    const names = Object.keys(steps);

    if (names.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-text">
                    No hay pasos guardados.
                </td>
            </tr>
        `;
        return;
    }

    names.forEach(name => {
        const s = steps[name];

        const motorName = servosCached[s.channel]
            ? servosCached[s.channel].name
            : `Canal ${s.channel}`;

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:bold; color:#2c3e50;">
                    ${name}
                </td>

                <td>
                    ${motorName} (Ch ${s.channel})
                </td>

                <td>
                    <b style="color:#27ae60">${s.angle}°</b>
                </td>

                <td>
                    <input
                        type="number"
                        style="width:50px"
                        value="${s.interval}"
                        onchange="modificarFila('${name}', 'interval', this.value)"
                    > ms
                </td>

                <td>
                    <input
                        type="number"
                        style="width:50px"
                        step="0.1"
                        value="${s.delay}"
                        onchange="modificarFila('${name}', 'delay', this.value)"
                    > s
                </td>

                <td>
                    <button class="btn-blue" onclick="ejecutarPasoUnico('${name}')">
                        Probar
                    </button>

                    <button class="btn-purple" onclick="agregarACola('${name}')">
                        + Secuencia
                    </button>

                    <button class="btn-red" onclick="eliminarPaso('${name}')">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    });
}

async function crearPaso() {
    const name = document.getElementById("step-name").value.trim();
    const channel = document.getElementById("step-channel").value;
    const angle = document.getElementById("step-angle").value;
    const interval = document.getElementById("step-interval").value;
    const delay = document.getElementById("step-delay").value;

    if (!name) return alert("Por favor escribe un nombre para identificar el paso.");
    if (angle === "") return alert("Especifica un ángulo.");

    await fetch("/api/steps", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name,
            channel,
            angle: parseInt(angle),
            interval: parseInt(interval),
            delay: parseFloat(delay)
        })
    });

    document.getElementById("step-name").value = "";

    actualizarEstado();
}

async function modificarFila(name, campo, valor) {
    const res = await fetch("/api/status");
    const data = await res.json();

    const paso = data.steps[name];

    if (!paso) return;

    paso[campo] = campo === "interval"
        ? parseInt(valor)
        : parseFloat(valor);

    await fetch("/api/steps", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name: name,
            channel: paso.channel,
            angle: paso.angle,
            interval: paso.interval,
            delay: paso.delay
        })
    });

    actualizarEstado();
}

async function eliminarPaso(name) {
    const confirmar = confirm(`¿Eliminar paso: ${name}?`);

    if (!confirmar) return;

    await fetch("/api/steps/delete", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    actualizarEstado();
}

async function ejecutarPasoUnico(name) {
    document.getElementById("info-global").innerHTML =
        `🚀 Enviando paso individual: <b>${name}</b>`;

    const res = await fetch("/api/steps/run_single", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    const data = await res.json();

    if (data.status === "started") {
        document.getElementById("info-global").innerHTML =
            `✅ Paso enviado: <b>${name}</b>`;
    } else if (data.status === "busy") {
        document.getElementById("info-global").innerHTML =
            "⚠️ Ya hay una secuencia ejecutándose.";
    } else {
        alert(data.message || "Error ejecutando paso.");
    }

    actualizarEstado();
}

// ===============================
// CONSTRUCTOR DE SECUENCIA
// ===============================

function agregarACola(name) {
    listaSecuencia.push(name);
    actualizarVisualizacionCola();
}

function limpiarSecuencia() {
    listaSecuencia = [];
    actualizarVisualizacionCola();
}

function actualizarVisualizacionCola() {
    const q = document.getElementById("sequence-queue");

    if (listaSecuencia.length === 0) {
        q.innerText = "[ Secuencia Vacía ]";
        return;
    }

    q.innerHTML = listaSecuencia
        .map(item => `<span class="queue-item">${item}</span>`)
        .join(" ➔ ");
}

async function ejecutarSecuencia() {
    if (listaSecuencia.length === 0) {
        return alert("Añade pasos, movimientos o acciones a la secuencia primero.");
    }

    document.getElementById("info-global").innerHTML =
        "🚀 Enviando secuencia al robot...";

    const res = await fetch("/api/sequence/run", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            sequence: listaSecuencia
        })
    });

    const data = await res.json();

    if (data.status === "started") {
        document.getElementById("info-global").innerHTML =
            "✅ Secuencia enviada. El robot la está ejecutando.";
    } else if (data.status === "busy") {
        document.getElementById("info-global").innerHTML =
            "⚠️ Ya hay una secuencia ejecutándose.";
    } else {
        alert(data.message || "Error ejecutando secuencia.");
    }

    actualizarEstado();
}

// ===============================
// ACCIONES RÁPIDAS EDITABLES
// ===============================

function renderAccionesRapidas(quickActions) {
    const tbody = document.getElementById("quick-actions-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    const names = Object.keys(quickActions);

    if (names.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="empty-text">
                    No hay acciones rápidas creadas.
                </td>
            </tr>
        `;
        return;
    }

    names.forEach(name => {
        const action = quickActions[name];
        const sequenceText = action.sequence.join(" ➔ ");

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:bold; color:#2c3e50;">
                    ${name}
                </td>

                <td class="sequence-text">
                    ${sequenceText}
                </td>

                <td>
                    <button class="btn-green" onclick="ejecutarAccionRapida('${name}')">
                        Ejecutar
                    </button>

                    <button class="btn-blue" onclick="agregarAccionRapidaACola('${name}')">
                        + Ruta
                    </button>

                    <button class="btn-orange" onclick="editarAccionRapida('${name}')">
                        Editar
                    </button>

                    <button class="btn-red" onclick="eliminarAccionRapida('${name}')">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    });
}

async function guardarAccionRapida(mode) {
    const name = document.getElementById("quick-action-name").value.trim();

    if (!name) return alert("Escribe un nombre para la acción rápida.");
    if (listaSecuencia.length === 0) return alert("Primero arma una ruta en el constructor.");

    const res = await fetch("/api/quick_actions/save", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name,
            sequence: listaSecuencia,
            mode
        })
    });

    const data = await res.json();

    if (data.status === "success") {
        document.getElementById("info-global").innerHTML =
            `✅ Acción rápida guardada: <b>${name}</b>`;

        document.getElementById("quick-action-name").value = "";

        actualizarEstado();
    } else if (data.status === "exists") {
        document.getElementById("info-global").innerHTML =
            `⚠️ La acción rápida <b>${name}</b> ya existía. Se mantuvo sin cambios.`;
    } else {
        alert(data.message || "Error guardando acción rápida.");
    }
}

async function ejecutarAccionRapida(name) {
    const confirmar = confirm(`¿Ejecutar acción rápida: ${name}?`);

    if (!confirmar) return;

    document.getElementById("info-global").innerHTML =
        `🚀 Enviando acción rápida: <b>${name}</b>`;

    const res = await fetch("/api/quick_actions/run", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    const data = await res.json();

    if (data.status === "started") {
        document.getElementById("info-global").innerHTML =
            `✅ Acción rápida enviada: <b>${name}</b>`;
    } else if (data.status === "busy") {
        document.getElementById("info-global").innerHTML =
            "⚠️ Ya hay una secuencia ejecutándose.";
    } else {
        alert(data.message || "Error ejecutando acción rápida.");
    }

    actualizarEstado();
}

function agregarAccionRapidaACola(name) {
    listaSecuencia.push(name);
    actualizarVisualizacionCola();
}

function editarAccionRapida(name) {
    if (!quickActionsCached[name]) return;

    document.getElementById("quick-action-name").value = name;

    listaSecuencia = [...quickActionsCached[name].sequence];

    actualizarVisualizacionCola();

    document.getElementById("info-global").innerHTML =
        `✏️ Editando acción rápida: <b>${name}</b>. Modifica la ruta y presiona Crear / Editar.`;
}

async function eliminarAccionRapida(name) {
    const confirmar = confirm(`¿Eliminar acción rápida: ${name}?`);

    if (!confirmar) return;

    await fetch("/api/quick_actions/delete", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    document.getElementById("info-global").innerHTML =
        `🗑️ Acción rápida eliminada: <b>${name}</b>`;

    actualizarEstado();
}

// ===============================
// MOVIMIENTOS CREADOS
// ===============================

function renderMovimientosCreados(movements) {
    const tbody = document.getElementById("movements-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    const names = Object.keys(movements);

    if (names.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="empty-text">
                    No hay movimientos creados.
                </td>
            </tr>
        `;
        return;
    }

    names.forEach(name => {
        const movement = movements[name];
        const sequenceText = movement.sequence.join(" ➔ ");

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:bold; color:#2c3e50;">
                    ${name}
                </td>

                <td class="sequence-text">
                    ${sequenceText}
                </td>

                <td>
                    <button class="btn-green" onclick="ejecutarMovimientoCreado('${name}')">
                        Ejecutar
                    </button>

                    <button class="btn-blue" onclick="agregarMovimientoCreadoACola('${name}')">
                        + Ruta
                    </button>

                    <button class="btn-orange" onclick="editarMovimientoCreado('${name}')">
                        Editar
                    </button>

                    <button class="btn-red" onclick="eliminarMovimientoCreado('${name}')">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    });
}

async function guardarMovimiento(mode) {
    const name = document.getElementById("movement-name").value.trim();

    if (!name) return alert("Escribe un nombre para el movimiento.");
    if (listaSecuencia.length === 0) return alert("Primero arma una ruta en el constructor.");

    const res = await fetch("/api/movements/save", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name,
            sequence: listaSecuencia,
            mode
        })
    });

    const data = await res.json();

    if (data.status === "success") {
        document.getElementById("info-global").innerHTML =
            `✅ Movimiento guardado: <b>${name}</b>`;

        document.getElementById("movement-name").value = "";

        actualizarEstado();
    } else if (data.status === "exists") {
        document.getElementById("info-global").innerHTML =
            `⚠️ El movimiento <b>${name}</b> ya existía. Se mantuvo sin cambios.`;
    } else {
        alert(data.message || "Error guardando movimiento.");
    }
}

async function ejecutarMovimientoCreado(name) {
    const confirmar = confirm(`¿Ejecutar movimiento creado: ${name}?`);

    if (!confirmar) return;

    document.getElementById("info-global").innerHTML =
        `🚀 Enviando movimiento creado: <b>${name}</b>`;

    const res = await fetch("/api/movements/run", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    const data = await res.json();

    if (data.status === "started") {
        document.getElementById("info-global").innerHTML =
            `✅ Movimiento enviado: <b>${name}</b>`;
    } else if (data.status === "busy") {
        document.getElementById("info-global").innerHTML =
            "⚠️ Ya hay una secuencia ejecutándose.";
    } else {
        alert(data.message || "Error ejecutando movimiento.");
    }

    actualizarEstado();
}

function agregarMovimientoCreadoACola(name) {
    listaSecuencia.push(name);
    actualizarVisualizacionCola();
}

function editarMovimientoCreado(name) {
    if (!movementsCached[name]) return;

    document.getElementById("movement-name").value = name;

    listaSecuencia = [...movementsCached[name].sequence];

    actualizarVisualizacionCola();

    document.getElementById("info-global").innerHTML =
        `✏️ Editando movimiento: <b>${name}</b>. Modifica la ruta y presiona Crear / Editar.`;
}

async function eliminarMovimientoCreado(name) {
    const confirmar = confirm(`¿Eliminar movimiento creado: ${name}?`);

    if (!confirmar) return;

    await fetch("/api/movements/delete", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name
        })
    });

    document.getElementById("info-global").innerHTML =
        `🗑️ Movimiento eliminado: <b>${name}</b>`;

    actualizarEstado();
}

// ===============================
// INICIO
// ===============================

actualizarEstado();

setInterval(actualizarEstado, 3000);
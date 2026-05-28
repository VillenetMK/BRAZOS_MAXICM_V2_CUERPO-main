import json
import os
import time
import threading
from pathlib import Path

import serial
import serial.tools.list_ports
from flask import Flask, jsonify, render_template, request


# ===============================
# BASE DEL PROYECTO
# ===============================

BASE_DIR = Path(__file__).resolve().parent

STEPS_FILE = BASE_DIR / "pasos_individuales.json"
MOVEMENTS_FILE = BASE_DIR / "movimientos_creados.json"
QUICK_ACTIONS_FILE = BASE_DIR / "acciones_rapidas.json"

app = Flask(__name__)


# ===============================
# CONFIGURACIÓN SERIAL
# ===============================

BAUD_RATE = 115200
serial_lock = threading.Lock()


def detectar_puerto_esp32():
    ports = list(serial.tools.list_ports.comports())

    if not ports:
        return None

    keywords = [
        "USB",
        "UART",
        "CP210",
        "CP210x",
        "CH340",
        "CH341",
        "Silicon Labs",
        "USB Serial",
        "USB2.0-Serial",
        "ACM",
        "Arduino",
        "Espressif",
        "ESP32",
    ]

    for port in ports:
        text = f"{port.device} {port.description} {port.manufacturer}"
        for key in keywords:
            if key.lower() in text.lower():
                return port.device

    for port in ports:
        if port.device.startswith("/dev/ttyUSB") or port.device.startswith("/dev/ttyACM"):
            return port.device

    return ports[0].device


SERIAL_PORT = detectar_puerto_esp32()
esp32 = None

try:
    if SERIAL_PORT:
        esp32 = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)
        print(f"Conectado exitosamente al ESP32 en {SERIAL_PORT}")
    else:
        print("No se detectó puerto serial. Modo simulación activado.")
except Exception as e:
    print(f"Advertencia: No se pudo conectar al ESP32 ({e}). Modo simulación activado.")
    esp32 = None


# ===============================
# CONTROL DE SECUENCIAS EN SEGUNDO PLANO
# ===============================

sequence_running = False
sequence_lock = threading.Lock()


def ejecutar_lista_pasos_background(sequence_names):
    global sequence_running

    try:
        ejecutar_lista_pasos(sequence_names)
    except Exception as e:
        print(f"ERROR ejecutando secuencia en segundo plano: {e}")
    finally:
        with sequence_lock:
            sequence_running = False


def iniciar_secuencia_background(sequence_names):
    global sequence_running

    with sequence_lock:
        if sequence_running:
            return False

        sequence_running = True

    hilo = threading.Thread(
        target=ejecutar_lista_pasos_background,
        args=(sequence_names,),
        daemon=True,
    )

    hilo.start()
    return True


# ===============================
# CONFIGURACIÓN DE SERVOS
# ===============================

SERVOS_CONFIG = {
    0: {
        "name": "Brazo 1 IZQ Hombro",
        "min": 0,
        "max": 145,
        "current": 135,
        "home": 135,
        "interval": 5,
    },
    1: {
        "name": "Brazo 1 IZQ Codo Rot",
        "min": 0,
        "max": 200,
        "current": 110,
        "home": 110,
        "interval": 5,
    },
    2: {
        "name": "Brazo 1 IZQ Codo Vert",
        "min": 0,
        "max": 75,
        "current": 75,
        "home": 75,
        "interval": 5,
    },
    4: {
        "name": "Brazo 2 DER Hombro",
        "min": 125,
        "max": 270,
        "current": 135,
        "home": 135,
        "interval": 5,
    },
    5: {
        "name": "Brazo 2 DER Codo Rot",
        "min": 0,
        "max": 150,
        "current": 50,
        "home": 50,
        "interval": 5,
    },
    6: {
        "name": "Brazo 2 DER Codo Vert",
        "min": 0,
        "max": 270,
        "current": 0,
        "home": 0,
        "interval": 5,
    },
}


# ===============================
# JSON HELPERS
# ===============================

def load_json_file(path):
    if not os.path.exists(path):
        return {}

    try:
        with open(path, "r", encoding="utf-8") as file:
            content = file.read().strip()

            if not content:
                return {}

            return json.loads(content)

    except json.JSONDecodeError:
        print(f"ERROR: JSON inválido en {path}")
        return {}


def save_json_file(path, data):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)


def load_steps():
    return load_json_file(STEPS_FILE)


def save_steps(steps):
    save_json_file(STEPS_FILE, steps)


def load_movements():
    return load_json_file(MOVEMENTS_FILE)


def save_movements(movements):
    save_json_file(MOVEMENTS_FILE, movements)


def load_quick_actions():
    return load_json_file(QUICK_ACTIONS_FILE)


def save_quick_actions(actions):
    save_json_file(QUICK_ACTIONS_FILE, actions)


# ===============================
# COMUNICACIÓN ESP32
# ===============================

def enviar_comando(comando):
    with serial_lock:
        if esp32 and esp32.is_open:
            esp32.write(f"{comando}\n".encode("utf-8"))
            print(f"Enviado a ESP32: {comando}")
        else:
            print(f"[Simulación] Comando: {comando}")


def limitar_angulo(channel, angle):
    config = SERVOS_CONFIG[channel]
    return max(config["min"], min(config["max"], int(angle)))


def calcular_movimiento_suave(channel, nuevo_angulo, custom_interval=None):
    config = SERVOS_CONFIG[channel]
    angulo_actual = config["current"]
    intervalo = custom_interval if custom_interval is not None else config["interval"]

    pulsos_actual = 100 + int((angulo_actual * 420) / 270)
    pulsos_nuevo = 100 + int((nuevo_angulo * 420) / 270)
    diferencia_pulsos = abs(pulsos_nuevo - pulsos_actual)

    tiempo_estimado_ms = diferencia_pulsos * intervalo
    return tiempo_estimado_ms / 1000.0


def ejecutar_paso_individual(step_data):
    channel = int(step_data["channel"])
    target_angle = limitar_angulo(channel, int(step_data["angle"]))
    speed_interval = int(step_data.get("interval", 5))

    enviar_comando(f"V {channel} {speed_interval}")
    SERVOS_CONFIG[channel]["interval"] = speed_interval

    tiempo_viaje = calcular_movimiento_suave(channel, target_angle, speed_interval)

    SERVOS_CONFIG[channel]["current"] = target_angle
    enviar_comando(f"{channel} {target_angle}")

    return tiempo_viaje


def ejecutar_home_general():
    comando_bulk = ""
    tiempos_home = []

    for ch, config in SERVOS_CONFIG.items():
        enviar_comando(f"V {ch} 5")
        config["interval"] = 5

        tiempos_home.append(calcular_movimiento_suave(ch, config["home"], 5))

        config["current"] = config["home"]
        comando_bulk += f"{ch} {config['home']} "

    enviar_comando(comando_bulk.strip())

    return max(tiempos_home) if tiempos_home else 1


def ejecutar_lista_pasos(sequence_names, visited=None):
    if visited is None:
        visited = set()

    steps = load_steps()
    movements = load_movements()
    quick_actions = load_quick_actions()

    for name in sequence_names:

        # HOME especial
        if name == "[ IR A HOME COMIENZO ]":
            ejecutar_home_general()
            continue

        # Evita bucle infinito si una acción se llama a sí misma
        if name in visited:
            print(f"Advertencia: referencia circular detectada en {name}. Se omitió.")
            continue

        # Acción rápida desde acciones_rapidas.json
        if name in quick_actions:
            visited.add(name)
            ejecutar_lista_pasos(quick_actions[name].get("sequence", []), visited)
            visited.remove(name)
            continue

        # Movimiento creado desde movimientos_creados.json
        if name in movements:
            visited.add(name)
            ejecutar_lista_pasos(movements[name].get("sequence", []), visited)
            visited.remove(name)
            continue

        # Paso individual desde pasos_individuales.json
        if name in steps:
            step_data = steps[name]

            channel = int(step_data["channel"])
            angle = int(step_data["angle"])
            interval = int(step_data.get("interval", 5))
            delay = float(step_data.get("delay", 0))

            angle = limitar_angulo(channel, angle)

            print(
                f"JSON directo -> {name}: "
                f"V {channel} {interval} | {channel} {angle} | delay={delay}"
            )

            enviar_comando(f"V {channel} {interval}")
            enviar_comando(f"{channel} {angle}")

            SERVOS_CONFIG[channel]["interval"] = interval
            SERVOS_CONFIG[channel]["current"] = angle

            # Solo espera si tú pusiste delay manual en el JSON
            if delay > 0:
                time.sleep(delay)

            continue

        print(f"Advertencia: no encontrado en JSON: {name}")


# ===============================
# RUTAS WEB
# ===============================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def get_status():
    return jsonify(
        {
            "serial_port": SERIAL_PORT,
            "serial_connected": bool(esp32 and esp32.is_open),
            "sequence_running": sequence_running,
            "servos": SERVOS_CONFIG,
            "steps": load_steps(),
            "movements": load_movements(),
            "quick_actions": load_quick_actions(),
        }
    )


@app.route("/api/move", methods=["POST"])
def move_servo():
    data = request.json

    channel = int(data["channel"])
    action = data["action"]

    config = SERVOS_CONFIG[channel]
    target_angle = config["current"]

    if action == "step_up":
        target_angle = min(config["max"], config["current"] + 1)
    elif action == "step_down":
        target_angle = max(config["min"], config["current"] - 1)
    elif action == "angle":
        target_angle = limitar_angulo(channel, int(data["value"]))

    tiempo_segundos = calcular_movimiento_suave(channel, target_angle)

    config["current"] = target_angle
    enviar_comando(f"{channel} {target_angle}")

    return jsonify(
        {
            "status": "success",
            "current_angle": target_angle,
            "estimated_time_seconds": round(tiempo_segundos, 3),
        }
    )


@app.route("/api/home", methods=["POST"])
def go_home():
    started = iniciar_secuencia_background(["[ IR A HOME COMIENZO ]"])

    if not started:
        return jsonify(
            {
                "status": "busy",
                "message": "Ya hay una secuencia ejecutándose",
            }
        ), 409

    return jsonify(
        {
            "status": "started",
            "message": "Home enviado al robot",
        }
    )


# ===============================
# PASOS INDIVIDUALES
# ===============================

@app.route("/api/steps", methods=["POST"])
def save_step():
    data = request.json

    step_name = data.get("name", "").strip()
    channel = int(data["channel"])
    angle = limitar_angulo(channel, int(data["angle"]))
    interval = int(data.get("interval", 5))
    delay = float(data.get("delay", 0.5))

    if not step_name:
        return jsonify({"status": "error", "message": "Nombre vacío"}), 400

    steps = load_steps()
    steps[step_name] = {
        "channel": channel,
        "angle": angle,
        "interval": interval,
        "delay": delay,
    }

    save_steps(steps)

    return jsonify({"status": "success", "steps": steps})


@app.route("/api/steps/delete", methods=["POST"])
def delete_step():
    data = request.json
    step_name = data.get("name", "").strip()

    steps = load_steps()

    if step_name in steps:
        del steps[step_name]
        save_steps(steps)
        return jsonify({"status": "success", "steps": steps})

    return jsonify({"status": "error", "message": "Paso no encontrado"}), 400


@app.route("/api/steps/run_single", methods=["POST"])
def run_single_step():
    data = request.json
    step_name = data.get("name", "").strip()

    steps = load_steps()

    if step_name in steps:
        started = iniciar_secuencia_background([step_name])

        if not started:
            return jsonify(
                {
                    "status": "busy",
                    "message": "Ya hay una secuencia ejecutándose",
                }
            ), 409

        return jsonify(
            {
                "status": "started",
                "message": "Paso enviado al robot",
            }
        )

    return jsonify({"status": "error", "message": "Paso no encontrado"}), 400


# ===============================
# SECUENCIA GENERAL
# ===============================

@app.route("/api/sequence/run", methods=["POST"])
def run_sequence():
    data = request.json
    sequence_names = data.get("sequence", [])

    if not sequence_names:
        return jsonify({"status": "error", "message": "Secuencia vacía"}), 400

    started = iniciar_secuencia_background(sequence_names)

    if not started:
        return jsonify(
            {
                "status": "busy",
                "message": "Ya hay una secuencia ejecutándose",
            }
        ), 409

    return jsonify(
        {
            "status": "started",
            "message": "Secuencia enviada al robot",
        }
    )


# ===============================
# MOVIMIENTOS CREADOS
# ===============================

@app.route("/api/movements/save", methods=["POST"])
def save_movement():
    data = request.json

    movement_name = data.get("name", "").strip()
    sequence = data.get("sequence", [])
    mode = data.get("mode", "replace")

    if not movement_name:
        return jsonify({"status": "error", "message": "Nombre vacío"}), 400

    if not sequence:
        return jsonify({"status": "error", "message": "Secuencia vacía"}), 400

    movements = load_movements()

    if mode == "keep" and movement_name in movements:
        return jsonify(
            {
                "status": "exists",
                "message": "El movimiento ya existe y se mantuvo sin cambios",
                "movements": movements,
            }
        )

    if mode == "append" and movement_name in movements:
        old_sequence = movements[movement_name].get("sequence", [])
        movements[movement_name]["sequence"] = old_sequence + sequence
        movements[movement_name]["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    else:
        movements[movement_name] = {
            "name": movement_name,
            "sequence": sequence,
            "created_at": movements.get(movement_name, {}).get(
                "created_at",
                time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    save_movements(movements)

    return jsonify({"status": "success", "movements": movements})


@app.route("/api/movements/delete", methods=["POST"])
def delete_movement():
    data = request.json
    movement_name = data.get("name", "").strip()

    movements = load_movements()

    if movement_name in movements:
        del movements[movement_name]
        save_movements(movements)
        return jsonify({"status": "success", "movements": movements})

    return jsonify({"status": "error", "message": "Movimiento no encontrado"}), 400


@app.route("/api/movements/run", methods=["POST"])
def run_movement():
    data = request.json
    movement_name = data.get("name", "").strip()

    movements = load_movements()

    if movement_name not in movements:
        return jsonify({"status": "error", "message": "Movimiento no encontrado"}), 400

    started = iniciar_secuencia_background(movements[movement_name]["sequence"])

    if not started:
        return jsonify(
            {
                "status": "busy",
                "message": "Ya hay una secuencia ejecutándose",
            }
        ), 409

    return jsonify(
        {
            "status": "started",
            "movement": movement_name,
            "message": "Movimiento enviado al robot",
        }
    )


# ===============================
# ACCIONES RÁPIDAS EDITABLES
# ===============================

@app.route("/api/quick_actions/save", methods=["POST"])
def save_quick_action():
    data = request.json

    action_name = data.get("name", "").strip()
    sequence = data.get("sequence", [])
    mode = data.get("mode", "replace")

    if not action_name:
        return jsonify({"status": "error", "message": "Nombre vacío"}), 400

    if not sequence:
        return jsonify({"status": "error", "message": "Secuencia vacía"}), 400

    actions = load_quick_actions()

    if mode == "keep" and action_name in actions:
        return jsonify(
            {
                "status": "exists",
                "message": "La acción rápida ya existe y se mantuvo sin cambios",
                "quick_actions": actions,
            }
        )

    if mode == "append" and action_name in actions:
        old_sequence = actions[action_name].get("sequence", [])
        actions[action_name]["sequence"] = old_sequence + sequence
        actions[action_name]["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    else:
        actions[action_name] = {
            "name": action_name,
            "sequence": sequence,
            "created_at": actions.get(action_name, {}).get(
                "created_at",
                time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    save_quick_actions(actions)

    return jsonify({"status": "success", "quick_actions": actions})


@app.route("/api/quick_actions/delete", methods=["POST"])
def delete_quick_action():
    data = request.json
    action_name = data.get("name", "").strip()

    actions = load_quick_actions()

    if action_name in actions:
        del actions[action_name]
        save_quick_actions(actions)
        return jsonify({"status": "success", "quick_actions": actions})

    return jsonify({"status": "error", "message": "Acción rápida no encontrada"}), 400


@app.route("/api/quick_actions/run", methods=["POST"])
def run_quick_action():
    data = request.json
    action_name = data.get("name", "").strip()

    actions = load_quick_actions()

    if action_name not in actions:
        return jsonify({"status": "error", "message": "Acción rápida no encontrada"}), 400

    started = iniciar_secuencia_background(actions[action_name]["sequence"])

    if not started:
        return jsonify(
            {
                "status": "busy",
                "message": "Ya hay una secuencia ejecutándose",
            }
        ), 409

    return jsonify(
        {
            "status": "started",
            "action": action_name,
            "message": "Acción rápida enviada al robot",
        }
    )


# ===============================
# MAIN
# ===============================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
        use_reloader=False,
        threaded=True,
    )
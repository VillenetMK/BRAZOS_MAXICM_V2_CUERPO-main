#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// Define custom I2C pins for the ESP32
#define I2C_SDA 21
#define I2C_SCL 22
// Initialize the PCA9685 object
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40, Wire);
// Servo parameters
#define SERVOMIN 100  // Minimum pulse length
#define SERVOMAX 520  // Maximum pulse length
#define SERVO_INTERVAL 5 // ms between steps for smooth motion

// Structure to track each servo's state
struct ServoState {
  int channel;
  int currentPulse;
  int targetPulse;
  unsigned long lastUpdate;
  unsigned long interval; // ms entre pasos. 0 = instantáneo.
  const char* name;
  int initialAngle;
};

// Brazo 1: Channel 0 (Hombro), 1 (Codo Rot), 2 (Codo Vert)
// Brazo 2: Channel 4 (Hombro), 5 (Codo Rot), 6 (Codo Vert)
/*Brazo 1 izquierdo 
Eje 1 chanel 0 ángulo de 0° a 145°, centrado en 135° 
Eje 2 chanel 1 ángulo de 0° a 110°, centrado en 110° 
Eje 3 chanel 2 ángulo de 0° a 75°,  centrado en 75°

Brazo 2 derecho 
Eje 1 chanel 4 ángulo de 135° a 275°, centrado en 135° 
Eje 2 chanel 5 ángulo de 60°  a 150°, centrado en 50° 
Eje 3 chanel 6 ángulo de 0° a 80°,    centrado en 0° */

ServoState servos[6] = {
  //{channel,currentPulse,targetPulse,lastUpdate,interval,name,initialAngle}
  {0, 310, 310, 0, SERVO_INTERVAL, "Brazo 1 Hombro (Ch0)", 135},
  {1, 310, 310, 0, SERVO_INTERVAL, "Brazo 1 Codo Rot (Ch1)", 110},
  {2, 310, 310, 0, SERVO_INTERVAL, "Brazo 1 Codo Vert (Ch2)", 75},
  {4, 310, 310, 0, SERVO_INTERVAL, "Brazo 2 Hombro (Ch4)", 135},
  {5, 310, 310, 0, SERVO_INTERVAL, "Brazo 2 Codo Rot (Ch5)", 50},
  {6, 310, 310, 0, SERVO_INTERVAL, "Brazo 2 Codo Vert (Ch6)", 0}
};

// Helper to convert angle (0-270) to pulse (SERVOMIN-SERVOMAX)
int angleToPulse(int angle) {
  // Verificación de restricciones para el ángulo de entrada
  if (angle < 0) angle = 0;
  if (angle > 270) angle = 270;
  return map(angle, 0, 270, SERVOMIN, SERVOMAX);
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  //Serial.println("--- GUIA Control de Angulo de Brazos 270° ---");
  //Serial.println("Comandos disponibles:");
  //Serial.println(" - Mover:   <canal> <angulo>            (ej. '0 135' o '0 90 1 180')");
  //Serial.println(" - Velocid: V <canal> <intervalo>     (ej. 'V 0 10' o 'V 1 0')");
  //Serial.println("   (Intervalo en ms por paso. 0=muy rápido, 10=lento. Defecto=3)");
  /*
  Brazo 1 izquierdo: 
    Eje 1 chanel 0 ángulo de 0° a 145°, centrado en 135° 
    Eje 2 chanel 1 ángulo de 0° a 110°, centrado en 90° 
    Eje 3 chanel 2 ángulo de 0° a 75°,  centrado en 75°

  Brazo 2 derecho:
    Eje 1 chanel 4 ángulo de 135° a 275°, centrado en 135° 
    Eje 2 chanel 5 ángulo de 60°  a 150°, centrado en 60° 
    Eje 3 chanel 6 ángulo de 0° a 80°,    centrado en 0° */

  if (Wire.begin(I2C_SDA, I2C_SCL)) {
    Serial.println("I2C inicializado correctamente.");
  } else {
    Serial.println("Fallo en la inicialización de I2C!");
    delay(250);
    while (true);
  }

  pwm.begin();
  pwm.setPWMFreq(50);
  
  // 1. Inicializar servos en la posición asumida (pulso 310 / 135°) y definir su destino real
  for (int i = 0; i < 6; i++) {
    // Enganchamos el servo en la posición por defecto actual
    pwm.setPWM(servos[i].channel, 0, servos[i].currentPulse); 
    // Configuramos el objetivo final al ángulo de inicio independiente
    servos[i].targetPulse = angleToPulse(servos[i].initialAngle);
    servos[i].lastUpdate = millis();

    //delay(150);
  }

  // 2. Bucle de Homing suave: Mover los servos poco a poco hasta su posición inicial
  Serial.println("Iniciando Homing suave a posiciones de inicio...");
  bool allHome = false;
  while (!allHome) {
    allHome = true;
    for (int i = 0; i < 6; i++) {
      updateServo(servos[i]);
      if (servos[i].currentPulse != servos[i].targetPulse) {
        allHome = false;
      }
    }
    delay(1); // Pequeño retardo para no sobrecargar la CPU del ESP32
  }
  Serial.println("PCA9685 listo. Ambos brazos en sus posiciones iniciales configuradas.");
}

void updateServo(ServoState &s) {
  if (s.currentPulse == s.targetPulse) return;

  // Si el intervalo es 0, el movimiento es instantáneo
  if (s.interval == 0) {
    s.currentPulse = s.targetPulse;
    pwm.setPWM(s.channel, 0, s.currentPulse);
    return;
  }

  unsigned long currentMillis = millis();
  if (currentMillis - s.lastUpdate >= s.interval) {
    s.lastUpdate = currentMillis;

    // Mover el pulso actual más cerca del pulso objetivo
    if (s.currentPulse < s.targetPulse) {
      s.currentPulse++;
    } else {
      s.currentPulse--;
    }

    pwm.setPWM(s.channel, 0, s.currentPulse);
  }
}

char serialBuffer[64];
int bufferIndex = 0;

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    
    // Si hay un salto de línea o el buffer está lleno, procesar los comandos en el buffer
    if (c == '\n' || c == '\r' || bufferIndex >= 63) {
      if (bufferIndex > 0) {
        serialBuffer[bufferIndex] = '\0';
        
        // Verificamos si es comando de velocidad (V)
        if (serialBuffer[0] == 'V' || serialBuffer[0] == 'v') {
          int channel, interval;
          if (sscanf(serialBuffer + 1, "%d %d", &channel, &interval) == 2) {
            for (int i = 0; i < 6; i++) {
              if (servos[i].channel == channel) {
                servos[i].interval = interval;
                Serial.print("ACK: Vel ");
                Serial.print(servos[i].name);
                Serial.print(" ajustada a ");
                Serial.print(interval);
                Serial.println(" ms/paso");
                break;
              }
            }
          } else {
            Serial.println("ERR: Comando V mal formado. Ej: V 0 10");
          }
        } else {
          // Es un comando de movimiento normal
          char* ptr = serialBuffer;
          int channel, angle, bytesRead;        
          // Buscar pares de enteros mientras haya datos restantes en el buffer
          while (sscanf(ptr, "%d %d%n", &channel, &angle, &bytesRead) == 2) {
            ptr += bytesRead; // Mover el puntero a la siguiente parte de la cadena
            
            if ((channel >= 0 && channel <= 2) || (channel >= 4 && channel <= 6)) {
              int pulse = angleToPulse(angle);
              
              for (int i = 0; i < 6; i++) {
                if (servos[i].channel == channel) {
                  servos[i].targetPulse = pulse;
                  Serial.print("ACK: Movido ");
                  Serial.print(servos[i].name);
                  Serial.print(" a ");
                  Serial.println(angle);
                  break;
                }
              }
            }
          }
        }
        bufferIndex = 0; // Reset buffer
      }
    } else {
      serialBuffer[bufferIndex++] = c;
    }
  }
}

void loop() {
  handleSerial();

  for (int i = 0; i < 6; i++) {
    updateServo(servos[i]);
  }
}
# ProtoLab Studio — Electrónica y Robótica 3D

Sitio web estático para crear y probar montajes de electrónica y modelos educativos de robótica desde el navegador. No incluye BAT, instalador ni servidor local.

## Publicar con GitHub Pages

1. Crea un repositorio en GitHub.
2. Sube `index.html`, `app.js` y `.nojekyll` a la raíz del repositorio mediante **Add file → Upload files**.
3. Entra en **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Elige la rama `main` y la carpeta `/(root)`, y guarda.
6. Abre la URL HTTPS que GitHub Pages muestra en esa sección.

No hay que ejecutar programas en Windows. Para usar el visor 3D con módulos ES, abre la versión publicada en HTTPS; los navegadores restringen esos módulos cuando se usa `file://`.

## Placas disponibles

Arduino UNO R3, UNO R4 WiFi, Mega 2560, Nano, Leonardo, Teensy 4.1, ESP32 DevKit, ESP32-S3, ESP8266 NodeMCU, Raspberry Pi Pico, Pico W y STM32 Blue Pill.

## Componentes y módulos

LED y RGB, LCD 16×2, OLED 128×64, matriz LED 8×8, display de 7 segmentos, buzzer, servo SG90, motores DC, drivers L298N y A4988, driver PWM PCA9685, HC-SR04, DHT22, MPU6050, LDR, joystick, seguidor de línea, PIR, humedad de suelo, BMP280, RFID RC522, resistencias, condensadores, transistores y relés.

## Modelos de robótica

Brazo articulado de 4 GDL, brazo de 6 GDL con pinza, rover 4WD, robot hexápodo de seis patas, pinza y banda transportadora. También incluye un dron cuadricóptero educativo con cuatro rotores virtuales. Los ejemplos de proyecto pueden montar automáticamente los modelos, placas y conexiones asociados.

## Ejemplos precargados

Parpadeo, PWM, LCD, OLED, matriz LED, servo, botón, potenciómetro, zumbador, ESP32, brazo 4 ejes, brazo 6 GDL, rover, seguidor de línea, hexápodo, motor paso a paso, dron, semáforo, estacionamiento ultrasónico, riego automático, DHT22, relé, MPU6050 y banda transportadora.

## Guardar proyectos

La aplicación conserva el proyecto en el almacenamiento local del navegador y permite exportarlo como JSON. Los modelos, ajustes y conexiones principales se pueden guardar y cargar.

## Alcance de la simulación

La escena 3D, las articulaciones, rotores, ruedas, pantallas y salidas tienen animación e interacción visual. El editor ejecuta un subconjunto educativo de Arduino C++ implementado en JavaScript; no compila firmware real, no programa placas físicas y no sustituye un simulador SPICE ni un emulador completo de microcontroladores. El dron es una visualización didáctica, no un simulador de vuelo ni de control de estabilidad real.

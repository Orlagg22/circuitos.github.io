# ProtoLab Studio — Laboratorio v5

Versión web estática ampliada del proyecto ProtoLab Studio. No utiliza BAT, instaladores ni comandos para el usuario final. Publica los archivos en GitHub Pages o un hosting HTTPS estático.

## Archivos
- `index.html`: interfaz y estilos.
- `app.js`: escena Three.js, modelos, cableado, editor y simulación.
- `.nojekyll`: evita procesamiento innecesario de GitHub Pages.

## Mejoras v5
- Banco de pruebas con multímetro virtual (VDC, Ω, continuidad y corriente estimada).
- Osciloscopio virtual con trazas para pines, señales PWM/ADC y generador senoidal/cuadrado/triangular.
- Fuente DC de banco colocable en la escena, con bornes + / −, tensión ajustable y límite de corriente; puede conectarse por cables y medirse con las puntas virtuales.
- Diagnóstico automático de rutas LED, resistencias limitadoras, pantallas I²C y avisos de alimentación de motores.
- Estimación didáctica de disipación en resistencias con cambio visual de temperatura.
- Audio opcional Web Audio, activado por el usuario, con volumen.
- Exportación CSV de lista de materiales.
- Nuevos componentes 3D: diodo rectificador, Zener, MOSFET canal N, inductor, fusible, regulador 7805, temporizador NE555 y LM358.
- Nuevos ejemplos: divisor resistivo/ADC, motor DC con PWM, HC-SR04, MOSFET + carga y temporizador NE555.
- Mejoras de reflejos PBR y tono cinematográfico en la vista 3D.
- API educativa extendida con `millis()`, `map()`, `constrain()`, `min()`, `max()` y `abs()`, además de un límite de instrucciones para evitar ciclos que congelen el navegador.

## Publicar
Sube `index.html`, `app.js` y `.nojekyll` a la raíz del repositorio. Activa GitHub Pages desde Settings → Pages → Deploy from a branch → main → /(root). Abre la URL HTTPS.

## Alcance y precisión
Las mediciones, el osciloscopio, los semiconductores y los avisos térmicos son modelos educativos aproximados. No equivalen a un solver SPICE, no modelan todos los parámetros dinámicos de diodos/MOSFET/inductores/condensadores, y no sustituyen multímetros u osciloscopios físicos. El generador es una referencia visual de señal y no una fuente conectada al circuito. El audio se genera localmente con Web Audio API.

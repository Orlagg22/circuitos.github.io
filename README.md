# ProtoLab Studio — sitio web estático

Esta versión no contiene archivos `.bat`, servidores locales ni instaladores. Está preparada para publicarse como sitio web estático (por ejemplo, GitHub Pages). Una vez publicada, se abre desde una URL HTTPS normal y todo se utiliza desde el navegador.

## Publicar con GitHub Pages (sin comandos)

1. En GitHub, crea un repositorio nuevo llamado `protolab-studio`.
2. En el repositorio, usa **Add file → Upload files**.
3. Sube `index.html`, `app.js` y `.nojekyll` desde esta carpeta.
4. Pulsa **Commit changes**.
5. Abre **Settings → Pages**.
6. En **Build and deployment**, elige **Deploy from a branch**.
7. Selecciona la rama `main` y la carpeta `/(root)`, y guarda.
8. Cuando GitHub termine de publicar, abre la URL que aparece en esa misma sección. Normalmente tendrá el formato `https://TU-USUARIO.github.io/protolab-studio/`.

No hay que ejecutar nada en Windows. Para actualizar la web, vuelve a subir los archivos al mismo repositorio y confirma los cambios.

## Importante sobre abrir `index.html` directamente

El motor 3D usa módulos ES de Three.js cargados desde jsDelivr. Los navegadores bloquean o restringen la importación de módulos desde direcciones `file://`. Por eso, hacer doble clic en `index.html` no equivale a visitar una web. La solución web-only es publicarlo en HTTPS con GitHub Pages (u otro hosting estático). No requiere BAT ni Python.

## Archivos

- `index.html`: interfaz, estilos y carga del motor 3D.
- `app.js`: escena 3D, protoboard, placas Arduino/ESP32, componentes, cableado, inventario, monitor e intérprete educativo de código.
- `.nojekyll`: evita transformaciones innecesarias al publicar el sitio.

## Alcance del simulador

La ejecución de Arduino C++ es un subconjunto educativo implementado en JavaScript; no compila firmware para placas físicas y no sustituye un simulador SPICE ni un emulador de microcontroladores completo.

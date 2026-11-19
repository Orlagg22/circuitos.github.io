# ProtoLab Studio — Electronics v6 (hotfix gráfico)

Aplicación web estática para GitHub Pages. No requiere BAT, Python, terminal ni instalación.

## Publicación
Sube juntos `index.html`, `app.js` y `.nojekyll` al directorio raíz de tu repositorio GitHub Pages. Ambos archivos HTML y JS deben quedar en la misma carpeta.

## Corrección del motor gráfico
Esta revisión intenta crear WebGL con perfiles de compatibilidad, priorizando GPU integrada y desactivando antialiasing cuando el equipo no lo soporta. Reduce el pixel ratio y el tamaño de sombras para evitar fallos por presión gráfica. Si el motor no inicia, muestra el error real, el estado de WebGL y un botón para reintentar.

## Si aparece de nuevo el error
1. Abre la web en Chrome o Edge actualizado.
2. En Configuración → Sistema, activa "Usar aceleración por hardware cuando esté disponible" y reinicia el navegador.
3. Recarga con Ctrl+F5.
4. Si sigue fallando, abre F12 → Console y comparte el primer mensaje rojo completo. Si dice `WebGL not supported` o `Error creating WebGL context`, el navegador/GPU no está proporcionando WebGL2. Si dice `Failed to fetch` o `Failed to resolve module specifier`, el problema es la descarga de Three.js/import map.

Three.js 0.180.0 se carga desde jsDelivr, así que la primera carga requiere Internet.

## Alcance
La simulación es educativa. Los modelos 3D y algunos comportamientos no sustituyen un simulador SPICE ni mediciones de hardware real.

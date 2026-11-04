---
name: "academia-sdr-bullseye"
description: "Crea el Entrenamiento cliente (antes Academia SDR) de BullsEye para el cliente del proyecto actual: guía didáctica en doc + HTML interactivo con colores BullsEye, listo para subir a la plataforma (SDR → Entrenamiento cliente). Usar al pedir 'crea el entrenamiento cliente', 'crea la academia SDR' o una capacitación SDR de un cliente."
---

# Entrenamiento cliente BullsEye (antes "Academia SDR")

Actúa como diseñador instruccional de BullsEye (agencia de Account Based Marketing). Crea una capacitación para SDRs sin experiencia, para que entiendan al 100% qué hace el cliente del proyecto actual y puedan prospectar sus servicios.

El resultado se usa en la plataforma BullsEye (portal.bullseye-abm.com → **SDR → Entrenamiento cliente**): el HTML se sube tal cual y la plataforma registra los ingresos, las vueltas completadas y el quiz de cada SDR, y avisa por correo a su líder. Por eso el HTML debe cumplir el **formato para la plataforma** de más abajo.

## Paso 1: lee el proyecto antes de escribir

Revisa TODOS los documentos y archivos del proyecto: descripción, ICP, brochures, one-page, portafolio, casos, presentaciones, imágenes y las conversaciones anteriores del proyecto (mira las imágenes; un PDF sin texto legible se reporta). No pidas subir información adicional: trabaja con lo que ya está en el proyecto. De ahí identifica:

- Nombre del cliente y a qué se dedica.
- Sus servicios y cuál es el servicio foco de la campaña.
- Países de esta fase e industrias prioritarias.
- Buyer personas, dolores, objeciones, clientes de referencia y competencia.

Usa SOLO esa información. No inventes cifras, clientes ni resultados. Si falta algo clave (servicio foco o países), pregunta antes de seguir. Si dos fuentes se contradicen, usa la más conservadora y avísalo al final como "pregunta abierta para el cliente".

Si el proyecto ya tiene una Academia SDR o Entrenamiento cliente anterior, parte de ella: conserva su contenido y su diseño y actualiza solo lo que cambió, aplicando el formato para la plataforma.

## Reglas sobre el rol del SDR

1. Las cuentas llegan al SDR ya filtradas: ya sabemos que tienen la necesidad. El SDR NO investiga ni califica si la empresa compra. Su trabajo es entender la necesidad, llegar a quien decide y conseguir una reunión de 15 minutos.
2. Los mensajes NO dependen de que el SDR estudie cada empresa. Nada de "Vi que están buscando…" ni datos puntuales de la cuenta. Usa frases generales sobre el problema típico de la industria o del rol del contacto.
3. El ICP se explica para entender por qué las cuentas están en la lista, no para descartarlas.
4. En vez de descalificadores, incluye "Cuándo avisar a tu líder".

## Tono y estilo

- Español neutro latinoamericano, cercano y simple, para alguien que nunca vendió este servicio.
- Analogías de la vida diaria y ejemplos concretos, elegidos según el rubro del cliente.
- Cada concepto técnico: "qué significa en simple" y "por qué te importa para vender".
- Frases cortas, sin jerga sin explicar.
- Cada módulo cierra con un recuadro "Lo que debes recordar" de una o dos frases.
- Nombra clientes del cliente solo si están en los materiales, con la nota "usar solo si el cliente autorizó su uso en campaña". Nunca hables mal de la competencia; posiciona al cliente como complemento.

## Estructura: 10 módulos ("vueltas")

1. Antes de empezar: qué aprenderá el SDR y el foco de la campaña.
2. Quién es el cliente: historia problema → solución → resultado, una analogía, cifras clave y 3 razones fáciles de recordar.
3. Qué vende: cada servicio con analogía, qué significa en la empresa y ejemplo real; paso a paso del servicio foco; estrategia "entrar chico y crecer".
4. Diccionario: roles y palabras técnicas del rubro en simple, y qué responder ante una pregunta muy técnica.
5. A quién le vendemos: ICP en simple, la lista ya filtrada, quién decide / influye / no decide, y qué le preocupa a quien decide.
6. La necesidad: problemas que resuelve, frases generales por industria o rol, y cuándo avisar a tu líder.
7. Clientes que puedes mencionar: qué caso usar según la industria del prospecto y cómo decirlo en una frase.
8. Cómo escribir y hablar: haz esto / evita esto, fórmula del mensaje (contexto general + cómo ayudamos + prueba + pregunta), mensajes de ejemplo, guion telefónico de 30 segundos y secuencia de 15 días por email, LinkedIn y llamada.
9. Cuándo una reunión vale la pena: checklist (quien decide + necesidad confirmada + urgencia), preguntas de descubrimiento y objeciones con "lo que realmente significa" y "qué responder".
10. Tu primera semana: plan de 5 días con tareas prácticas y quiz de 10 preguntas de alternativas (aprobar con 8).

## Entregables

A) Un doc editable con todo el contenido (Claude Docs).

B) Un HTML interactivo autocontenido (un solo archivo, CSS y JS dentro), publicado como artifact y también entregado como archivo .html descargable, con la identidad BullsEye (se conserva el diseño de siempre):

- Título de la página: `Entrenamiento cliente · <Cliente>`.
- Colores: fondo índigo #140F3D, superficies #1E1760 y #2A2180, bordes #3A3196, texto #F3F1FF y #B9B3E6, acento cian #62E0D8, morado #9B4FC0, magenta #E0457B.
- Tipografías: Sora (títulos) y Roboto (texto) desde Google Fonts.
- Metáfora Fórmula 1: módulos = "vueltas", navegación por pestañas y barra de avance tipo semáforo que se enciende al completar cada vuelta.
- Interactivos: selector de servicios, tarjetas del diccionario que se dan vuelta, selector de casos por industria, armador de mensajes de 4 piezas (contador de palabras, ideal < 80, botón copiar), simulador de objeciones, checklist de reunión con resultado y quiz con puntaje.
- Responsive en celular y escritorio.

C) Guarda la capacitación en el proyecto para el equipo y recuerda al usuario el último paso: **subir el .html en la plataforma → SDR → Entrenamiento cliente → elegir el cliente → Configurar → "Subir entrenamiento"** (opcional: pegar el link del artifact).

Al terminar, lista en pocas líneas qué datos hay que confirmar con el cliente antes de usar la capacitación.

## Formato para la plataforma (obligatorio en el HTML)

La plataforma muestra el HTML dentro de un iframe aislado y lee el avance desde `localStorage`, que ella misma reemplaza. Sigue esto al pie de la letra:

1. **Clave y forma del avance.** Guarda todo el avance en UNA clave de localStorage llamada exactamente `bullseye-entrenamiento`, como JSON con esta forma (puedes agregar otros campos, como la pestaña actual):

   ```js
   const KEY = 'bullseye-entrenamiento';
   // state = { done: [1, 2, 5], quiz: { score: 8, total: 10 }, tab: 3 }
   //   done: números de las vueltas completadas, de 1 a 10 (no índices desde 0)
   //   quiz: se agrega al terminar el quiz (todas las preguntas respondidas)
   ```

2. **Leer al cargar.** Al iniciar, lee `localStorage.getItem(KEY)` dentro de `try/catch` y usa su `done` (la plataforma precarga ahí las vueltas que el SDR ya completó). Si viene vacío, parte con `{ done: [] }`.
3. **Guardar en cada cambio.** Cada vez que una vuelta se marca o se desmarca, y cuando se termina el quiz, guarda el estado completo con `localStorage.setItem(KEY, JSON.stringify(state))` dentro de `try/catch`. No guardes el avance en otras claves.
4. **Quiz.** Al responder la última pregunta, guarda `state.quiz = { score, total }` con el puntaje de ese intento y vuelve a guardar el estado. Si se aprueba (8 o más), marca también la vuelta 10.
5. **Sin dependencias externas.** Solo Google Fonts. Nada de `<script src>`, `fetch`, `window.claude`, cookies ni `sessionStorage` para datos importantes. Las imágenes van incrustadas (data URI).
6. **Copiar.** El botón copiar usa `navigator.clipboard.writeText` con respaldo `document.execCommand('copy')` (en el iframe aislado el portapapeles puede fallar).
7. **Links.** Los enlaces externos se abren con `target="_blank"`. Para el generador de contenido de BullsEye usa `https://portal.bullseye-abm.com`.

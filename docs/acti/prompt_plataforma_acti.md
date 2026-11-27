# Prompt para Claude Code · Plataforma ACTI dentro del portal BullsEye

> Copia todo lo que está bajo la línea en Claude Code, en el repositorio del portal BullsEye (portal.bullseye-abm.com). Junto con este prompt, deja en el repo el archivo `mvp_red_negocios_acti.html` (por ejemplo en `docs/acti/`): es el prototipo navegable de referencia.

---

## Contexto

Somos BullsEye, agencia de Account Based Marketing. Nuestro portal (portal.bullseye-abm.com) ya tiene, entre otros:

- Fichas de clientes (Centro de prospección), con ICP, cargos objetivo, industrias, zonas y exclusiones.
- El ICP de cada cliente en **Sistema → ICP** (el mismo de Pulso ABM), que alimenta el **motor de recomendaciones con IA**, el **fit** de empresas y cargos y **Contactos IA**.
- Perfiles de buyer persona.
- Peitho, nuestra IA que analiza cada reunión (desempeño del vendedor, predicción de éxito, fit de empresa, cargo y rol, dolores, compromisos, próximos pasos, transcripción y correo sugerido).

Vamos a lanzar una plataforma B2B para **ACTI**, un gremio tecnológico chileno con más de 100 socios. Los socios de ACTI son clientes de BullsEye con una experiencia distinta: eligen las empresas y los cargos con los que quieren reunirse, BullsEye las prospecta y agenda, Peitho analiza cada reunión, y además tienen un módulo de eventos y networking de ACTI.

**Lo que queremos:** que esta plataforma viva **dentro del portal actual**. Al crear un cliente nuevo se marca que es de ACTI, y desde ese momento ese cliente ve la experiencia ACTI. Debe reutilizar lo que ya existe (ICP, buyer persona, motor de recomendaciones IA, fit, Peitho, base de empresas) y no duplicarlo.

## Regla principal: no romper nada

Esta es la restricción más importante, y está por sobre cualquier otra instrucción de este documento:

1. **Solo cambios aditivos.** No modifiques el comportamiento, las rutas, los esquemas ni la interfaz que ya usan los clientes y el equipo de BullsEye. No renombres ni borres campos, colecciones, tablas, funciones o componentes existentes.
2. **Todo lo nuevo se activa por cliente.** Un cliente sin la marca ACTI debe ver exactamente lo mismo que hoy. Si un cambio afecta a todos los clientes, detente y pregúntame antes.
3. **Migraciones seguras.** Solo campos nuevos opcionales o con valor por defecto, o colecciones o tablas nuevas. Nada que reescriba datos existentes.
4. **Reutiliza por integración.** Llama a los servicios existentes (ICP, recomendaciones IA, fit, Peitho) desde una capa nueva (adaptador o servicio ACTI). Si para integrarte necesitas cambiar un servicio existente, propónmelo antes y explica por qué no basta con una capa encima.
5. **Código ACTI separado.** Rutas, componentes, servicios y estilos nuevos en su propio espacio (por ejemplo `/acti/...` y una carpeta `acti/`), para que sea fácil revisarlos, probarlos y apagarlos.
6. **Pruebas de no regresión.** Antes de cada entrega, verifica que un cliente que no es de ACTI sigue funcionando igual (crear cliente, ver ficha, ICP, recomendaciones, reuniones y Peitho).

## Fase 0 · Explorar y proponer (no escribas código todavía)

Antes de implementar, estudia el repositorio y entrégame un informe con:

1. **Stack y arquitectura:** framework, base de datos (colecciones o tablas), autenticación y roles, despliegue y cómo se manejan los estilos y temas.
2. **Cómo se modela hoy un cliente:** dónde se crea, qué campos tiene y qué usuarios lo acceden. Incluye la relación entre la ficha del Centro de prospección y el ICP de Sistema → ICP.
3. **Dónde vive cada pieza que vamos a reutilizar** y cómo se llama: ICP, buyer persona, motor de recomendaciones IA, cálculo de fit, Contactos IA, base de empresas, reuniones y Peitho. Para cada una: qué recibe, qué devuelve y si se puede llamar con el contexto de un cliente.
4. **Si existe hoy un portal o vista para el cliente final** o si el portal es solo interno. Esto define cuánto hay que construir para que el socio entre con su propio usuario.
5. **Una propuesta de diseño** para la marca ACTI por cliente, el modelo de datos nuevo, las rutas y los puntos de integración, con los riesgos de regresión que veas y cómo los evitas.
6. **Las preguntas que necesites que te responda.**

Espera mi aprobación antes de pasar a la Fase 1.

## Qué hay que construir

### 1. Marca ACTI en el cliente

- En la creación y edición de clientes, agrega un campo **"Socio ACTI"** (sí o no) y, si es sí, el **plan ACTI**: Freemium, Conecta, Crece o Acelera.
- Guarda también la fecha de alta en ACTI, la fecha de inicio y término de la prueba (Freemium) y el estado (activo, en prueba, pausado o dado de baja).
- Si el cliente es de ACTI, sus usuarios ven la **experiencia ACTI**: navegación, módulos y tema visual propios. El resto de los clientes no cambia.
- El equipo interno de BullsEye sigue viendo y operando a los clientes ACTI desde el portal de siempre, con una etiqueta que los identifique y un filtro para verlos juntos.

### 2. Planes y reglas de negocio

Los planes viven en una **configuración editable** (no en el código), porque los precios todavía pueden cambiar.

| Plan | Base mensual | Variable | Reuniones | Empresas | Búsquedas con IA |
|---|---|---|---|---|---|
| Freemium | Incluido en la membresía ACTI ($0) | Sin costo | Hasta 2 al año | Hasta 20 al año | 5 al mes |
| Conecta | 18 UF | 4 UF por reunión | 5 garantizadas al mes | Las necesarias para cumplir | Sin límite fijo (configurable) |
| Crece | 26 UF | 4 UF por reunión | 8 garantizadas al mes | Las necesarias para cumplir | Sin límite fijo (configurable) |
| Acelera | 35 UF | 4 UF por reunión | 12 garantizadas al mes | Las necesarias para cumplir | Sin límite fijo (configurable) |

Reglas:

- **Freemium:** es una prueba. "Hasta 20 empresas o 2 reuniones, lo que ocurra primero", con una ventana de 90 días desde la activación. No tiene KAM asignado (onboarding grupal y soporte en la plataforma). Las cuentas sin respuesta no se reemplazan. Al completar el límite, la plataforma bloquea nuevas solicitudes y ofrece pasar a un plan pagado.
- **Planes pagados:** garantizan reuniones al mes. Para cumplirlas, BullsEye trabaja las cuentas necesarias (referencia: reuniones garantizadas ÷ conversión, hoy ~15%, configurable). Si el socio elige menos cuentas, el motor de recomendaciones completa la lista. Las cuentas sin respuesta (6 intentos en 10 días hábiles, configurable) se reemplazan.
- **Prioridad:** los planes pagados tienen prioridad en la cola de prospección. Un socio Freemium no puede solicitar en el mes una empresa que ya solicitó un socio pagado.
- **Demanda por empresa:** si varios socios piden la misma empresa en el mes, marcarla como "Alta demanda", coordinar los contactos y bajarle prioridad en las recomendaciones.
- **Facturación:** base mensual del plan + 4 UF por reunión, más IVA. Las reuniones a las que el prospecto no asiste no se cobran. Las reuniones agendadas en eventos de ACTI no consumen el cupo del plan.
- **Revenue share ACTI:** ACTI recibe el 10% de la base mensual (no del variable) de cada socio activo. Debe quedar calculado por mes para reportarlo.
- **Privacidad:** el socio ve empresas y tipos de cargo, nunca nombres ni datos personales de contactos. El contacto individual lo identifica el equipo de BullsEye recién cuando el socio solicita la reunión.

### 3. Módulos de la experiencia ACTI (para el socio)

El prototipo `mvp_red_negocios_acti.html` muestra la experiencia esperada. Úsalo como referencia funcional y visual, no como código para copiar.

1. **Inicio:** estado del plan (reuniones del mes contra la garantía, o reuniones y empresas de la prueba Freemium con días restantes), próximas reuniones, feedback pendiente, próximo evento de ACTI y novedades.
2. **Mi perfil comercial:** propuesta de valor, servicios, casos de éxito, diferenciadores, objeciones con respuesta y lo que no se debe ofrecer. Debe alimentar lo que hoy usan el SDR y Peitho; si ya existe un equivalente en el portal, reutilízalo.
3. **Mi ICP:** el socio edita su ICP y sus buyer personas. **Debe ser el mismo ICP de Sistema → ICP y los mismos perfiles de buyer persona que ya existen**, no una copia. Si el formulario ACTI pide campos que el ICP actual no tiene (por ejemplo señales de compra, regulaciones, clientes de referencia, ticket y ciclo de venta), agrégalos como campos opcionales que no afecten a los demás clientes.
4. **Buscar cuentas**, con tres pestañas:
   - **Base de empresas:** filtros a la izquierda (industria, país, ciudad, tamaño, facturación, tecnologías, señales de compra y fuente) y buyer persona (área, nivel y cargo), con conteos por opción. A la derecha, el listado paginado con el fit de cada empresa calculado con el motor actual.
   - **Recomendadas por IA:** usa el motor de recomendaciones existente con el ICP del socio. Cada empresa muestra el porcentaje de fit y los motivos de la recomendación. Acciones: "Guardar empresa", "No me interesa" (con motivo, para que el motor aprenda) y "Quiero reunirme con ellos". Respeta el límite de búsquedas del plan.
   - **Guardadas.**
5. **Mis solicitudes:** tablero por etapa (en cola, en research, en contacto, reunión agendada y sin respuesta) conectado al flujo real de prospección del portal, no a un estado paralelo.
6. **Reuniones y feedback:** próximas y realizadas. Cada reunión realizada muestra **el informe de Peitho con el diseño actual de Peitho** (análisis, transcripción, aprendizaje y propuesta de correo). Se agrega una pestaña "Tu feedback" donde el socio confirma si se realizó, califica el perfil contactado y dice si es oportunidad. Ese feedback alimenta la facturación y el motor de recomendaciones.
7. **Eventos y networking (nuevo):** listado de eventos de ACTI con novedades, inscripción, agenda y asistentes (empresa y cargo, sin nombres). Si el evento tiene ronda de negocios, el socio inscrito agenda reuniones uno a uno en horarios disponibles, y el asistente confirma. Debe haber una forma para que el equipo interno o ACTI carguen eventos, horarios y asistentes.
8. **Facturación:** detalle del mes (base, reuniones realizadas, no-shows sin cargo, IVA y total en UF y CLP) e historial. En Freemium, muestra $0 y una invitación a cambiar de plan.
9. **Mi plan:** los cuatro planes lado a lado, el plan actual destacado y una solicitud de cambio de plan (que llegue al equipo de BullsEye; no cobrar automáticamente en esta etapa).

### 4. Vistas para el equipo de BullsEye y para ACTI

- **Equipo BullsEye:** ver las solicitudes de los socios ACTI en el flujo normal de prospección, con su plan, prioridad y la marca de alta demanda; ver el avance de cada socio contra su garantía; y cargar eventos.
- **Administrador ACTI (rol nuevo, solo lectura y agregado):** socios activos por plan, reuniones del mes, eventos e inscritos, y el revenue share de ACTI mes a mes. No debe ver datos de los prospectos ni el detalle comercial de cada socio.

### 5. Identidad visual

- Experiencia ACTI con el texto "ACTI · Red de Negocios" y "Operado por BullsEye" usando **el logo original de BullsEye** que ya está en el portal. El logo de ACTI está pendiente; deja el espacio preparado.
- Colores de BullsEye: azul oscuro #251762, turquesa #62E0D8 y turquesa oscuro #1FA39B. Tipografía Montserrat, con escala compacta de herramienta de trabajo: texto base de 14 px, títulos de 24 px y negrita solo en títulos y números clave.
- Implementa el tema como una variante que se activa solo para clientes ACTI, sin tocar el tema actual.

## Entrega por fases

Cada fase en una rama y un pull request separados, con pruebas, datos de demostración y una nota de cómo probarla:

1. **Fase 1:** marca ACTI y plan en el cliente, configuración de planes, tema ACTI, navegación y la pantalla de Inicio.
2. **Fase 2:** Mi ICP y buyer persona (reutilizados), Mi perfil comercial, Buscar cuentas con el motor de recomendaciones, y Mis solicitudes conectado al flujo de prospección, con los límites de cada plan.
3. **Fase 3:** Reuniones con el informe de Peitho, feedback del socio y Facturación.
4. **Fase 4:** Eventos y networking.
5. **Fase 5:** vista del administrador ACTI, Mi plan, alertas de alta demanda y reporte del revenue share.

## Criterios de aceptación

- Un cliente sin la marca ACTI ve y hace exactamente lo mismo que hoy. Hay pruebas que lo demuestran.
- Un cliente marcado como ACTI ve la experiencia ACTI de su plan, y al cambiar el plan cambian sus límites sin tocar código.
- El ICP, los buyer personas, las recomendaciones, el fit y Peitho de un socio ACTI son los mismos objetos y servicios del portal, no copias. Un cambio de ICP hecho desde el portal interno se refleja en la experiencia ACTI y al revés.
- Los límites de Freemium (20 empresas, 2 reuniones, 90 días y 5 búsquedas con IA al mes) se cumplen y bloquean con un mensaje claro.
- El socio nunca ve nombres ni datos personales de los contactos.
- La facturación del mes calcula bien base, variable, no-shows, IVA y revenue share.

## Decisiones abiertas (no las asumas: pregúntame o déjalas configurables)

- Si el variable se cobra por reunión agendada o por reunión realizada (por ahora: realizada, y no-shows sin cargo).
- Quién financia el Freemium (por ahora lo absorbe BullsEye durante el piloto).
- Tasa de conversión de referencia y KAM por socio (1 cada 12 en el modelo; Operaciones pide 1 cada 8 a 10).
- El logo y los colores de ACTI.
- Consentimiento y tratamiento de datos personales según la Ley 21.719, que rige desde diciembre de 2026.

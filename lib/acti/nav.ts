// ACTI · módulos de la experiencia del socio (menú lateral). `phase` = fase
// en que se construye; mientras no esté, la página muestra "En preparación".

export type ActiModule = { slug: string; href: string; label: string; phase: number; description: string };

export const ACTI_MODULES: ActiModule[] = [
  { slug: "", href: "/acti", label: "Inicio", phase: 1, description: "Estado de tu plan, próximas reuniones y novedades." },
  { slug: "perfil", href: "/acti/perfil", label: "Mi perfil comercial", phase: 2, description: "Propuesta de valor, servicios, casos de éxito, diferenciadores y objeciones." },
  { slug: "icp", href: "/acti/icp", label: "Mi ICP", phase: 2, description: "Tu cliente ideal y tus buyer personas." },
  { slug: "buscar", href: "/acti/buscar", label: "Buscar cuentas", phase: 2, description: "Base de empresas, recomendadas por IA y guardadas." },
  { slug: "solicitudes", href: "/acti/solicitudes", label: "Mis solicitudes", phase: 2, description: "El avance de cada empresa que pediste." },
  { slug: "reuniones", href: "/acti/reuniones", label: "Reuniones y feedback", phase: 3, description: "Próximas y realizadas, con el análisis de Peitho y tu feedback." },
  { slug: "eventos", href: "/acti/eventos", label: "Eventos y networking", phase: 4, description: "Eventos de ACTI, inscripción y ronda de negocios." },
  { slug: "facturacion", href: "/acti/facturacion", label: "Facturación", phase: 3, description: "Detalle del mes e historial." },
  { slug: "mi-plan", href: "/acti/mi-plan", label: "Mi plan", phase: 1, description: "Compara los planes y solicita un cambio." },
];

// Fase ya entregada en producción (las anteriores o iguales se muestran activas)
export const ACTI_LIVE_PHASE = 1;

export const moduleBySlug = (slug: string) => ACTI_MODULES.find((m) => m.slug === slug) ?? null;

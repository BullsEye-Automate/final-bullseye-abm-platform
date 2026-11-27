// ACTI · módulos de la experiencia del socio (menú lateral). `phase` = fase
// del plan de entrega; `ready` = ya construido (si no, el menú dice "Pronto"
// y la página muestra "En preparación").

export type ActiModule = { slug: string; href: string; label: string; phase: number; ready: boolean; description: string };

export const ACTI_MODULES: ActiModule[] = [
  { slug: "", href: "/acti", label: "Inicio", phase: 1, ready: true, description: "Estado de tu plan, próximas reuniones y novedades." },
  { slug: "perfil", href: "/acti/perfil", label: "Mi perfil comercial", phase: 2, ready: true, description: "Propuesta de valor, servicios, casos de éxito, diferenciadores y objeciones." },
  { slug: "icp", href: "/acti/icp", label: "Mi ICP", phase: 2, ready: true, description: "Tu cliente ideal y tus buyer personas." },
  { slug: "buscar", href: "/acti/buscar", label: "Buscar cuentas", phase: 2, ready: false, description: "Base de empresas, recomendadas por IA y guardadas." },
  { slug: "solicitudes", href: "/acti/solicitudes", label: "Mis solicitudes", phase: 2, ready: false, description: "El avance de cada empresa que pediste." },
  { slug: "reuniones", href: "/acti/reuniones", label: "Reuniones y feedback", phase: 3, ready: false, description: "Próximas y realizadas, con el análisis de Peitho y tu feedback." },
  { slug: "eventos", href: "/acti/eventos", label: "Eventos y networking", phase: 4, ready: false, description: "Eventos de ACTI, inscripción y ronda de negocios." },
  { slug: "facturacion", href: "/acti/facturacion", label: "Facturación", phase: 3, ready: false, description: "Detalle del mes e historial." },
  { slug: "mi-plan", href: "/acti/mi-plan", label: "Mi plan", phase: 1, ready: true, description: "Compara los planes y solicita un cambio." },
];


export const moduleBySlug = (slug: string) => ACTI_MODULES.find((m) => m.slug === slug) ?? null;

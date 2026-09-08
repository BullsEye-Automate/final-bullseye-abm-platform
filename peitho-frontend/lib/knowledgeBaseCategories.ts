export interface KbCategory {
  key: string;
  label: string;
  group: "Empresa" | "Ventas" | "Multimedia";
}

// Categorías fijas (Fase F) — mismas para todos los clientes, definidas por
// el usuario a partir de una captura de referencia. Deben calzar exactamente
// con las keys validadas en peitho-backend/src/knowledgeBase.ts
// (KB_CATEGORY_KEYS) y con el check constraint de la migración 016. El
// orden acá es el orden en que se muestran en el sidebar de
// /base-de-conocimiento/[id].
export const KB_CATEGORIES: KbCategory[] = [
  { key: "propuesta_valor", label: "Propuesta de valor", group: "Empresa" },
  { key: "icp_perfiles", label: "ICP y perfiles", group: "Empresa" },
  { key: "presentaciones", label: "Presentaciones", group: "Ventas" },
  { key: "casos_exito", label: "Casos de éxito", group: "Ventas" },
  { key: "manejo_objeciones", label: "Manejo de objeciones", group: "Ventas" },
  { key: "videos_comerciales", label: "Videos comerciales", group: "Multimedia" },
  { key: "imagenes_logos", label: "Imágenes-Logos", group: "Multimedia" },
];

export const KB_CATEGORY_GROUPS: KbCategory["group"][] = ["Empresa", "Ventas", "Multimedia"];

export function kbCategoryLabel(key: string | null): string {
  if (!key) return "Sin categorizar";
  return KB_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

import { redirect } from "next/navigation";

// La wishlist ahora vive en Pulso ABM → Cuentas objetivo (se conserva la
// ruta para links ya compartidos)
export default function PortalWishlistPage() {
  redirect("/portal/radar?vista=cuentas-objetivo");
}

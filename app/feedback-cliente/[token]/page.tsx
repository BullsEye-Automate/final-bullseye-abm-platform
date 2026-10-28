"use client";

import { useParams } from "next/navigation";
import ClientFeedbackBoard from "@/components/feedback/ClientFeedbackBoard";

// Link público de feedback de reuniones del cliente (también va embebido en
// el portal: Pulso ABM → Feedback comercial)
export default function FeedbackClientePage() {
  const { token } = useParams() as { token: string };
  return <ClientFeedbackBoard token={token} />;
}

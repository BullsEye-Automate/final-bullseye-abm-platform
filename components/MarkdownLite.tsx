"use client";

import type { ReactNode } from "react";

// Renderer minimalista para el Markdown que genera Allo en el resumen de
// llamadas con IA (títulos "#"/"##", listas "-", negrita "**texto**" y
// párrafos simples). No es un parser de Markdown genérico — cubre solo lo
// que ese resumen usa, para no agregar una librería completa (react-markdown
// + remark) solo para este caso.

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

export default function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-5 space-y-1 my-2">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2).trim());
      return;
    }
    flushList(`list-${idx}`);

    if (!line) return; // línea vacía: solo separa párrafos/listas

    if (line.startsWith("## ")) {
      blocks.push(
        <h3 key={idx} className="text-base font-semibold mt-4 mb-1.5 text-gray-900">
          {line.slice(3)}
        </h3>
      );
      return;
    }
    if (line.startsWith("# ")) {
      blocks.push(
        <h2 key={idx} className="text-lg font-bold mt-2 mb-2 text-gray-900">
          {line.slice(2)}
        </h2>
      );
      return;
    }

    blocks.push(
      <p key={idx} className="my-1.5 leading-relaxed">
        {renderInline(line, `p-${idx}`)}
      </p>
    );
  });
  flushList("list-end");

  return <div className={className}>{blocks}</div>;
}

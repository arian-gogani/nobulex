# Reglamento de IA — Correspondencia Kova (Resumen)

**Reglamento (UE) 2024/1689** — Inteligencia artificial  
**Fecha límite:** 2 de agosto de 2026 (obligaciones generales para sistemas de IA de alto riesgo)

Capacidades de Kova mapeadas a los requisitos del Reglamento de IA. Ruta más rápida hacia el cumplimiento.

---

## Resumen: Kova → Reglamento de IA

| Artículo | Cobertura Kova |
|----------|----------------|
| 10 — Gestión de riesgos | Covenant, Canary, Temporal, Legal |
| 11 — Gobernanza de datos | Parcial (procedencia conductual) |
| 13 — Transparencia | Covenant, CCL, LegalIdentityPackage |
| 14 — Supervisión humana | Condiciones CCL, Canary |
| 15 — Precisión, robustez | Canary, Robustness, Crypto |
| 17 — Registros | Enforcement, Store, Legal |
| 53 — Obligaciones de transparencia | Legal, CCL |
| 71 — Evaluación de conformidad | Verifier, Canary, Legal |
| 72 — Vigilancia del mercado | Reputation, Breach, Antifragile |

**Lagunas:** Calidad de datos de entrenamiento (Art. 11) e identificación de contenido sintético (Art. 53) son a nivel de modelo; Kova opera a nivel agente/conducta.

---

## Ruta rápida de cumplimiento

1. **Crear covenant** — Documentar acciones permitidas/prohibidas.
2. **Ejecutar pruebas Canary** — Validar restricciones.
3. **Activar enforcement** — Gating en tiempo de ejecución, registro de auditoría.
4. **Exportar LegalIdentityPackage** — Para evaluación de conformidad.
5. **Mapear a jurisdicción** — `@stele/legal` mapeo UE-IA.

Correspondencia completa: [eu-ai-act-mapping.md](../eu-ai-act-mapping.md) (inglés)

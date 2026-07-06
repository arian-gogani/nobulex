# EU KI-Verordnung — Kova-Zuordnung (Zusammenfassung)

**Verordnung (EU) 2024/1689** — Künstliche Intelligenz  
**Frist:** 2. Dezember 2027 (allgemeine Pflichten für Hochrisiko-KI-Systeme)

Kova-Funktionen der EU KI-Verordnung zugeordnet. Schnellster Weg zur Konformität.

---

## Zusammenfassung: Kova → EU KI-Verordnung

| Artikel | Kova-Abdeckung |
|---------|----------------|
| 10 — Risikomanagement | Covenant, Canary, Temporal, Legal |
| 11 — Daten-Governance | Teilweise (Verhaltensherkunft) |
| 13 — Transparenz | Covenant, CCL, LegalIdentityPackage |
| 14 — Menschliche Aufsicht | CCL-Bedingungen, Canary |
| 15 — Genauigkeit, Robustheit | Canary, Robustness, Krypto |
| 17 — Aufzeichnungspflicht | Enforcement, Store, Legal |
| 53 — Transparenzpflichten | Legal, CCL |
| 71 — Konformitätsbewertung | Verifier, Canary, Legal |
| 72 — Marktüberwachung | Reputation, Breach, Antifragile |

**Lücken:** Schulungsdatenqualität (Art. 11) und synthetische Inhaltskennzeichnung (Art. 53) sind modellbezogen; Kova arbeitet auf Agenten-/Verhaltensebene.

---

## Schneller Konformitätspfad

1. **Covenant erstellen** — Erlaubte/verbotene Aktionen dokumentieren.
2. **Canary-Tests ausführen** — Einschränkungen validieren.
3. **Enforcement aktivieren** — Runtime-Gating, Audit-Trail.
4. **LegalIdentityPackage exportieren** — Für Konformitätsbewertung.
5. **Rechtsordnung zuordnen** — `@nobulex/legal` EU-AI-Mapping.

Vollständige Zuordnung: [eu-ai-act-mapping.md](../eu-ai-act-mapping.md) (Englisch)

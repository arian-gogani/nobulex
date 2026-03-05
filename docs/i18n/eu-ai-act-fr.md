# Règlement IA — Correspondance Nobulex (Résumé)

**Règlement (UE) 2024/1689** — Intelligence artificielle  
**Échéance :** 2 août 2026 (obligations générales pour les systèmes d'IA à haut risque)

Capacités Nobulex mappées aux exigences du Règlement IA. Chemin le plus rapide vers la conformité.

---

## Résumé : Nobulex → Règlement IA

| Article | Couverture Nobulex |
|---------|-----------------|
| 10 — Gestion des risques | Covenant, Canary, Temporal, Legal |
| 11 — Gouvernance des données | Partielle (provenance comportementale) |
| 13 — Transparence | Covenant, CCL, LegalIdentityPackage |
| 14 — Supervision humaine | Conditions CCL, Canary |
| 15 — Exactitude, robustesse | Canary, Robustness, Crypto |
| 17 — Tenue des registres | Enforcement, Store, Legal |
| 53 — Obligations de transparence | Legal, CCL |
| 71 — Évaluation de conformité | Verifier, Canary, Legal |
| 72 — Surveillance du marché | Reputation, Breach, Antifragile |

**Lacunes :** Qualité des données d'entraînement (Art. 11) et identification du contenu synthétique (Art. 53) sont au niveau du modèle ; Nobulex opère au niveau agent/comportement.

---

## Parcours de conformité rapide

1. **Créer un covenant** — Documenter les actions autorisées/interdites.
2. **Exécuter les tests Canary** — Valider les contraintes.
3. **Activer l'enforcement** — Gating runtime, piste d'audit.
4. **Exporter LegalIdentityPackage** — Pour l'évaluation de conformité.
5. **Mapper à la juridiction** — `@nobulex/legal` mappage UE-IA.

Correspondance complète : [eu-ai-act-mapping.md](../eu-ai-act-mapping.md) (anglais)

# Policies Row Level Security (RLS) — VibeCheck

## État actuel (vérifié par audit)
- ✅ RLS est **activé** sur `profiles` 
- ✅ RLS est **activé** sur `analyses`
- ✅ RLS est **activé** sur `premium_generations_log` (après migration 20250905)

---

## Vérification — Commandes SQL à lancer dans le SQL Editor de Supabase

### 1) Confirmer que RLS est activé
```sql
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename IN ('profiles', 'analyses', 'premium_generations_log');
```
Tous doivent retourner `rowsecurity = true`.

### 2) Lister les policies existantes
```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('profiles', 'analyses', 'premium_generations_log')
ORDER BY tablename, cmd;
```

---

## Policies requises (à vérifier/corriger)

### Table `profiles`
**Principe** : isolation stricte + aucune écriture côté client pour credits/premium_unlocked

```sql
-- Lecture de sa propre ligne
CREATE POLICY "select_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = user_id);

-- AUCUNE policy INSERT/UPDATE pour le rôle authenticated
-- → Les crédits et premium_unlocked ne changent QUE via des fonctions/webhooks
--   qui utilisent la SERVICE_ROLE_KEY (contourne RLS par design)
```

**Migrations côté serveur qui doivent utiliser la SERVICE_ROLE_KEY** :
- `decrement_credit()` — fonction RPC appelée par `/api/analyze-profile`
- `/api/stripe-webhook.js` — ajoute des crédits / déverrouille premium après paiement
- `/api/generate-premium-content.js` — vérifie `premium_unlocked` avant génération

### Table `analyses`
**Principe** : chaque utilisateur voit/crée seulement ses propres analyses

```sql
-- Lecture de ses propres analyses
CREATE POLICY "select_own_analyses" ON analyses
  FOR SELECT USING (auth.uid() = user_id);

-- Écriture de ses propres analyses (côté client uniquement, `saveAnalysisToSupabase()`)
CREATE POLICY "insert_own_analyses" ON analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- AUCUNE policy UPDATE/DELETE (analyses immuables une fois créées)
```

### Table `premium_generations_log`
Voir migration `20250905_premium_generations_log.sql` — policies déjà intégrées.

---

## Checklist de sécurité avant lancement en production

- [ ] Lancer les 3 commandes SQL ci-dessus pour confirmer l'état actuel
- [ ] Si une policy manque, l'ajouter immédiatement
- [ ] Si une policy erronée existe (ex: `UPDATE` sur `profiles` pour authenticated), la supprimer
- [ ] Tester le comportement en lecteur authentifié vs lecteur anonyme (clé anon)
- [ ] Tester qu'aucune tentative de lecture/écriture cross-user n'est possible (essayer de modifier son `user_id` ou de voir les analyses de quelqu'un d'autre)

---

## Endpoints et leur interaction avec RLS

| Endpoint | Table | Opération | Clé Supabase | Notes |
|---|---|---|---|---|
| `GET /api/get-credits` | `profiles` | SELECT | ANON | Filtre client-side sur `user_id` — RLS doit la renforcer |
| `POST /api/analyze-profile` | `profiles` | UPDATE (via RPC) | SERVICE_ROLE | Débite crédit via `decrement_credit()` |
| `POST /api/analyze-profile` | `analyses` | INSERT (client) | ANON | `saveAnalysisToSupabase()` côté client — RLS valide le `user_id` |
| `GET /historique.html` | `analyses` | SELECT | ANON | Récupère les analyses de l'utilisateur — RLS filtre |
| `POST /api/stripe-webhook.js` | `profiles` | UPDATE | SERVICE_ROLE | Ajoute crédits/premium après paiement |
| `POST /api/generate-premium-content.js` | `profiles` | SELECT | SERVICE_ROLE | Vérifie `premium_unlocked` avant génération |

---

## En cas de problème : logs à vérifier

Si une requête échoue avec une erreur RLS (ex: `policy row security violation`), c'est normal — ça signifie que RLS fonctionne. Vérifier dans les logs de Supabase :
- Console > Logs > Database > Policies
- Ou CLI : `supabase logs pull --function analyze_profile`

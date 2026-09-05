# Checklist Déploiement Sécurité — VibeCheck

**Audit réalisé par :** Opus (Claude 3 Opus)  
**Date :** 5 septembre 2026  
**Status après correctifs appliqués :** ✅ Prêt pour un déploiement sécurisé (avec les vérifications ci-dessous)

---

## ✅ Correctifs déjà appliqués dans ce ZIP

### 1. Finding #1 (Critique) — Authentification + crédit sur `/api/analyze-profile`
- [x] Auth Bearer token obligatoire avant appel OpenAI
- [x] Débit atomique du crédit AVANT appel OpenAI (pas après)
- [x] Rate limit 30/jour/utilisateur
- [x] Remboursement auto si OpenAI échoue après débit
- [x] Frontend : distinction 402 (no credit) vs panne technique
- [x] Frontend : relance vraie analyse après achat (vs déblocage fake démo)

### 2. Finding #3 (Rate limiting)
- [x] 30 analyses/jour/utilisateur sur `analyze-profile.js`
- [x] 10 générations/jour/utilisateur sur `generate-premium-content.js` (table `premium_generations_log` à créer via migration)

### 3. Finding #4 (CORS)
- [x] Restreint à `https://vibecheck-smoky-seven.vercel.app` sur les 7 endpoints

### 4. Finding #6 (CSP + headers de sécurité)
- [x] `vercel.json` créé avec :
  - CSP `default-src 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

### 5. Finding #7 (Prompt injection — défense en profondeur)
- [x] Sanitization stricte des sorties IA : bornes sur scores (1-10), tailles de tableaux/strings
- [x] Appliqué sur `analyze-profile.js` et `generate-premium-content.js`

### 6. Finding #8 (Code mort)
- [x] Modal clé API vestige entièrement retiré (HTML + CSS + JS)
- [x] Aucune référence orpheline

### 7. Finding #9 (Erreurs verbeuses)
- [x] Tous les endpoints retournent `{ error: 'Erreur interne serveur' }` au client
- [x] Logs détaillés côté serveur uniquement via `console.error()`

### 8. CGU/Mentions légales
- [x] Retiré la fausse promesse "première analyse gratuite"
- [x] Clarifié que tous les crédits sont payants

---

## 🔍 À vérifier AVANT et IMMÉDIATEMENT APRÈS déploiement

### Phase 1 : Avant `git push` (en local ou staging)

#### Supabase — SQL Editor
```sql
-- Confirmer RLS activé
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename IN ('profiles', 'analyses', 'premium_generations_log');
-- Résultat attendu : tous avec rowsecurity = true

-- Vérifier les policies existantes
SELECT tablename, policyname, cmd, roles 
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('profiles', 'analyses')
ORDER BY tablename;
```

#### Migration premium_generations_log
Exécuter le contenu de `migrations/20250905_premium_generations_log.sql` dans le SQL Editor.

#### Vercel — Vérifier les variables d'environnement
- `SUPABASE_URL` → `https://teqcsguiphdptdgtpdvi.supabase.co`
- `SUPABASE_ANON_KEY` → la clé publique
- `SUPABASE_SERVICE_ROLE_KEY` → la clé privée (JAMAIS exposée au client)
- `OPENAI_API_KEY` → présent et valide
- `STRIPE_SECRET_KEY` → clé **live** (pas test, sinon clients ne pourront pas acheter)
- `STRIPE_PUBLISHABLE_KEY` → clé **live** correspondante

### Phase 2 : Après `git push origin main` (déploiement en prod)

#### Tests du flux d'analyse
1. **Sans crédits** → tentative d'analyse → 402 "Crédits insuffisants" → voir paywall → acheter pack → **relance auto la vraie analyse** (pas un fake démo)
2. **Avec crédits** → analyse lance → webhook Stripe crédite après quelques secondes → historique contient la vraie analyse
3. **Panne OpenAI simulée** (arrêter le déploiement de `analyze-profile.js`) → tenter une analyse → 502 → crédit est **remboursé** → utilisateur peut réessayer après réparation

#### Tests du flux Premium
1. Débloquer Premium via Stripe → page recharge → bouton "Générer suggestions" apparaît → génération fonctionne

#### Tests de sécurité RLS (curl / Postman)
```bash
# Test 1 : tenter de lire les analyses d'un autre utilisateur (doit échouer)
curl -X GET "https://teqcsguiphdptdgtpdvi.supabase.co/rest/v1/analyses?user_id=eq.<OTHER_USER_ID>" \
  -H "apikey: sb_<ANON_KEY>" \
  -H "Authorization: Bearer <TOKEN_OF_DIFFERENT_USER>"
# Résultat attendu : vide ou erreur (RLS filtre)

# Test 2 : tenter de modifier ses crédits directement (doit échouer)
curl -X PATCH "https://teqcsguiphdptdgtpdvi.supabase.co/rest/v1/profiles?user_id=eq.<MY_USER_ID>" \
  -H "apikey: sb_<ANON_KEY>" \
  -H "Authorization: Bearer <MY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"credits": 999}'
# Résultat attendu : policy row security violation (RLS bloque l'UPDATE)
```

#### Tests de rate limiting
1. Lancer 31 analyses en 24h → 31ème retourne 429 "Trop d'analyses"
2. Attendre 24h ou manuellement effacer les entrées anciennes dans `analyses` → compteur reset, peut relancer

#### Tests CORS
```bash
# Depuis un domaine externe (ex: curl avec Origin header différent)
curl -X POST "https://vibecheck-smoky-seven.vercel.app/api/analyze-profile" \
  -H "Origin: https://attacker.com" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"..."}'
# Résultat attendu : pas de header CORS de retour (blocage côté navigateur)
```

#### Logs Vercel
Vérifier qu'il n'y a pas d'erreur au déploiement (notamment les imports de Supabase/Stripe).

---

## 📋 Checklist ultime avant lancement commercial

- [ ] Email à tous les utilisateurs existants : "Les crédits deviennent payants à partir du [DATE]" + lien pour acheter
- [ ] Page d'accueil : clarifier le modèle économique (0€ offert, tous les crédits payants)
- [ ] FAQ : ajouter "Pourquoi je dois payer pour la première analyse ?" + explications
- [ ] Analytics : tracker le nb de conversions (1ère analyse → achat) pour optimiser le pricing
- [ ] Support : préparer des templates pour les demandes de remboursement (la nouvelle politique de remboursement auto aide, mais il y aura des cas limites)
- [ ] Monitoring d'erreurs : configurer Sentry/Rollbar pour tracker les 402/429/502 en prod
- [ ] Supabase backups : activer les sauvegardes quotidiennes automatiques

---

## 🚨 Points de vigilance post-déploiement

### Credential Exposure
Si tu remarques des clés dans les logs ou les erreurs, **rotate immédiatement** :
```bash
# Sur Vercel
vercel env pull --yes
# Modifier les valeurs
vercel env add SUPABASE_SERVICE_ROLE_KEY [nouvelle_clé]
```

### Faux positifs de fraude
Certains utilisateurs légitimes pourraient trigger le rate limit (ex: clic répété par accident). Plan de réponse :
- Support peut effacer manuellement les entrées `analyses` pour ce user (reset le compteur)
- Docs : "Si tu penses avoir été bloqué par erreur, contacte support"

### Stripe webhook delays
Si webhook prend >3s, le client pourrait penser que le paiement a échoué et re-cliquer. C'est OK — Stripe garantit la livraison même si l'utilisateur refresh.

---

## 📞 Support et escalade

Si un utilisateur signale "j'ai acheté des crédits mais ils ne sont pas apparus" :
1. Vérifier les logs Stripe webhook (Vercel Logs)
2. Vérifier la table `profiles.credits` pour cet utilisateur
3. Si crédit absent mais webhook reçu → re-exécuter manuellement (ou déployer une hotfix)

---

**Merci d'avoir enlevé le modèle "1ère gratuite" et clarifié la stratégie tarifaire. C'est plus honnête et plus sain pour les finances de l'app.**

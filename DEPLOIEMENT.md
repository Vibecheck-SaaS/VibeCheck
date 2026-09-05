# Déploiement VibeCheck sur Vercel

## 1. Variables d'environnement (obligatoire avant de déployer)

Dans le dashboard Vercel → ton projet `vibecheck-smoky-seven` → **Settings → Environment Variables**, ajoute :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | `https://teqcsguiphdptdgtpdvi.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_iCB1zifgp9hOPky-UD3-sQ_6VuWJdTK` |

Ces deux variables sont utilisées uniquement par la fonction serveur `/api/verify-session.js` (pas par le navigateur du visiteur).

## 2. Déployer avec la CLI Vercel

Dans le dossier de ce projet (celui qui contient `index.html`, `api/`, `package.json`) :

```bash
npm i -g vercel   # si pas déjà installé
vercel login      # connecte-toi avec le compte lié à vibecheck-smoky-seven
vercel --prod
```

Quand la CLI demande "Link to existing project?", réponds **oui** et sélectionne `vibecheck-smoky-seven`.

## 3. Vérifier après déploiement

- Ouvre `https://vibecheck-smoky-seven.vercel.app`
- Clique sur "Commencer" → "Continuer avec Google" → connecte-toi
- Tu dois être redirigé sur le site, connecté, avec accès à la zone d'upload
- Si erreur "Configuration serveur manquante", les variables d'environnement (étape 1) ne sont pas bien définies

## 4. Rappel — configuration Google Cloud / Supabase déjà faite

Assure-toi que ces URLs sont bien enregistrées (normalement déjà fait de ton côté) :

- **Google Cloud Console** → OAuth Client ID → URI de redirection autorisés : `https://teqcsguiphdptdgtpdvi.supabase.co/auth/v1/callback`
- **Google Cloud Console** → Origines JavaScript autorisées : `https://vibecheck-smoky-seven.vercel.app`
- **Supabase** → Authentication → URL Configuration → Site URL + Redirect URLs : `https://vibecheck-smoky-seven.vercel.app`

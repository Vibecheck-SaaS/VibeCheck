-- Migration : Table de suivi des générations Premium (rate limiting)
-- À exécuter dans le SQL Editor de Supabase

CREATE TABLE IF NOT EXISTS premium_generations_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, created_at)
);

-- Activer RLS
ALTER TABLE premium_generations_log ENABLE ROW LEVEL SECURITY;

-- Policy : chaque utilisateur peut lire/écrire ses propres logs
CREATE POLICY "select_own_premium_logs" ON premium_generations_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own_premium_logs" ON premium_generations_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Index pour les requêtes de rate limiting (user_id + date récente)
CREATE INDEX IF NOT EXISTS idx_premium_gen_user_created ON premium_generations_log(user_id, created_at DESC);

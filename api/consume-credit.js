import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN = 'https://vibecheck-smoky-seven.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Configuration serveur manquante' });
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!userResponse.ok) {
      return res.status(401).json({ error: 'Session invalide' });
    }
    const user = await userResponse.json();

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.rpc('decrement_credit', { p_user_id: user.id });

    if (error) {
      if (error.message && error.message.includes('INSUFFICIENT_CREDITS')) {
        return res.status(402).json({ error: 'Crédits insuffisants' });
      }
      throw error;
    }

    return res.status(200).json({ credits: data });
  } catch (error) {
    console.error('Erreur consume-credit:', error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN = 'https://vibecheck-smoky-seven.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
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
    const { data } = await supabase
      .from('profiles')
      .select('credits, premium_unlocked')
      .eq('user_id', user.id)
      .maybeSingle();

    return res.status(200).json({
      credits: data ? data.credits : 0,
      premiumUnlocked: data ? !!data.premium_unlocked : false,
    });
  } catch (error) {
    console.error('Erreur get-credits:', error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

const { createClient } = require('@supabase/supabase-js');

// Cette fonction tourne côté serveur (jamais dans le navigateur du visiteur).
// Elle reçoit un access_token envoyé par le front, et demande directement à
// Supabase de confirmer qu'il est valide et non expiré. Le front ne peut pas
// bidouiller ce résultat : c'est Supabase qui répond, pas le navigateur.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { access_token } = req.body || {};
  if (!access_token) {
    res.status(400).json({ valid: false, error: 'access_token manquant' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ valid: false, error: 'Configuration serveur manquante (variables d\'environnement absentes)' });
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getUser(access_token);

    if (error || !data || !data.user) {
      res.status(401).json({ valid: false, error: (error && error.message) || 'Session invalide ou expirée' });
      return;
    }

    res.status(200).json({
      valid: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata && (data.user.user_metadata.full_name || data.user.user_metadata.name)) || null
      }
    });
  } catch (err) {
    console.error('verify-session error:', err);
    res.status(500).json({ valid: false, error: 'Erreur serveur lors de la vérification' });
  }
};

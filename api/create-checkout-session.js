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
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { pack } = req.body || {};
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const PACKS = {
      single: { credits: 1, amount: 499, label: '1 analyse' },
      pack3:  { credits: 3, amount: 999, label: 'Pack 3 analyses' },
      pack10: { credits: 10, amount: 1500, label: 'Pack 10 analyses' },
    };

    if (!pack || !PACKS[pack]) {
      return res.status(400).json({ error: 'Pack invalide' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.SITE_URL || 'https://vibecheck-smoky-seven.vercel.app';

    if (!supabaseUrl || !supabaseAnonKey || !stripeSecretKey) {
      console.error('Configuration manquante:', { supabaseUrl: !!supabaseUrl, supabaseAnonKey: !!supabaseAnonKey, stripeSecretKey: !!stripeSecretKey });
      return res.status(500).json({ error: 'Configuration serveur manquante' });
    }

    // Vérifier l'utilisateur via son token Supabase
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });

    if (!userResponse.ok) {
      console.error('Auth user failed:', userResponse.status);
      return res.status(401).json({ error: 'Session invalide' });
    }

    const user = await userResponse.json();
    const { credits, amount, label } = PACKS[pack];

    // Créer ou récupérer un tax rate TVA 20% pour la France/EUR
    let taxRateId = null;
    try {
      const taxRates = await stripe.taxRates.list({ limit: 100 });
      const existingRate = taxRates.data.find(
        r => r.display_name && r.display_name.includes('20%') && r.percentage === 20
      );
      if (existingRate) {
        taxRateId = existingRate.id;
      } else {
        // Créer un nouveau tax rate
        const newRate = await stripe.taxRates.create({
          display_name: 'TVA 20%',
          description: 'Taxe sur la valeur ajoutée France',
          jurisdiction: 'FR',
          percentage: 20,
          inclusive: false, // Prix HT, TVA ajoutée
        });
        taxRateId = newRate.id;
      }
    } catch (e) {
      console.warn('Erreur création tax rate, continuant sans:', e.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      managed_payments: { enabled: false }, // Désactiver Managed Payments
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: `VibeCheck — ${label}`,
            },
            tax_behavior: 'exclusive', // Prix HT, TVA ajoutée après
          },
          quantity: 1,
          ...(taxRateId && { tax_rates: [taxRateId] }), // Ajouter tax rate si créé
        },
      ],
      customer_email: user.email,
      metadata: {
        supabase_user_id: user.id,
        credits: String(credits),
        pack,
      },
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Erreur create-checkout-session:', error.message || error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

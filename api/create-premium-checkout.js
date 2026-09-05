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

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.SITE_URL || 'https://vibecheck-smoky-seven.vercel.app';

    if (!supabaseUrl || !supabaseAnonKey || !stripeSecretKey) {
      console.error('Configuration manquante pour create-premium-checkout');
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
      return res.status(401).json({ error: 'Session invalide' });
    }
    const user = await userResponse.json();

    const stripe = new Stripe(stripeSecretKey);

    // Prix Premium (réécriture bio + ordre optimal des photos) — 2,99€
    // TODO: ajustable plus tard, actuellement fixé en dur ici.
    const PREMIUM_AMOUNT = 299; // centimes

    // Créer ou récupérer un tax rate TVA 20% pour la France/EUR (même logique que create-checkout-session.js,
    // pour que la TVA s'affiche de la même façon sur les deux checkouts)
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
      managed_payments: { enabled: false }, // Même fix que create-checkout-session.js : évite l'erreur "product tax code missing"
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: PREMIUM_AMOUNT,
            product_data: {
              name: 'VibeCheck Premium — Réécriture de bio + ordre des photos',
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
        product_type: 'premium_unlock',
      },
      success_url: `${siteUrl}/?premium=success`,
      cancel_url: `${siteUrl}/?premium=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Erreur create-premium-checkout:', error.message || error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

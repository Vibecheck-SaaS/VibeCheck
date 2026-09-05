export const config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const Stripe = (await import('stripe')).default;
    const { createClient } = await import('@supabase/supabase-js');

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error('Configuration Stripe/Supabase manquante pour le webhook');
      return res.status(500).send('Configuration serveur manquante');
    }

    const stripe = new Stripe(stripeSecretKey);
    const sig = req.headers['stripe-signature'];
    const rawBody = await buffer(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Signature webhook Stripe invalide:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata && session.metadata.supabase_user_id;
      const productType = session.metadata && session.metadata.product_type;
      const creditsToAdd = parseInt((session.metadata && session.metadata.credits) || '0', 10);

      if (!userId) {
        console.error('Webhook checkout.session.completed sans supabase_user_id:', session.id);
        return res.status(200).json({ received: true });
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      if (productType === 'premium_unlock') {
        // Achat du pack Premium (réécriture bio + ordre des photos) — pas un crédit, un déblocage définitif
        const { data: existing, error: fetchError } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (fetchError) {
          console.error('Erreur lecture profile pour webhook premium:', fetchError);
        } else if (existing) {
          await supabase
            .from('profiles')
            .update({ premium_unlocked: true, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        } else {
          await supabase
            .from('profiles')
            .insert({ user_id: userId, premium_unlocked: true });
        }
      } else if (creditsToAdd > 0) {
        const { data: existing, error: fetchError } = await supabase
          .from('profiles')
          .select('credits')
          .eq('user_id', userId)
          .maybeSingle();

        if (fetchError) {
          console.error('Erreur lecture profile pour webhook:', fetchError);
        } else if (existing) {
          await supabase
            .from('profiles')
            .update({ credits: existing.credits + creditsToAdd, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        } else {
          await supabase
            .from('profiles')
            .insert({ user_id: userId, credits: creditsToAdd });
        }
      } else {
        console.error('Webhook checkout.session.completed sans metadata reconnue:', session.id);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Erreur webhook général:', error);
    return res.status(500).send('Erreur serveur');
  }
}

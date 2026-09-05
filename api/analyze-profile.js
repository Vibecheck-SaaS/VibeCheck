const ALLOWED_ORIGIN = 'https://vibecheck-smoky-seven.vercel.app';
// Rate limit indépendant des crédits : plafonne l'exposition financière même
// en cas de compte compromis ou d'abus avec des crédits achetés en gros.
const MAX_ANALYSES_PER_DAY = 30;

function clampScore(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(10, num));
}

function sanitizeStringArray(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxItems).map((item) => String(item)).filter(Boolean);
}

// Remboursement best-effort si OpenAI échoue APRÈS que le crédit ait été débité —
// pour que l'utilisateur ne perde jamais de crédit à cause d'une panne du service IA.
async function refundCredit(supabase, userId) {
  try {
    const { data: profile } = await supabase.from('profiles').select('credits').eq('user_id', userId).maybeSingle();
    if (profile) {
      await supabase.from('profiles').update({ credits: profile.credits + 1 }).eq('user_id', userId);
    }
  } catch (e) {
    console.error('Erreur remboursement crédit après échec IA:', e);
  }
}

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
    const { imageBase64, mediaType } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!openaiKey || !supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Configuration manquante pour analyze-profile');
      return res.status(500).json({ error: 'Configuration serveur manquante' });
    }

    // 1) Authentification obligatoire — avant, n'importe qui pouvait appeler
    // cet endpoint sans être connecté.
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!userResp.ok) {
      return res.status(401).json({ error: 'Session invalide' });
    }
    const user = await userResp.json();

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image requise' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2) Rate limit indépendant des crédits.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('analyses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if (countError) {
      console.error('Erreur vérification rate limit:', countError);
    } else if ((count || 0) >= MAX_ANALYSES_PER_DAY) {
      return res.status(429).json({ error: 'Trop d\'analyses aujourd\'hui, réessaie demain' });
    }

    // 3) Débit atomique du crédit AVANT l'appel OpenAI — c'est le correctif
    // central : avant, le crédit n'était vérifié qu'au moment du "reveal",
    // bien après que l'analyse complète ait déjà été livrée au navigateur.
    const { error: creditError } = await supabase.rpc('decrement_credit', { p_user_id: user.id });
    if (creditError) {
      if (creditError.message && creditError.message.includes('INSUFFICIENT_CREDITS')) {
        return res.status(402).json({ error: 'Crédits insuffisants' });
      }
      console.error('Erreur décrémentation crédit:', creditError);
      return res.status(500).json({ error: 'Erreur vérification crédit' });
    }

    // 4) Appel à GPT-4 Vision (le crédit est déjà consommé à ce stade)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}`,
                },
              },
              {
                type: 'text',
                text: `Analyze this social media profile screenshot (Tinder, Instagram, LinkedIn, Bumble, etc.) and generate a brutally honest but fun "Roast & Toast" report.

IMPORTANT: Return ONLY a valid JSON object (no markdown, no extra text) with this exact structure:
{
  "vibe_score": <number 1-10>,
  "score_bio": <number 1-10>,
  "score_photos": <number 1-10>,
  "verdict": "<short punchy verdict (max 8 words)>",
  "punchline": "<one witty one-liner that's funny but not mean>",
  "roast": [
    "<specific, funny critique #1 - be sarcastic but not insulting>",
    "<specific, funny critique #2>",
    "<specific, funny critique #3>"
  ],
  "toast": [
    "<genuine positive observation #1>",
    "<genuine positive observation #2>",
    "<genuine positive observation #3>"
  ]
}

ROAST GUIDELINES:
- Be sarcastic, witty, and mocking in a funny way
- Point out red flags, clichés, or awkward choices
- Make the person laugh at themselves, not feel bad
- Examples: "You've got the same 5 gym photos as every other guy", "That filter is doing heavy lifting", "Bio reads like a LinkedIn job posting"
- DO NOT: insult appearance, use slurs, be genuinely mean

TOAST GUIDELINES:
- Find 3 genuine strengths (good photos, interesting bio, clear interests)
- Be honest and encouraging
- Examples: "Your smile is genuinely warm", "That hobby actually makes you interesting", "You sound like someone worth talking to"

SCORING:
- score_bio (1-10): How interesting, clear, and attention-grabbing is the bio/description?
- score_photos (1-10): How good are the photo quality, variety, and first impression?
- vibe_score (1-10): Overall dating/social potential based on what you see

Be SPECIFIC to what's actually in the image. Do NOT make up details.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error:', errText);
      await refundCredit(supabase, user.id);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('No content from OpenAI');
      await refundCredit(supabase, user.id);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('JSON parse error:', e, 'Content:', content);
      await refundCredit(supabase, user.id);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    if (!result.vibe_score || !result.score_bio || !result.score_photos || !result.verdict || !result.punchline || !result.roast || !result.toast) {
      console.error('Invalid result structure:', result);
      await refundCredit(supabase, user.id);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    // 5) Normalisation défensive de la sortie IA — protège contre une image
    // contenant une tentative de prompt injection visant à faire dévier le
    // format ou les valeurs (bornes strictes, peu importe ce que le modèle a produit).
    result.vibe_score = clampScore(result.vibe_score);
    result.score_bio = clampScore(result.score_bio);
    result.score_photos = clampScore(result.score_photos);
    result.verdict = String(result.verdict).slice(0, 120);
    result.punchline = String(result.punchline).slice(0, 300);
    result.roast = sanitizeStringArray(result.roast, 5);
    result.toast = sanitizeStringArray(result.toast, 5);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Erreur analyze-profile:', error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

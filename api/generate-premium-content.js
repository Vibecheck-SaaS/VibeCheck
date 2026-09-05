const ALLOWED_ORIGIN = 'https://vibecheck-smoky-seven.vercel.app';
const MAX_PREMIUM_CALLS_PER_DAY = 10;

const PREMIUM_PROMPT = `You are analyzing a social/dating profile screenshot to provide premium optimization suggestions.

TASK 1 - BIO REWRITE:
Based on the bio/description text visible in the screenshot (and overall vibe from the photos), write 3 alternative bio versions:
1. "Punchy" style - short, confident, a bit cheeky
2. "Fun" style - playful, humor-forward
3. "Intriguant" style - creates curiosity, gives conversation-starter energy
Each must be realistic (not overly long), authentic-sounding, and usable as-is, in FRENCH.
If no bio text is clearly readable in the screenshot, base the rewrites on general dating-bio best practices instead (set "bio_source" to "generic_fallback"). If bio text IS readable, set "bio_source" to "extracted".

TASK 2 - PHOTO ORDER:
Determine how many distinct individual photos of the person are clearly visible/distinguishable within this screenshot (e.g. a grid or carousel of profile photos).
- If 2 or more distinct photos are clearly visible: rank them best-to-worst for a dating profile's FIRST impression (position 1 = should be shown first), each with a short reason, in FRENCH.
- If only 1 photo is visible, or you cannot reliably distinguish separate photos: set "multiple_photos_detected" to false, "ranking" to an empty array, and instead return 2-3 short general tips (in FRENCH) for selecting/ordering profile photos. Do NOT invent a fake ranking of photos that aren't actually visible.

Return ONLY a valid JSON object (no markdown, no extra text) with this exact structure:
{
  "bio_rewrites": [
    {"style": "Punchy", "text": "..."},
    {"style": "Fun", "text": "..."},
    {"style": "Intriguant", "text": "..."}
  ],
  "bio_source": "extracted",
  "photo_order": {
    "multiple_photos_detected": true,
    "ranking": [
      {"position": 1, "description": "short description of which photo", "reason": "..."}
    ],
    "general_tips": []
  }
}`;

function sanitizeBioRewrites(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 5).map((b) => ({
    style: String((b && b.style) || '').slice(0, 40),
    text: String((b && b.text) || '').slice(0, 500),
  }));
}

function sanitizePhotoOrder(po) {
  const safe = { multiple_photos_detected: false, ranking: [], general_tips: [] };
  if (!po || typeof po !== 'object') return safe;
  safe.multiple_photos_detected = !!po.multiple_photos_detected;
  if (Array.isArray(po.ranking)) {
    safe.ranking = po.ranking.slice(0, 10).map((r) => ({
      position: Number(r && r.position) || 0,
      description: String((r && r.description) || '').slice(0, 200),
      reason: String((r && r.reason) || '').slice(0, 300),
    }));
  }
  if (Array.isArray(po.general_tips)) {
    safe.general_tips = po.general_tips.slice(0, 5).map((t) => String(t).slice(0, 300));
  }
  return safe;
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
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!openaiKey || !supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Configuration manquante pour generate-premium-content');
      return res.status(500).json({ error: 'Configuration serveur manquante' });
    }
    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: 'Image requise' });
    }

    // 1) Vérifier l'utilisateur via son token Supabase
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!userResp.ok) {
      return res.status(401).json({ error: 'Session invalide' });
    }
    const user = await userResp.json();

    // 2) Vérifier CÔTÉ SERVEUR que premium_unlocked = true — ne jamais faire confiance
    // à un flag envoyé par le client pour une fonctionnalité payante.
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('premium_unlocked')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Erreur lecture profile premium:', profileError);
      return res.status(500).json({ error: 'Erreur vérification premium' });
    }
    if (!profile || !profile.premium_unlocked) {
      return res.status(403).json({ error: 'Fonctionnalité Premium non débloquée pour ce compte' });
    }

    // 3) Rate limit — évite qu'un compte (légitime ou compromis) ne déclenche
    // des appels IA en boucle même après avoir débloqué Premium.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('premium_generations_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if (!countError && (count || 0) >= MAX_PREMIUM_CALLS_PER_DAY) {
      return res.status(429).json({ error: 'Trop de générations aujourd\'hui, réessaie demain' });
    }
    // Table de suivi optionnelle : si elle n'existe pas encore côté DB, on ne bloque
    // pas la fonctionnalité pour autant (countError sera non-null, on continue sans compter).
    if (countError) {
      console.warn('Table premium_generations_log absente ou inaccessible, rate limit non appliqué:', countError.message);
    } else {
      await supabase.from('premium_generations_log').insert({ user_id: user.id });
    }

    // 4) Générer le contenu via GPT-4 Vision (même clé OPENAI_API_KEY que l'analyse principale)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } },
              { type: 'text', text: PREMIUM_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error (premium):', errText);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('Pas de contenu retourné par OpenAI (premium)');
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('JSON parse error (premium):', e, 'Content:', content);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    if (!result.bio_rewrites || !Array.isArray(result.bio_rewrites) || !result.photo_order) {
      console.error('Structure invalide (premium):', result);
      return res.status(502).json({ error: 'Erreur du service IA' });
    }

    // 5) Normalisation défensive de la sortie IA (borne les tailles/tableaux) —
    // protège contre une image contenant une tentative de prompt injection.
    result.bio_rewrites = sanitizeBioRewrites(result.bio_rewrites);
    result.photo_order = sanitizePhotoOrder(result.photo_order);
    result.bio_source = String(result.bio_source || '').slice(0, 40);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Erreur generate-premium-content:', error);
    return res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

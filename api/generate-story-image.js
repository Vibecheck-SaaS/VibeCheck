export const config = {
  runtime: 'edge',
};

function el(type, style, children) {
  return { type, props: { style, children: children || [] } };
}

// Récupère le fichier de police (woff) depuis Google Fonts en résolvant l'URL réelle
// via leur endpoint CSS — plus fiable qu'une URL de fichier codée en dur (qui peut expirer).
async function loadGoogleFont(family, weight) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype|woff2?)'\)/);
  if (!match) throw new Error(`Police introuvable pour ${family} ${weight}`);
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

export default async function handler(req) {
  try {
    const { ImageResponse } = await import('@vercel/og');
    const { searchParams } = new URL(req.url);

    const score = (searchParams.get('score') || '0.0').slice(0, 5);
    const verdict = (searchParams.get('verdict') || '').slice(0, 60);
    const punchline = (searchParams.get('punchline') || '').slice(0, 140);

    const [archivoBlack, interSemibold] = await Promise.all([
      loadGoogleFont('Archivo Black', 400),
      loadGoogleFont('Inter', 600),
    ]);

    const W = 1080;
    const H = 1920;
    const CORAL = '#FF4D6D';
    const YELLOW = '#FFD84D';
    const TEXT_DIM = '#9A9AA5';

    const root = el('div', {
      width: W,
      height: H,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0B0B10',
      backgroundImage: 'linear-gradient(160deg, #1A1A24 0%, #0F0F16 55%, #0A0A12 100%)',
      fontFamily: 'Inter',
      padding: '100px 72px',
      position: 'relative',
    }, [
      // Halo coral en haut, comme sur le site
      el('div', {
        position: 'absolute', top: 0, left: 0, right: 0, height: 560,
        backgroundImage: 'radial-gradient(ellipse at top, rgba(255,77,109,0.35), rgba(255,77,109,0) 70%)',
        display: 'flex',
      }),

      // Marque VibeCheck
      el('div', { display: 'flex', alignItems: 'center', gap: 18, position: 'relative' }, [
        el('div', { fontSize: 58, display: 'flex' }, ['🔥']),
        el('div', { fontFamily: 'ArchivoBlack', fontSize: 50, color: '#fff', letterSpacing: '-1px', display: 'flex' }, ['VibeCheck']),
      ]),

      el('div', { flex: 1, display: 'flex' }),

      // Score
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }, [
        el('div', { fontFamily: 'ArchivoBlack', fontSize: 270, color: YELLOW, lineHeight: 0.9, display: 'flex' }, [score]),
        el('div', { fontSize: 30, fontWeight: 600, color: TEXT_DIM, letterSpacing: '5px', marginTop: 24, display: 'flex' }, ['VIBE SCORE / 10']),
      ]),

      // Verdict
      el('div', {
        fontFamily: 'ArchivoBlack', fontSize: 58, color: '#fff', textAlign: 'center',
        marginTop: 64, lineHeight: 1.15, display: 'flex', justifyContent: 'center', padding: '0 24px',
      }, [verdict]),

      // Punchline
      el('div', {
        backgroundColor: 'rgba(255,255,255,0.07)',
        borderRadius: 28,
        borderLeft: `9px solid ${CORAL}`,
        padding: '42px 46px',
        marginTop: 54,
        fontSize: 36, fontWeight: 600, color: '#E5E5EA', textAlign: 'center', lineHeight: 1.45,
        display: 'flex',
      }, [punchline]),

      el('div', { flex: 1, display: 'flex' }),

      // CTA bas de page
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }, [
        el('div', { fontSize: 34, fontWeight: 600, color: '#fff', display: 'flex' }, ['Toi aussi check ta vibe']),
        el('div', { fontFamily: 'ArchivoBlack', fontSize: 32, color: CORAL, letterSpacing: '1px', display: 'flex' }, ['VibeCheck']),
      ]),
    ]);

    return new ImageResponse(root, {
      width: W,
      height: H,
      emoji: 'twemoji',
      fonts: [
        { name: 'ArchivoBlack', data: archivoBlack, weight: 400, style: 'normal' },
        { name: 'Inter', data: interSemibold, weight: 600, style: 'normal' },
      ],
    });
  } catch (error) {
    console.error('Erreur generate-story-image:', error.message || error);
    return new Response(JSON.stringify({ error: 'Erreur génération image' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

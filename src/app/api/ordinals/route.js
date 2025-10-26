const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');
  
  if (!path) {
    return Response.json({ error: 'Path required' }, { status: 400 });
  }

  // Check cache
  const cacheKey = path;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return new Response(cached.data, {
      headers: { 'Content-Type': cached.contentType },
    });
  }

  try {
    const response = await fetch(`https://ordinals.com${path}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      return Response.json({ error: 'Ordinals API error' }, { status: response.status });
    }

    const data = await response.text();
    const contentType = response.headers.get('Content-Type') || 'text/plain';

    // Cache the response
    cache.set(cacheKey, {
      data,
      contentType,
      timestamp: Date.now(),
    });

    return new Response(data, {
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

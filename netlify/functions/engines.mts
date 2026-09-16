const engines = [
  { engine_key: 'story', display_name: 'Story Intelligence', engine_type: 'creative', status: 'foundation', version: '0.1.0' },
  { engine_key: 'film', display_name: 'Film Intelligence', engine_type: 'creative', status: 'foundation', version: '0.1.0' },
  { engine_key: 'culture', display_name: 'Cultural Intelligence', engine_type: 'context', status: 'foundation', version: '0.1.0' },
  { engine_key: 'location', display_name: 'Location Grounding', engine_type: 'context', status: 'foundation', version: '0.1.0' },
  { engine_key: 'performance', display_name: 'Performance & Audio', engine_type: 'production', status: 'foundation', version: '0.1.0' },
  { engine_key: 'rendering', display_name: 'Rendering Router', engine_type: 'production', status: 'foundation', version: '0.1.0' },
  { engine_key: 'learning', display_name: 'Continual Learning', engine_type: 'learning', status: 'foundation', version: '0.1.0' }
];

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(JSON.stringify(engines), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  });
};

export const config = { path: '/api/engines' };

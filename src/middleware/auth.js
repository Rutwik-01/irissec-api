/**
 * API Key Authentication Middleware
 * Protects all /api/incidents routes.
 * The valid key is set via the API_KEY environment variable.
 * Requests must include the header: X-API-Key: <key>
 */

const VALID_KEY = process.env.API_KEY || 'dev-key-change-in-production';

function apiKeyAuth(req, res, next) {
  const provided = req.headers['x-api-key'];

  if (!provided) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing X-API-Key header',
    });
  }

  if (provided !== VALID_KEY) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key',
    });
  }

  next();
}

module.exports = apiKeyAuth;

import app from '../src/function.js';

// Vercel serverless: export a request handler (Express app handles req/res)
export default function handler(req, res) {
    return app(req, res);
}

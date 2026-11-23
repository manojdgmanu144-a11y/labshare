const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Returns a Gemini model instance.
 *
 * The model name is configurable via the GEMINI_MODEL environment variable
 * so it can be updated without a code change.  It defaults to gemini-2.5-flash
 * which is the current recommended fast model.
 *
 * GEMINI_API_KEY is validated lazily (at first call) so that tests that inject
 * a mock client via getModel.override() can run without a real key.
 */

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let _client = null;

function _defaultClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY must be set');
  }
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _client;
}

// Allow tests to inject a mock client without touching process.env
let _clientFactory = _defaultClient;

/**
 * Returns a Gemini model instance ready to call generateContent().
 *
 * @returns {import('@google/generative-ai').GenerativeModel}
 */
function getModel() {
  return _clientFactory().getGenerativeModel({ model: MODEL_NAME });
}

/**
 * Override the client factory used by getModel().
 * Pass null to restore the default (real) factory.
 * Intended for unit tests only — do NOT call in production code.
 *
 * @param {(() => { getGenerativeModel: Function }) | null} factory
 */
function _setClientFactory(factory) {
  _clientFactory = factory ?? _defaultClient;
}

/**
 * Wraps a Gemini generateContent() call with a configurable timeout.
 * Rejects with a plain Error (message: 'Gemini timeout') after `ms` ms.
 *
 * Usage:
 *   const text = await withTimeout(model.generateContent(prompt), 10_000)
 *                  .then(r => r.response.text().trim());
 *
 * @param {Promise<any>} promise
 * @param {number}       [ms=10000]
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gemini timeout')), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

module.exports = { getModel, withTimeout, _setClientFactory, MODEL_NAME };

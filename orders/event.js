const https = require("https");

// Reusable keep-alive agent
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 10000,
});

const INSERT_KEY = "56c477dfa392b4135ce8329d8f8bacc1FFFFNRAL";
const ACCOUNT_ID = 3884245;
const INSERT_URL = `https://insights-collector.newrelic.com/v1/accounts/${ACCOUNT_ID}/events`;

const INSERT_HEADERS = {
  "Content-Type": "application/json",
  "X-Insert-Key": INSERT_KEY,
};

/**
 * Sends a custom event to New Relic Insights using the Insert API.
 *
 * @param {Object} eventData - Key/value pairs with event details (metadata, attributes, error info, etc.).
 * @param {string} eventName - The name of the event type (e.g., "ReactError", "UserAction").
 * @param {number} [retries=3] - Optional number of retry attempts if the request fails.
 * @param {number} [delay=500] - Optional initial delay (ms) between retries, with linear backoff.
 *
 * @returns {Promise<void>} Resolves when the event is successfully sent, rejects on failure after retries.
 *
 * @throws {Error} If eventName is invalid, eventData is not an object, or all retries fail.
 *
 * @example
 * // Send a React error event
 * sendEventToNewRelic(
 *   { message: "Component crashed", stack: "Error: ..." },
 *   "ReactError"
 * );
 *
 * @example
 * // Send a user action event with retries
 * sendEventToNewRelic(
 *   { action: "button_click", label: "Buy Now" },
 *   "UserAction",
 *   5, // retries
 *   1000 // delay in ms
 * );
 */
async function sendEventToNewRelic(
  eventData,
  eventName,
  retries = 3,
  delay = 500
) {
  if (!eventName || typeof eventName !== "string") {
    throw new Error("eventName must be a non-empty string");
  }
  if (typeof eventData !== "object") {
    throw new Error("eventData must be an object");
  }

  const payload = [
    { eventType: eventName, timestamp: Date.now(), ...eventData },
  ];

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(INSERT_URL, {
        method: "POST",
        headers: INSERT_HEADERS,
        body: JSON.stringify(payload),
        agent: keepAliveAgent,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to send event: ${resp.status} ${text}`);
      }

      console.log(`✅ Event [${eventName}] sent successfully!`);
      return;
    } catch (err) {
      clearTimeout(timeout);

      if (attempt === retries) {
        console.error(
          `❌ Event [${eventName}] failed after ${retries} retries:`,
          err.message || err
        );
        throw err;
      }

      console.warn(
        `⚠️ Event [${eventName}] attempt ${attempt} failed: ${
          err.message || err
        }. Retrying in ${delay * attempt}ms...`
      );
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
}

module.exports = sendEventToNewRelic;

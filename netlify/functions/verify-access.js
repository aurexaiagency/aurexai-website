const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const token = String(body.token || "").trim();

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Accès invalide" })
      };
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const store = getStore("aurex-access");
    const tokenData = await store.get(`token:${tokenHash}`, {
      type: "json"
    });

    if (!tokenData || !tokenData.clientId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Accès invalide ou expiré" })
      };
    }

    const client = await store.get(`client:${tokenData.clientId}`, {
      type: "json"
    });

    if (!client || client.activeTokenHash !== tokenHash) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Session remplacée ou inactive" })
      };
    }

    const sessionId = String(client.checkoutSessionId || "");

    const stripeKey = sessionId.startsWith("cs_test_")
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY;

    if (!stripeKey || !sessionId.startsWith("cs_")) {
      throw new Error("Stripe configuration missing");
    }

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`
        }
      }
    );

    const session = await response.json();

    if (
      !response.ok ||
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      !session.subscription ||
      !["active", "trialing"].includes(session.subscription.status)
    ) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Abonnement inactif" })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        clientId: client.clientId
      })
    };
  } catch (error) {
    console.error("verify-access error", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur serveur" })
    };
  }
};

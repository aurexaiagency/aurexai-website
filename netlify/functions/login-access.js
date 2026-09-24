const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

exports.handler = async (event) => {
  const jsonHeaders = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const token = String(body.token || "").trim();
const email = String(body.email || "")
  .trim()
  .toLowerCase();
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return {
        statusCode: 403,
        headers: jsonHeaders,
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

    if (!tokenData?.clientId) {
      return {
        statusCode: 403,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Accès invalide ou expiré" })
      };
    }

    const client = await store.get(`client:${tokenData.clientId}`, {
      type: "json"
    });

    if (!client || client.activeTokenHash !== tokenHash) {
      return {
        statusCode: 403,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Accès remplacé ou inactif" })
      };
    }
if (
  !email ||
  String(client.email || "").trim().toLowerCase() !== email
) {
  return {
    statusCode: 403,
    headers: jsonHeaders,
    body: JSON.stringify({
      error: "Adresse e-mail incorrecte"
    })
  };
}
    const sessionId = String(client.checkoutSessionId || "");

    const stripeKey = sessionId.startsWith("cs_test_")
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY;

    if (!stripeKey || !sessionId.startsWith("cs_")) {
      throw new Error("Stripe configuration missing");
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`
        }
      }
    );

    const stripeSession = await stripeResponse.json();

    if (
      !stripeResponse.ok ||
      stripeSession.mode !== "subscription" ||
      stripeSession.status !== "complete" ||
      !stripeSession.subscription ||
      !["active", "trialing"].includes(stripeSession.subscription.status)
    ) {
      return {
        statusCode: 403,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Abonnement inactif" })
      };
    }

    const browserSession = crypto.randomBytes(32).toString("hex");
    const browserSessionHash = crypto
      .createHash("sha256")
      .update(browserSession)
      .digest("hex");

    await store.setJSON(`session:${browserSessionHash}`, {
      clientId: client.clientId,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
await store.setJSON(`client:${tokenData.clientId}`, {
  ...client,
  activeBrowserSessionHash: browserSessionHash,
  updatedAt: new Date().toISOString()
});
    return {
      statusCode: 200,
      headers: {
        ...jsonHeaders,
        "Set-Cookie":
          `aurex_session=${browserSession}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
      },
      body: JSON.stringify({ ok: true })
    };
  } catch (error) {
    console.error("login-access error", error);

    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Erreur serveur" })
    };
  }
};

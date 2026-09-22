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
    const sessionId = String(body.session_id || "").trim();

    if (!sessionId.startsWith("cs_")) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Session invalide" })
      };
    }

    const stripeKey = sessionId.startsWith("cs_test_")
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
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

    if (!response.ok) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Accès refusé" })
      };
    }

    const subscription = session.subscription;

    if (
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      !subscription ||
      !["active", "trialing"].includes(subscription.status)
    ) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Abonnement inactif" })
      };
    }

    const email = String(
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.email ||
      ""
    ).trim().toLowerCase();

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Email client introuvable" })
      };
    }

    const clientId =
      String(session.customer || "") ||
      crypto.createHash("sha256").update(email).digest("hex");

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const store = getStore("aurex-access");

    await store.setJSON(`client:${clientId}`, {
      clientId,
      email,
      stripeCustomerId: session.customer || null,
      subscriptionId: subscription.id || null,
      checkoutSessionId: session.id,
      activeTokenHash: tokenHash,
      updatedAt: new Date().toISOString()
    });

    await store.setJSON(`token:${tokenHash}`, {
      clientId,
      createdAt: new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        token
      })
    };
  } catch (error) {
    console.error("create-access error", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur serveur" })
    };
  }
};

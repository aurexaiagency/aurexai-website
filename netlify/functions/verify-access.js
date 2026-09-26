const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

function getCookie(event, name) {
  const cookieHeader =
    event.headers?.cookie ||
    event.headers?.Cookie ||
    "";

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return "";
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method not allowed"
      })
    };
  }

  try {
    const browserSession = getCookie(
      event,
      "aurex_session"
    );

    if (!/^[a-f0-9]{64}$/i.test(browserSession)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: "Accès invalide"
        })
      };
    }

    const browserSessionHash = crypto
      .createHash("sha256")
      .update(browserSession)
      .digest("hex");

    const store = getStore("aurex-access");

    const sessionData = await store.get(
      `session:${browserSessionHash}`,
      { type: "json" }
    );

    if (
      !sessionData ||
      !sessionData.clientId ||
      !sessionData.expiresAt ||
      Date.now() > Number(sessionData.expiresAt)
    ) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: "Session expirée ou invalide"
        })
      };
    }

    const client = await store.get(
      `client:${sessionData.clientId}`,
      { type: "json" }
    );

    if (!client) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: "Client introuvable"
        })
      };
    }
if (
  client.activeBrowserSessionHash &&
  client.activeBrowserSessionHash !== browserSessionHash
) {
  return {
    statusCode: 403,
    headers,
    body: JSON.stringify({
      error: "Cette session a été remplacée par une nouvelle connexion"
    })
  };
}
    const checkoutSessionId =
      String(client.checkoutSessionId || "");

    const stripeKey =
      checkoutSessionId.startsWith("cs_test_")
        ? process.env.STRIPE_TEST_SECRET_KEY
        : process.env.STRIPE_SECRET_KEY;

    if (
      !stripeKey ||
      !checkoutSessionId.startsWith("cs_")
    ) {
      throw new Error(
        "Stripe configuration missing"
      );
    }

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        checkoutSessionId
      )}?expand[]=subscription`,
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`
        }
      }
    );

    const stripeSession = await response.json();

    const subscription =
      stripeSession.subscription &&
      typeof stripeSession.subscription === "object"
        ? stripeSession.subscription
        : null;

    if (
      !response.ok ||
      stripeSession.mode !== "subscription" ||
      stripeSession.status !== "complete" ||
      !subscription ||
      !["active", "trialing"].includes(
        subscription.status
      )
    ) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: "Abonnement inactif"
        })
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
      body: JSON.stringify({
        error: "Erreur serveur"
      })
    };
  }
};

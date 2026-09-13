exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "https://getaurexai.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const sessionId = String(
      body.sessionId || body.Stripe_Session_ID || ""
    ).trim();

    const nom = String(body.nom || body.Nom || "").trim();
    const email = String(body.email || body.Email || "").trim();
    const entreprise = String(
      body.entreprise || body.Entreprise || ""
    ).trim();

    const site = String(
      body.site || body.Site || body.Site_web || ""
    ).trim();

    const offre = String(
      body.offre || body.Offre || body.Offre_achetee || ""
    ).trim();

    const informations = String(
      body.informations ||
      body.Informations_importantes ||
      ""
    ).trim();

    if (!sessionId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Stripe session missing"
        })
      };
    }

    if (!nom || !email || !entreprise) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Informations client manquantes"
        })
      };
    }

    const clientId =
      "aurex_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);

    const client = {
      clientId,
      stripeSessionId: sessionId,
      nom,
      email,
      entreprise,
      site,
      offre,
      informations,
      status: "pending_verification",
      createdAt: new Date().toISOString()
    };

    console.log("AUREX CLIENT PROVISION REQUEST", client);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        clientId,
        status: client.status
      })
    };
  } catch (error) {
    console.error("Provision error", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server error"
      })
    };
  }
};

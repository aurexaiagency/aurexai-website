function getField(body, ...names) {
  for (const name of names) {
    if (body[name] !== undefined && body[name] !== null) {
      return String(body[name]).trim();
    }
  }
  return "";
}

function parseBody(event) {
  const raw = event.body || "";
  const contentType =
    event.headers?.["content-type"] ||
    event.headers?.["Content-Type"] ||
    "";

  if (contentType.includes("application/json")) {
    return JSON.parse(raw || "{}");
  }

  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function limit(value, max = 450) {
  return String(value || "").slice(0, max);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed"
    };
  }

  try {
    const stripeSecret = Netlify.env.get("STRIPE_SECRET_KEY");

    if (!stripeSecret) {
      console.error("STRIPE_SECRET_KEY missing");
      return {
        statusCode: 500,
        body: "Configuration Stripe manquante."
      };
    }

    const body = parseBody(event);

    const sessionId = getField(
      body,
      "sessionId",
      "Stripe_Session_ID",
      "stripe_session_id"
    );

    const nom = getField(body, "Nom", "nom");
    const email = getField(body, "Email", "email");
    const entreprise = getField(body, "Entreprise", "entreprise");

    const site = getField(
      body,
      "Site",
      "site",
      "Site_web",
      "Site_web_ou_reseau_social"
    );

    const offre = getField(
      body,
      "Offre",
      "offre",
      "Offre_achetee"
    );

    const informations = getField(
      body,
      "Informations_importantes",
      "informations",
      "Projet"
    );

    if (!sessionId || !sessionId.startsWith("cs_")) {
      return {
        statusCode: 400,
        body: "Session Stripe invalide."
      };
    }

    if (!nom || !email) {
      return {
        statusCode: 400,
        body: "Nom et email obligatoires."
      };
    }

    // Vérifie directement la session auprès de Stripe
    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}?expand[]=subscription`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`
        }
      }
    );

    const session = await sessionResponse.json();

    if (!sessionResponse.ok) {
      console.error("Stripe session error", session);
      return {
        statusCode: 400,
        body: "Impossible de vérifier ce paiement."
      };
    }

    const subscription =
      session.subscription &&
      typeof session.subscription === "object"
        ? session.subscription
        : null;

    const subscriptionActive =
      subscription &&
      ["active", "trialing"].includes(subscription.status);

    const correctOffer =
      session.mode === "subscription" &&
      session.currency === "eur" &&
      session.amount_total === 49700;

    const checkoutComplete = session.status === "complete";

    const paymentValid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";

    if (
      !checkoutComplete ||
      !correctOffer ||
      !subscriptionActive ||
      !paymentValid
    ) {
      console.error("Invalid subscription", {
        status: session.status,
        payment_status: session.payment_status,
        mode: session.mode,
        amount_total: session.amount_total,
        currency: session.currency,
        subscription_status: subscription?.status
      });

      return {
        statusCode: 403,
        body: "Aucun abonnement Aurex AI valide n'a été trouvé."
      };
    }

    // Enregistre les informations du client directement dans Stripe
    const metadata = new URLSearchParams();

    metadata.set("metadata[aurex_client]", "true");
    metadata.set("metadata[nom]", limit(nom));
    metadata.set("metadata[email]", limit(email));
    metadata.set("metadata[entreprise]", limit(entreprise));
    metadata.set("metadata[site]", limit(site));
    metadata.set("metadata[offre]", limit(offre));
    metadata.set(
      "metadata[informations]",
      limit(informations)
    );

    const updateResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: metadata.toString()
      }
    );

    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      console.error("Stripe metadata error", error);

      return {
        statusCode: 502,
        body: "Paiement vérifié, mais configuration client impossible."
      };
    }

    console.log("AUREX CLIENT VERIFIED", {
      sessionId,
      subscriptionId: subscription.id,
      entreprise,
      email
    });

    return {
      statusCode: 303,
      headers: {
        Location: `/chatbot.html?session_id=${encodeURIComponent(sessionId)}`
      },
      body: ""
    };
  } catch (error) {
    console.error("Provision error", error);

    return {
      statusCode: 500,
      body: "Une erreur est survenue pendant l'activation."
    };
  }
};

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
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

function limit(value, max = 450) {
  return String(value || "").trim().slice(0, max);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed"
    };
  }

  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;

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
      "Stripe_Session_ID",
      "stripe_session_id",
      "session_id"
    );

    const nom = limit(getField(body, "Nom", "nom"), 120);
    const email = limit(getField(body, "Email", "email"), 200);
    const entreprise = limit(
      getField(body, "Entreprise", "entreprise"),
      200
    );
    const site = limit(
      getField(
        body,
        "Site",
        "site",
        "Site_web",
        "Site_web_ou_reseau_social"
      ),
      300
    );
    const offre = limit(
      getField(body, "Offre", "offre", "Offre_achetee"),
      200
    );
    const informations = limit(
      getField(
        body,
        "Informations_importantes",
        "informations",
        "Projet"
      ),
      450
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

    // Vérification directe de la Checkout Session auprès de Stripe
    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}?expand[]=subscription`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeSecret}`
        }
      }
    );

    const session = await sessionResponse.json();

    if (!sessionResponse.ok) {
      console.error(
        "Stripe session verification failed:",
        session?.error?.type,
        session?.error?.code
      );

      return {
        statusCode: 502,
        body: "Impossible de vérifier ce paiement."
      };
    }

    const subscription =
      session.subscription &&
      typeof session.subscription === "object"
        ? session.subscription
        : null;

    const checkoutComplete = session.status === "complete";

    const subscriptionActive =
      subscription &&
      ["active", "trialing"].includes(subscription.status);

    const validSubscription =
      session.mode === "subscription" &&
      checkoutComplete &&
      subscriptionActive;

    if (!validSubscription) {
      console.error("Subscription verification failed", {
        mode: session.mode,
        sessionStatus: session.status,
        paymentStatus: session.payment_status,
        subscriptionStatus: subscription?.status
      });

      return {
        statusCode: 403,
        body: "Abonnement non actif ou paiement non validé."
      };
    }

    // Enregistrement des informations d'onboarding
    // directement dans la Checkout Session Stripe.
    const metadata = new URLSearchParams();

    metadata.set("metadata[nom]", nom);
    metadata.set("metadata[email]", email);
    metadata.set("metadata[entreprise]", entreprise);
    metadata.set("metadata[site]", site);
    metadata.set("metadata[offre]", offre || "AUREX AI 497 EUR/mois");
    metadata.set("metadata[informations]", informations);
    metadata.set("metadata[onboarding_complete]", "true");

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

    const updatedSession = await updateResponse.json();

    if (!updateResponse.ok) {
      console.error(
        "Stripe metadata update failed:",
        updatedSession?.error?.type,
        updatedSession?.error?.code
      );

      return {
        statusCode: 502,
        body: "Paiement vérifié, mais configuration client impossible."
      };
    }

    console.log("AUREX client activated", {
      session: sessionId.slice(0, 12) + "...",
      subscriptionStatus: subscription.status,
      onboarding: true
    });

    // Paiement + abonnement vérifiés :
    // le client reçoit maintenant l'accès à son chatbot.
    return {
      statusCode: 303,
      headers: {
        Location:
          "/chatbot.html?session_id=" +
          encodeURIComponent(sessionId),
        "Cache-Control": "no-store"
      },
      body: ""
    };
  } catch (error) {
    console.error("Provision client error:", error);

    return {
      statusCode: 500,
      body: "Une erreur est survenue pendant l'activation."
    };
  }
};

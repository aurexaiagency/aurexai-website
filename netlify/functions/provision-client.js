function getField(body, ...names) {
  for (const name of names) {
    if (
      body[name] !== undefined &&
      body[name] !== null
    ) {
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

  return Object.fromEntries(
    new URLSearchParams(raw)
  );
}

function limit(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed"
    };
  }

  try {
    const body = parseBody(event);

    /*
      IMPORTANT :
      on accepte toutes les variantes utilisées
      par notre formulaire Aurex AI.
    */
    const sessionId = getField(
      body,
      "Stripe_session_id",
      "Stripe_Session_ID",
      "stripe_session_id",
      "session_id"
    );

    if (
      !sessionId ||
      !sessionId.startsWith("cs_")
    ) {
      console.error(
        "Missing or invalid Stripe session ID"
      );

      return {
        statusCode: 400,
        body: "Session Stripe invalide."
      };
    }

    /*
      TEST Stripe = STRIPE_TEST_SECRET_KEY
      LIVE Stripe = STRIPE_SECRET_KEY
    */
    const stripeSecret =
      sessionId.startsWith("cs_test_")
        ? process.env.STRIPE_TEST_SECRET_KEY
        : process.env.STRIPE_SECRET_KEY;

    if (!stripeSecret) {
      console.error(
        "Stripe secret key missing for session type"
      );

      return {
        statusCode: 500,
        body:
          "Configuration Stripe manquante."
      };
    }

    /*
      Informations envoyées par le client.
    */
    const nom = limit(
      getField(body, "Nom", "nom"),
      120
    );

    const email = limit(
      getField(body, "Email", "email"),
      200
    );

    const entreprise = limit(
      getField(
        body,
        "Entreprise",
        "entreprise"
      ),
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
      getField(
        body,
        "Offre",
        "offre",
        "Offre_achetee"
      ),
      200
    );

    const langue = limit(
      getField(
        body,
        "Langue",
        "langue"
      ),
      80
    );

    const objectif = limit(
      getField(
        body,
        "Objectif",
        "objectif"
      ),
      1000
    );

    const activite = limit(
      getField(
        body,
        "Activite",
        "activite"
      ),
      1000
    );

    const faq = limit(
      getField(
        body,
        "Questions_frequentes",
        "questions_frequentes",
        "faq"
      ),
      1500
    );

    const informations = limit(
      getField(
        body,
        "Informations_importantes",
        "informations",
        "Projet"
      ),
      1500
    );

    if (!nom || !email || !entreprise) {
      return {
        statusCode: 400,
        body:
          "Nom, email et entreprise obligatoires."
      };
    }

    /*
      Vérification de la session directement
      auprès de Stripe.
    */
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}?expand[]=subscription`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${stripeSecret}`
        }
      }
    );

    const session =
      await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(
        "Stripe session verification failed",
        stripeResponse.status,
        session?.error?.type,
        session?.error?.code
      );

      return {
        statusCode: 502,
        body:
          "Impossible de vérifier ce paiement."
      };
    }

    const subscription =
      session.subscription &&
      typeof session.subscription === "object"
        ? session.subscription
        : null;

    const subscriptionActive =
      subscription &&
      ["active", "trialing"].includes(
        subscription.status
      );

    /*
      Le chatbot est réservé à l'abonnement
      mensuel Aurex AI.
    */
    const validSubscription =
      session.mode === "subscription" &&
      session.status === "complete" &&
      subscriptionActive;

    if (!validSubscription) {
      console.error(
        "Aurex subscription invalid",
        {
          mode: session.mode,
          sessionStatus: session.status,
          paymentStatus:
            session.payment_status,
          subscriptionStatus:
            subscription?.status
        }
      );

      return {
        statusCode: 403,
        body:
          "Abonnement non actif ou paiement non validé."
      };
    }

    /*
      Enregistre les informations du client
      dans la Checkout Session Stripe.

      client-chat.js les récupérera ensuite
      pour personnaliser automatiquement
      le chatbot.
    */
    const metadata =
      new URLSearchParams();

    metadata.set(
      "metadata[nom]",
      nom
    );

    metadata.set(
      "metadata[email]",
      email
    );

    metadata.set(
      "metadata[entreprise]",
      entreprise
    );

    metadata.set(
      "metadata[site]",
      site
    );

    metadata.set(
      "metadata[offre]",
      offre ||
        "Accompagnement mensuel AUREX AI"
    );

    metadata.set(
      "metadata[langue]",
      langue
    );

    metadata.set(
      "metadata[objectif]",
      objectif
    );

    metadata.set(
      "metadata[activite]",
      activite
    );

    metadata.set(
      "metadata[faq]",
      faq
    );

    metadata.set(
      "metadata[informations]",
      informations
    );

    metadata.set(
      "metadata[onboarding_complete]",
      "true"
    );

    const updateResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${stripeSecret}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: metadata.toString()
      }
    );

    const updatedSession =
      await updateResponse.json();

    if (!updateResponse.ok) {
      console.error(
        "Stripe metadata update failed",
        updateResponse.status,
        updatedSession?.error?.type,
        updatedSession?.error?.code
      );

      return {
        statusCode: 502,
        body:
          "Paiement vérifié, mais configuration du chatbot impossible."
      };
    }

    console.log(
      "AUREX AI client activated",
      {
        session:
          sessionId.slice(0, 12) + "...",
        subscriptionStatus:
          subscription.status,
        entreprise,
        onboarding: true
      }
    );

    /*
      Tout est validé.

      Le client est envoyé directement
      vers son chatbot personnalisé.
    */
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
    console.error(
      "AUREX provision client error",
      error
    );

    return {
      statusCode: 500,
      body:
        "Une erreur est survenue pendant l'activation."
    };
  }
};

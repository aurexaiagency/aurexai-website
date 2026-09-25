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
      SESSION STRIPE
      On conserve les variantes déjà compatibles
      avec le système AUREX AI existant.
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
        body: "Configuration Stripe manquante."
      };
    }

    /*
      IDENTITÉ DE L'ENTREPRISE
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

    const secteur = limit(
      getField(
        body,
        "Secteur",
        "secteur"
      ),
      250
    );

    const activite = limit(
      getField(
        body,
        "Activite",
        "activite"
      ),
      1000
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

    const telephone = limit(
      getField(
        body,
        "Telephone",
        "telephone"
      ),
      100
    );

    const adresseZone = limit(
      getField(
        body,
        "Adresse_zone",
        "adresse_zone",
        "Adresse",
        "adresse"
      ),
      700
    );

    /*
      CONNAISSANCES COMMERCIALES
    */
    const services = limit(
      getField(
        body,
        "Services",
        "services"
      ),
      1800
    );

    const tarifs = limit(
      getField(
        body,
        "Tarifs",
        "tarifs"
      ),
      1200
    );

    const horaires = limit(
      getField(
        body,
        "Horaires",
        "horaires"
      ),
      800
    );

    const paiementsConditions = limit(
      getField(
        body,
        "Paiements_conditions",
        "paiements_conditions"
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
      1800
    );

    const informations = limit(
      getField(
        body,
        "Informations_importantes",
        "informations",
        "Projet"
      ),
      1800
    );

    /*
      RENDEZ-VOUS / DEVIS / PROSPECTS
    */
    const reglesRdv = limit(
      getField(
        body,
        "Regles_rdv",
        "regles_rdv"
      ),
      1200
    );

    const reglesDevis = limit(
      getField(
        body,
        "Regles_devis",
        "regles_devis"
      ),
      1200
    );

    const objectif = limit(
      getField(
        body,
        "Objectif",
        "objectif"
      ),
      1000
    );

    const consignesCommerciales = limit(
      getField(
        body,
        "Consignes_commerciales",
        "consignes_commerciales"
      ),
      1200
    );

    const champsProspect = limit(
      getField(
        body,
        "Champs_prospect",
        "champs_prospect"
      ),
      700
    );

    const emailDestination = limit(
      getField(
        body,
        "Email_destination",
        "email_destination"
      ),
      200
    );

    /*
      PERSONNALISATION
    */
    const langue = limit(
      getField(
        body,
        "Langue",
        "langue"
      ),
      80
    );

    const ton = limit(
      getField(
        body,
        "Ton",
        "ton"
      ),
      120
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

    /*
      CHAMPS MINIMUM OBLIGATOIRES
    */
    if (
      !nom ||
      !email ||
      !entreprise ||
      !secteur ||
      !activite ||
      !services ||
      !objectif ||
      !emailDestination
    ) {
      return {
        statusCode: 400,
        body:
          "Certaines informations obligatoires sont manquantes."
      };
    }

    /*
      VÉRIFICATION DE L'ABONNEMENT
      DIRECTEMENT AUPRÈS DE STRIPE.
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
const stripeEmail = String(
  session.customer_details?.email ||
  session.customer_email ||
  ""
).trim().toLowerCase();

if (!stripeEmail || stripeEmail !== email.toLowerCase()) {
  return {
    statusCode: 403,
    body: "L'adresse e-mail ne correspond pas à celle utilisée pour l'abonnement."
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
      ENREGISTREMENT DE LA BASE DE
      CONNAISSANCES DANS STRIPE.

      IMPORTANT :
      les valeurs sont volontairement limitées
      afin de rester compatibles avec les
      métadonnées Stripe.
    */
    const metadata =
      new URLSearchParams();

    const setMeta = (key, value) => {
      metadata.set(
        `metadata[${key}]`,
        limit(value, 450)
      );
    };

    setMeta("nom", nom);
    setMeta("email", email);
    setMeta("entreprise", entreprise);

    setMeta("secteur", secteur);
    setMeta("activite", activite);

    setMeta("site", site);
    setMeta("telephone", telephone);
    setMeta("adresse_zone", adresseZone);

    setMeta("services", services);
    setMeta("tarifs", tarifs);
    setMeta("horaires", horaires);

    setMeta(
      "paiements_conditions",
      paiementsConditions
    );

    setMeta("faq", faq);
    setMeta(
      "informations",
      informations
    );

    setMeta(
      "regles_rdv",
      reglesRdv
    );

    setMeta(
      "regles_devis",
      reglesDevis
    );

    setMeta(
      "objectif",
      objectif
    );

    setMeta(
      "consignes_commerciales",
      consignesCommerciales
    );

    setMeta(
      "champs_prospect",
      champsProspect
    );

    setMeta(
      "email_destination",
      emailDestination
    );

    setMeta("langue", langue);
    setMeta("ton", ton);

    setMeta(
      "offre",
      offre ||
        "Accompagnement mensuel AUREX AI"
    );

    setMeta(
      "onboarding_complete",
      "true"
    );

    setMeta(
      "aurex_version",
      "2"
    );

    /*
      MISE À JOUR DE LA CHECKOUT SESSION.
    */
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
        secteur,
        onboarding: true
      }
    );

    /*
  CRÉATION DE L'ACCÈS SÉCURISÉ
*/
const accessResponse = await fetch(
  "https://getaurexai.com/.netlify/functions/create-access",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session_id: sessionId
    })
  }
);

const accessData = await accessResponse.json();

if (
  !accessResponse.ok ||
  !accessData.token
) {
  console.error(
    "AUREX access creation failed",
    accessData
  );

  return {
    statusCode: 502,
    body: "Impossible de créer l'accès sécurisé."
  };
}

return {
  statusCode: 303,
  headers: {
    Location:
      "/acces.html?token=" +
      encodeURIComponent(accessData.token),
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

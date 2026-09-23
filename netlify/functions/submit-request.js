const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  const reply = (statusCode, data) => ({
    statusCode,
    headers,
    body: JSON.stringify(data)
  });

  const clean = (value, max = 1500) =>
    String(value || "").trim().slice(0, max);

  const escapeHtml = (value) =>
    clean(value, 3000)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  if (event.httpMethod !== "POST") {
    return reply(405, {
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const cookieHeader =
  event.headers?.cookie ||
  event.headers?.Cookie ||
  "";

const sessionCookie = cookieHeader
  .split(";")
  .map((part) => part.trim())
  .find((part) =>
    part.startsWith("aurex_session=")
  );

const browserSession = sessionCookie
  ? decodeURIComponent(
      sessionCookie.slice(
        "aurex_session=".length
      )
    )
  : "";

if (!/^[a-f0-9]{64}$/i.test(browserSession)) {
  return reply(403, {
    success: false,
    error: "Accès client invalide"
  });
}

const browserSessionHash = crypto
  .createHash("sha256")
  .update(browserSession)
  .digest("hex");

const store = getStore("aurex-access");

const browserSessionData = await store.get(
  `session:${browserSessionHash}`,
  { type: "json" }
);

if (
  !browserSessionData?.clientId ||
  !browserSessionData.expiresAt ||
  browserSessionData.expiresAt <= Date.now()
) {
  return reply(403, {
    success: false,
    error: "Session expirée ou invalide"
  });
}

const client = await store.get(
  `client:${browserSessionData.clientId}`,
  { type: "json" }
);

if (!client) {
  return reply(403, {
    success: false,
    error: "Accès client introuvable"
  });
}

if (
  client.activeBrowserSessionHash &&
  client.activeBrowserSessionHash !== browserSessionHash
) {
  return reply(403, {
    success: false,
    error: "Cette session a été remplacée"
  });
}

const sessionId = String(
  client.checkoutSessionId || ""
);
    const type = clean(body.type, 50).toLowerCase();

    const allowedTypes = [
      "prospect",
      "devis",
      "rendez-vous"
    ];

    if (
      !sessionId ||
      !sessionId.startsWith("cs_")
    ) {
      return reply(400, {
        success: false,
        error: "Session invalide"
      });
    }

    if (!allowedTypes.includes(type)) {
      return reply(400, {
        success: false,
        error: "Type de demande invalide"
      });
    }

    /*
      Vérification Stripe :
      impossible d'utiliser cette fonction
      sans abonnement AUREX AI actif.
    */
    const stripeSecret =
      sessionId.startsWith("cs_test_")
        ? process.env.STRIPE_TEST_SECRET_KEY
        : process.env.STRIPE_SECRET_KEY;

    if (!stripeSecret) {
      console.error("Stripe key missing");

      return reply(500, {
        success: false,
        error: "Configuration indisponible"
      });
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId
      )}?expand[]=subscription`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`
        }
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(
        "Stripe request verification failed",
        stripeResponse.status
      );

      return reply(403, {
        success: false,
        error: "Accès non vérifié"
      });
    }

    const subscription =
      session.subscription &&
      typeof session.subscription === "object"
        ? session.subscription
        : null;

    const active =
      session.mode === "subscription" &&
      session.status === "complete" &&
      subscription &&
      ["active", "trialing"].includes(
        subscription.status
      );

    if (!active) {
      return reply(403, {
        success: false,
        error: "Abonnement inactif"
      });
    }

    const metadata = session.metadata || {};

    const entreprise =
      clean(metadata.entreprise, 200) ||
      "Entreprise";

    /*
      IMPORTANT :
      l'adresse de destination vient uniquement
      de la configuration Stripe vérifiée.
      Le visiteur ne peut pas choisir où
      envoyer les données.
    */
    const destination =
      clean(metadata.email_destination, 250);

    if (
      !destination ||
      !destination.includes("@")
    ) {
      return reply(400, {
        success: false,
        error:
          "Adresse de transmission non configurée"
      });
    }

    /*
      Données du prospect.
      On accepte uniquement les champs utiles.
    */
    const nom = clean(body.nom, 150);
    const email = clean(body.email, 250);
    const telephone = clean(body.telephone, 100);
    const besoin = clean(body.besoin, 1500);

    const service = clean(body.service, 500);
    const budget = clean(body.budget, 300);

    const dateSouhaitee =
      clean(body.dateSouhaitee, 150);

    const heureSouhaitee =
      clean(body.heureSouhaitee, 150);

    const informations =
      clean(body.informations, 1800);

    const consent =
      body.consent === true;

    /*
      Il faut au minimum :
      - un besoin,
      - un moyen de contact,
      - le consentement à transmettre.
    */
    if (!besoin) {
      return reply(400, {
        success: false,
        error:
          "Le besoin du client est manquant"
      });
    }

    if (!email && !telephone) {
      return reply(400, {
        success: false,
        error:
          "Un e-mail ou un téléphone est nécessaire"
      });
    }

    if (!consent) {
      return reply(400, {
        success: false,
        error:
          "Le consentement du client est nécessaire"
      });
    }

    /*
      L'e-mail n'est considéré comme transmis
      que si Resend confirme réellement l'envoi.
    */
    const resendKey =
      process.env.RESEND_API_KEY;

    const fromAddress =
      process.env.AUREX_FROM_EMAIL;

    if (!resendKey || !fromAddress) {
      console.error(
        "Email transmission configuration missing"
      );

      return reply(503, {
        success: false,
        error:
          "Transmission temporairement indisponible"
      });
    }

    const labels = {
      prospect: "Nouveau prospect",
      devis: "Nouvelle demande de devis",
      "rendez-vous":
        "Nouvelle demande de rendez-vous"
    };

    const subject =
      `${labels[type]} — ${entreprise}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;color:#111">
        <h2>${escapeHtml(labels[type])}</h2>

        <p>
          Une nouvelle demande a été recueillie
          par votre assistant AUREX AI.
        </p>

        <hr>

        <p>
          <strong>Entreprise :</strong><br>
          ${escapeHtml(entreprise)}
        </p>

        <p>
          <strong>Nom :</strong><br>
          ${escapeHtml(nom || "Non renseigné")}
        </p>

        <p>
          <strong>E-mail :</strong><br>
          ${escapeHtml(email || "Non renseigné")}
        </p>

        <p>
          <strong>Téléphone :</strong><br>
          ${escapeHtml(telephone || "Non renseigné")}
        </p>

        <p>
          <strong>Besoin :</strong><br>
          ${escapeHtml(besoin)}
        </p>

        <p>
          <strong>Service / produit :</strong><br>
          ${escapeHtml(service || "Non renseigné")}
        </p>

        <p>
          <strong>Budget :</strong><br>
          ${escapeHtml(budget || "Non renseigné")}
        </p>

        ${
          type === "rendez-vous"
            ? `
              <p>
                <strong>Date souhaitée :</strong><br>
                ${escapeHtml(
                  dateSouhaitee ||
                  "Non renseignée"
                )}
              </p>

              <p>
                <strong>Heure souhaitée :</strong><br>
                ${escapeHtml(
                  heureSouhaitee ||
                  "Non renseignée"
                )}
              </p>

              <p>
                <em>
                  Ceci est une demande de rendez-vous,
                  pas une confirmation de disponibilité.
                </em>
              </p>
            `
            : ""
        }

        <p>
          <strong>Informations complémentaires :</strong><br>
          ${escapeHtml(
            informations ||
            "Aucune"
          )}
        </p>

        <hr>

        <p style="font-size:12px;color:#666">
          Le visiteur a accepté la transmission
          de ces informations à l'entreprise.
        </p>

        <p style="font-size:12px;color:#666">
          Envoyé automatiquement par AUREX AI.
        </p>
      </div>
    `;

    const emailPayload = {
      from: fromAddress,
      to: [destination],
      subject,
      html
    };

    /*
      Permet à l'entreprise de répondre
      directement au prospect lorsqu'un
      e-mail a été fourni.
    */
    if (email) {
      emailPayload.reply_to = email;
    }

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${resendKey}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(emailPayload)
      }
    );

    const resendData =
      await resendResponse.json();

    if (!resendResponse.ok) {
      console.error(
        "Resend transmission failed",
        resendResponse.status,
        resendData?.name,
        resendData?.message
      );

      return reply(502, {
        success: false,
        error:
          "La demande n'a pas pu être transmise"
      });
    }

    /*
      Seulement ici nous pouvons dire
      que la transmission a réussi.
    */
    return reply(200, {
      success: true,
      transmitted: true,
      type,
      message:
        type === "rendez-vous"
          ? "Votre demande de rendez-vous a bien été transmise à l'entreprise. Le créneau reste à confirmer."
          : type === "devis"
          ? "Votre demande de devis a bien été transmise à l'entreprise."
          : "Votre demande a bien été transmise à l'entreprise."
    });

  } catch (error) {
    console.error(
      "AUREX request transmission error",
      error
    );

    return reply(500, {
      success: false,
      error:
        "La demande n'a pas pu être transmise"
    });
  }
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const message = String(body.message || "").trim();
    const language = body.language === "en" ? "en" : "fr";

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Message manquant" })
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Assistant non configuré" })
      };
    }

    const instructions =
      language === "fr"
        ? `Tu es l'assistant commercial officiel d'AUREX AI.

AUREX AI propose :
- Automatisation IA : à partir de 497 €
- Agent IA personnalisé : à partir de 997 €
- Acquisition clients par IA : à partir de 697 €
- Accompagnement mensuel, maintenance et optimisation : 497 €/mois.

Ton rôle est d'aider les visiteurs à comprendre les services AUREX AI et à choisir la solution adaptée.

Réponds en français de manière professionnelle, claire, concise et commerciale.
Ne garantis jamais de résultats.
N'invente jamais de prix, de fonctionnalités ou de services.
Si le besoin nécessite une étude personnalisée, invite le prospect à demander un devis.`
        : `You are the official sales assistant for AUREX AI.

AUREX AI offers:
- AI Automation: from €497
- Custom AI Agent: from €997
- AI Client Acquisition: from €697
- Monthly maintenance, optimization and support: €497/month.

Help visitors understand AUREX AI services and identify the appropriate solution.

Answer in English in a professional, clear and concise way.
Never guarantee results.
Never invent prices, features or services.
For custom requirements, invite the prospect to request a quote.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions,
        input: message,
        max_output_tokens: 350
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Assistant temporairement indisponible"
        })
      };
    }

    const answer =
      data.output_text ||
      "Je n'ai pas pu générer de réponse. Vous pouvez demander un devis pour être recontacté.";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ answer })
    };

  } catch (error) {
    console.error("AUREX AI assistant error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Erreur de l'assistant"
      })
    };
  }
};

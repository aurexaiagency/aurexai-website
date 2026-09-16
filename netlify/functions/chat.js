exports.handler = async function (event) {
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
    const message = String(body.message || "").trim();
    const language = body.language === "en" ? "en" : "fr";

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Message manquant" })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          answer: "Diagnostic AUREX : OPENAI_API_KEY absente dans la fonction."
        })
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

Aide les visiteurs à comprendre les services AUREX AI et à choisir la solution adaptée.
Réponds en français de manière professionnelle, claire et concise.
Ne garantis jamais de résultats.
N'invente jamais de prix, fonctionnalités ou services.
Si une étude personnalisée est nécessaire, invite le prospect à demander un devis.`
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
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions,
        input: message,
        max_output_tokens: 350
      })
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    if (!response.ok) {
      const code = data?.error?.code || data?.error?.type || "unknown";
      const safeMessage =
        data?.error?.message || "Erreur inconnue renvoyée par OpenAI.";

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer:
            `Diagnostic OpenAI : HTTP ${response.status} — ${code} — ${safeMessage}`
        })
      };
    }

    let answer = data.output_text;

    if (!answer && Array.isArray(data.output)) {
      answer = data.output
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(item => item.type === "output_text")
        .map(item => item.text)
        .filter(Boolean)
        .join("\n");
    }

    if (!answer) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer: "Diagnostic OpenAI : réponse reçue, mais aucun texte n'a été généré."
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer })
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer:
          "Diagnostic AUREX : " +
          (error?.message || "erreur interne inconnue")
      })
    };
  }
};

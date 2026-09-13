const crypto = require("crypto");

function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const parts = signature.split(",");
  const t = parts.find(p => p.startsWith("t="));
  const signatures = parts.filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!t || !signatures.length) return false;

  const expected = crypto.createHmac("sha256", secret)
    .update(`${t.slice(2)}.${payload}`, "utf8").digest("hex");

  return signatures.some(sig => {
    try {
      const a = Buffer.from(sig, "hex");
      const b = Buffer.from(expected, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { statusCode: 500, body: "Webhook not configured" };

  const payload = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");

  const signature = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  if (!verifyStripeSignature(payload, signature, secret))
    return { statusCode: 400, body: "Invalid signature" };

  let stripeEvent;
  try { stripeEvent = JSON.parse(payload); }
  catch { return { statusCode: 400, body: "Invalid JSON" }; }

  switch (stripeEvent.type) {
    case "checkout.session.completed": {
      const s = stripeEvent.data.object;
      console.log("Checkout completed", {
        sessionId: s.id,
        customerId: s.customer,
        customerEmail: s.customer_details?.email || s.customer_email || null,
        mode: s.mode,
        subscriptionId: s.subscription || null
      });
      // Ãtape suivante : provisionner le chatbot Aurex AI du client.
      break;
    }
    case "invoice.paid":
      console.log("Invoice paid", stripeEvent.data.object.id);
      break;
    case "invoice.payment_failed":
      console.log("Payment failed", stripeEvent.data.object.id);
      break;
    case "customer.subscription.deleted":
      console.log("Subscription cancelled", stripeEvent.data.object.id);
      break;
    default:
      console.log("Ignored event:", stripeEvent.type);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

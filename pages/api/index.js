export default function handler(req, res) {
  res.status(200).json({ 
    status: 'API is running', 
    availableEndpoints: [
      '/api/create-checkout-session', 
      '/api/webhook'
    ],
    message: 'API for Stripe form integration is working properly' 
  });
}

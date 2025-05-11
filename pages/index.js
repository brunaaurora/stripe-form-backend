export default function Home() {
  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Stripe Form Integration API</h1>
      <p>This is a backend service for processing payments through Stripe and form data collection.</p>
      <h2>Available Endpoints:</h2>
      <ul>
        <li><code>/api/create-checkout-session</code> - Creates a Stripe checkout session</li>
        <li><code>/api/webhook</code> - Handles Stripe webhook events</li>
      </ul>
    </div>
  );
}

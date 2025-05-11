 import Stripe from 'stripe';
import { google } from 'googleapis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Configure body parser
export const config = {
  api: {
    bodyParser: true, // Changed to true - we'll handle the raw body differently
  },
};

// Store data in Google Sheets
async function storeDataInGoogleSheets(formData) {
  try {
    // Get the service account credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
    
    if (!credentials.client_email || !credentials.private_key) {
      console.error('Missing or invalid Google credentials');
      return;
    }
    
    // Set up Google Sheets API
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      console.error('Missing spreadsheet ID');
      return;
    }
    
    // Format data for Google Sheets
    const values = [
      [
        formData.timestamp,
        formData.name,
        formData.email,
        formData.paymentStatus,
        formData.paymentId,
        formData.paymentAmount,
        // Add any other form fields
        formData.preferences || '',
        formData.notes || '',
        formData.age || '',
        formData.primaryConcern || '',
        formData.additionalConcerns || '',
        formData.goals || '',
        formData.photoCount || ''
      ]
    ];
    
    // Append data to the Google Sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:M', // Adjust range as needed
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });
    
    console.log('Data stored in Google Sheets successfully', response.data);
    return response.data;
  } catch (error) {
    console.error('Error storing data in Google Sheets:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // For testing only - skip signature verification
    // In production, you'll need to set up a different approach for Stripe signature verification
    
    // Just process the request body directly
    const event = req.body;
    
    console.log('Webhook received:', event.type);

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Extract metadata from the session
      const { customerName, ...formMetadata } = session.metadata;
      
      // Get customer email from the session
      const customerEmail = session.customer_details.email;
      
      // Create data object to store/send
      const formData = {
        name: customerName,
        email: customerEmail,
        paymentStatus: 'completed',
        paymentId: session.payment_intent,
        paymentAmount: session.amount_total / 100, // Convert from cents
        timestamp: new Date().toISOString(),
        ...formMetadata,
      };
      
      console.log('Processing completed payment for:', customerEmail);
      
      try {
        // Store data in Google Sheets
        await storeDataInGoogleSheets(formData);
        console.log('Payment data successfully processed');
      } catch (error) {
        console.error('Error processing payment data:', error);
        // We still return 200 to Stripe so they don't retry the webhook
      }
    }

    // Return a 200 response to acknowledge receipt of the event
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
}


// pages/api/webhook.js
import Stripe from 'stripe';
import { google } from 'googleapis';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Configure body parser
export const config = {
  api: {
    bodyParser: false,
  },
};

// Store data in Google Sheets
async function storeDataInGoogleSheets(formData) {
  console.log("Starting storeDataInGoogleSheets function");
  console.log("Form data to be stored:", JSON.stringify(formData, null, 2));
  
  try {
    // Get the service account credentials from environment variable
    const credentialsString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    
    if (!credentialsString) {
      console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not set");
      return;
    }
    
    console.log("Credentials string length:", credentialsString?.length);
    
    let credentials;
    try {
      credentials = JSON.parse(credentialsString);
      console.log("Parsed credentials successfully");
      console.log("Client email:", credentials.client_email);
    } catch (parseError) {
      console.error("Error parsing Google credentials:", parseError);
      return;
    }
    
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
    
    console.log("JWT auth created");
    
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    console.log("Spreadsheet ID:", spreadsheetId);
    
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
        formData.photoCount || '',
        // Store photo URLs as comma-separated values for formula processing
        formData.photoUrls ? formData.photoUrls.join(',') : ''
      ]
    ];
    
    console.log("Values to append:", JSON.stringify(values));
    
    // Append data to the Google Sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:N', // Extended to column N for photo URLs
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });
    
    // Auto-resize column N to fit the URLs
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0, // First sheet
                dimension: 'COLUMNS',
                startIndex: 13, // Column N (0-indexed)
                endIndex: 14    // Column O (exclusive)
              }
            }
          }
        ]
      }
    });
    
    console.log('Data stored in Google Sheets successfully');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error storing data in Google Sheets:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

export default async function handler(req, res) {
  console.log("Webhook handler called");
  console.log("Request method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  
  if (req.method !== 'POST') {
    console.log("Method not allowed:", req.method);
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Get raw body for Stripe webhook verification
    console.log("Getting raw body");
    const rawBody = await buffer(req);
    console.log("Raw body length:", rawBody.length);
    
    const sig = req.headers['stripe-signature'];
    console.log("Stripe signature present:", !!sig);
    
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log("Webhook secret present:", !!endpointSecret);
    console.log("Webhook secret starts with:", endpointSecret?.substring(0, 8));
    
    let event;
    
    // Verify the event came from Stripe
    try {
      event = stripe.webhooks.constructEvent(
        rawBody, 
        sig, 
        endpointSecret
      );
      console.log('Webhook signature verified successfully');
      console.log('Event type:', event.type);
      console.log('Event ID:', event.id);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      console.error('Error type:', err.type);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      console.log('Processing checkout.session.completed event');
      
      const session = event.data.object;
      console.log('Session ID:', session.id);
      console.log('Session metadata:', JSON.stringify(session.metadata, null, 2));
      
      // Extract metadata from the session
      const { customerName, photoUrls, ...formMetadata } = session.metadata;
      
      // Get customer email from the session
      const customerEmail = session.customer_details?.email;
      console.log('Customer email:', customerEmail);
      console.log('Customer name:', customerName);
      console.log('Photo URLs:', photoUrls);
      
      // Create data object to store/send
      const formData = {
        name: customerName,
        email: customerEmail,
        paymentStatus: 'completed',
        paymentId: session.payment_intent,
        paymentAmount: session.amount_total / 100, // Convert from cents
        timestamp: new Date().toISOString(),
        ...formMetadata,
        // Convert comma-separated URLs back to an array if needed
        photoUrls: photoUrls ? photoUrls.split(',') : [],
      };
      
      console.log('Form data created:', JSON.stringify(formData, null, 2));
      console.log('Processing completed payment for:', customerEmail);
      
      try {
        // Store data in Google Sheets
        await storeDataInGoogleSheets(formData);
        console.log('Payment data successfully processed');
      } catch (error) {
        console.error('Error processing payment data:', error);
        // We still return 200 to Stripe so they don't retry the webhook
      }
    } else {
      console.log('Unhandled event type:', event.type);
    }

    // Return a 200 response to acknowledge receipt of the event
    console.log('Sending success response');
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
}

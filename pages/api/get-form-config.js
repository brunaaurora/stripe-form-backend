import { google } from 'googleapis';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Debug: Check if environment variables exist
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is missing');
    }
    
    if (!process.env.GOOGLE_SHEET_ID) {
      throw new Error('GOOGLE_SHEET_ID is missing');
    }
    
    // Initialize Google Sheets API using the full JSON credentials
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Fetch form configuration from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Form_Config!A2:K11',
    });
    
    const rows = response.data.values || [];
    
    // Transform rows into form steps
    const formSteps = rows.map(row => {
      const [
        stepId,
        questionText,
        fieldType,
        isRequired,
        options,
        placeholder,
        validationType,
        displayOrder,
        conditionalShow,
        autoAdvance,
        section
      ] = row;
      
      // Parse options for select fields
      let parsedOptions = [];
      if (options && fieldType === 'select') {
        parsedOptions = options.split(',').map(opt => {
          if (opt.includes(':')) {
            const [value, label] = opt.split(':');
            return { value: value.trim(), label: label.trim() };
          }
          return { value: opt.trim(), label: opt.trim() };
        });
      }
      
      return {
        id: stepId,
        title: questionText || '',
        isQuestion: fieldType !== 'welcome',
        isRequired: isRequired === 'TRUE',
        fieldType,
        options: parsedOptions,
        placeholder: placeholder || '',
        validationType: validationType || '',
        displayOrder: parseInt(displayOrder) || 0,
        conditionalShow: conditionalShow || '',
        autoAdvance: autoAdvance === 'TRUE',
        section: section || 'default'
      };
    });
    
    // Sort by display order
    formSteps.sort((a, b) => a.displayOrder - b.displayOrder);
    
    // Add caching headers
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    
    return res.status(200).json({
      formSteps,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching form config:', error);
    
    // Return more detailed error message
    return res.status(500).json({ 
      error: 'Failed to fetch form configuration',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Google Drive API Integration for Examfriendly
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

let initPromise: Promise<void> | null = null;

export async function initGoogleApi() {
  if (initPromise) return initPromise;

  if (!CLIENT_ID || !API_KEY) {
    console.error("Google API credentials missing. Please set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY.");
  }
  
  initPromise = new Promise<void>((resolve) => {
    const script1 = document.createElement('script');
    script1.src = "https://apis.google.com/js/api.js";
    script1.onload = () => {
      gapi.load('client', async () => {
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        if (gapiInited && gisInited) resolve();
      });
    };
    document.body.appendChild(script1);

    const script2 = document.createElement('script');
    script2.src = "https://accounts.google.com/gsi/client";
    script2.onload = () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: () => {}, // defined at request time
      });
      gisInited = true;
      if (gapiInited && gisInited) resolve();
    };
    document.body.appendChild(script2);
  });
}

export function isAuthorized() {
  try {
    return (window as any).gapi?.client?.getToken() !== null;
  } catch {
    return false;
  }
}

export async function authorize(silent = false) {
  await initGoogleApi();
  
  return new Promise<void>((resolve, reject) => {
    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) {
        console.error("Auth error:", resp);
        reject(resp);
      } else {
        // CRITICAL: Set the token for gapi client
        gapi.client.setToken(resp);
        // Store a flag that we have authorized in this session
        sessionStorage.setItem('google_drive_authorized', 'true');
        resolve();
      }
    };

    if (silent) {
      tokenClient.requestAccessToken({ prompt: '' });
    } else {
      tokenClient.requestAccessToken({ prompt: gapi.client.getToken() === null ? 'consent' : '' });
    }
  });
}

/**
 * Extracts Google Drive file ID from various URL formats
 */
export function extractDriveId(input: string): string {
  if (!input) return '';
  if (!input.includes('drive.google.com') && !input.includes('docs.google.com')) return input;

  // Handle /file/d/ID/view
  const dMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];

  // Handle ?id=ID
  const idMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  return input;
}

export async function checkAuth() {
  await initGoogleApi();
  if (sessionStorage.getItem('google_drive_authorized') === 'true') {
    try {
      await authorize(true);
      return true;
    } catch (e) {
      return false;
    }
  }
  return isAuthorized();
}

export async function uploadToDrive(file: Blob, fileName: string, teacherEmail: string = 'developer@examfriendly.in', mimeType: string = 'application/pdf') {
  const token = gapi.client.getToken();
  if (!token) {
    throw new Error("Google Drive not authorized. Please click 'Authorize' first.");
  }

  try {
    const metadata = {
      name: fileName,
      mimeType: mimeType,
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const uploadResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: new Headers({ 'Authorization': 'Bearer ' + token.access_token }),
      body: form,
    });

    if (!uploadResp.ok) {
      const errorText = await uploadResp.text();
      console.error(`Google Drive Upload Error: ${uploadResp.status} ${uploadResp.statusText}`, errorText);
      throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}. ${errorText}`);
    }

    const fileData = await uploadResp.json();
    if (fileData.error) throw new Error(fileData.error.message);
    const fileId = fileData.id;

    // Share the file with the developer account (teacherEmail)
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: new Headers({ 
        'Authorization': 'Bearer ' + token.access_token,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        role: 'writer',
        type: 'user',
        emailAddress: teacherEmail,
        sendNotificationEmail: false
      }),
    });

    // Also make it readable by anyone with the link as a fallback
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: new Headers({ 
        'Authorization': 'Bearer ' + token.access_token,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    });

    // Get the webViewLink and webContentLink (downloadable link)
    const infoResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,webContentLink`, {
      headers: new Headers({ 'Authorization': 'Bearer ' + token.access_token }),
    });
    const infoData = await infoResp.json();

    // Prefer fileId for internal tracking
    return fileId;
  } catch (err) {
    console.error("Upload error:", err);
    throw err;
  }
}

export async function fetchDriveFileAsBlob(fileId: string): Promise<Blob> {
  const driveId = extractDriveId(fileId);
  if (!driveId) {
    throw new Error("Invalid file ID provided.");
  }

  await initGoogleApi();
  let token = (window as any).gapi?.client?.getToken();
  
  if (!token && sessionStorage.getItem('google_drive_authorized') === 'true') {
    try {
      await authorize(true);
      token = (window as any).gapi?.client?.getToken();
    } catch (e) {
      console.warn("Silent authorize failed in fetchDriveFileAsBlob", e);
    }
  }

  if (!token || !token.access_token) {
    throw new Error("Google Drive not authorized. Please click 'Connect Google Drive' or re-authorize.");
  }

  const url = `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`;
  
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token.access_token }
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`Google Drive Fetch Error: ${resp.status} ${resp.statusText}`, errorText);
      throw new Error(`Failed to fetch file: ${resp.status} ${resp.statusText}. ${errorText}`);
    }

    return await resp.blob();
  } catch (err: any) {
    console.error("Network error fetching from Google Drive:", err);
    if (err.message === 'Failed to fetch') {
      throw new Error("Failed to fetch from Google Drive. This is likely a CORS issue or network block. Please ensure your origin is authorized in Google Cloud Console and check for ad-blockers.");
    }
    throw err;
  }
}

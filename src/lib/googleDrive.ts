/**
 * Google Drive API Integration for Examfriendly (Backend-powered)
 */

/**
 * Extracts Google Drive file ID from various URL formats
 */
export function extractDriveId(input: string): string {
  if (!input) return '';
  if (input.startsWith('local_')) return input;
  if (!input.includes('drive.google.com') && !input.includes('docs.google.com')) return input;

  // Handle /file/d/ID/view
  const dMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];

  // Handle ?id=ID
  const idMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  return input;
}

export async function uploadToDrive(file: Blob, fileName: string, teacherEmail: string = 'developer@examfriendly.in', folderName: string = '', _mimeType: string = 'application/pdf') {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', fileName);
    formData.append('teacherEmail', teacherEmail);
    formData.append('folderName', folderName);

    const apiUrl = `${window.location.origin}/api/drive/upload`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
    });

    const responseText = await response.text();
    
    // Check if the response is HTML (platform security/cookie check)
    if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
      throw new Error("Platform security check required. Please refresh the page or open the app in a new tab to re-authenticate.");
    }

    let responseData: any = null;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse API response as JSON:", responseText);
      if (!response.ok) {
        throw new Error(`Server error (${response.status}): ${responseText.substring(0, 100)}...`);
      }
      throw new Error(`Invalid JSON response from server: ${responseText.substring(0, 100)}...`);
    }

    if (!response.ok) {
      const errorMessage = responseData?.error || `Upload failed: ${response.status} ${response.statusText}`;
      throw new Error(errorMessage);
    }

    if (!responseData) {
      throw new Error("Invalid response from server");
    }

    return responseData.fileId;
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

  try {
    const apiUrl = `${window.location.origin}/api/drive/file/${driveId}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      // Check if the response is HTML (platform security/cookie check)
      if (errorText.includes('<!doctype html>') || errorText.includes('<html')) {
        throw new Error("Platform security check required. Please refresh the page or open the app in a new tab.");
      }
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}. ${errorText}`);
    }

    return await response.blob();
  } catch (err: any) {
    console.error("Network error fetching from Google Drive:", err);
    throw err;
  }
}

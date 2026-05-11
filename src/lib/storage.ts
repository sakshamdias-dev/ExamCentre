/**
 * File storage and retrieval service
 */

/**
 * Extracts file identifier or URL from various input formats
 */
export function extractFileId(input: string): string {
  if (!input) return '';
  
  // If it's already a full URL or relative API path, return it as is
  if (input.startsWith('http') || input.startsWith('/api/storage/file/')) return input;
  
  // Local storage identifier (not the full path yet)
  if (input.startsWith('local_')) return input;

  // Handle various document URLs (kept for backward compatibility with existing entries)
  if (input.includes('drive.google.com') || input.includes('docs.google.com')) {
    const dMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (dMatch) return dMatch[1];
    const idMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];
  }

  return input;
}

export async function uploadFile(file: Blob, fileName: string, _teacherEmail: string = '', _folderName: string = '', _mimeType: string = 'application/pdf') {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', fileName);

    const apiUrl = `/api/storage/upload`;
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

    // Prefer full URL if returned by server, otherwise fallback to fileId
    return responseData.url || responseData.fileId;
  } catch (err) {
    console.error("Upload error:", err);
    throw err;
  }
}

export async function fetchFileAsBlob(fileId: string): Promise<Blob> {
  const driveId = extractFileId(fileId);
  if (!driveId) {
    throw new Error("Invalid file identifier provided.");
  }

  try {
    let apiUrl = driveId;
    
    // If it's a full URL, check if it's our own API and convert to relative to avoid CORS
    if (apiUrl.startsWith('http')) {
      const apiPathIndex = apiUrl.indexOf('/api/storage/file/');
      if (apiPathIndex !== -1) {
        apiUrl = apiUrl.substring(apiPathIndex);
      }
    } else if (!apiUrl.startsWith('/')) {
      apiUrl = `/api/storage/file/${apiUrl}`;
    }

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
    console.error("Network error fetching file:", err);
    throw err;
  }
}

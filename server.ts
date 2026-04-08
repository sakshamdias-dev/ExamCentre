import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: "uploads/" });

async function startServer() {
  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const upload = multer({ dest: "uploads/" });

  // Google Drive Auth
  const getDriveClient = (impersonateEmail?: string) => {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const subject = impersonateEmail || process.env.GOOGLE_DRIVE_IMPERSONATED_USER;

    if (privateKey) {
      // Handle case where the whole JSON was pasted
      try {
        const parsed = JSON.parse(privateKey);
        if (parsed.private_key) {
          privateKey = parsed.private_key;
        }
      } catch (e) {
        // Not JSON, continue
      }

      // Remove surrounding quotes and whitespace
      privateKey = privateKey.trim();
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.substring(1, privateKey.length - 1);
      }
      privateKey = privateKey.trim();
      
      // Replace literal \n with actual newlines (handle both single and double escaped)
      privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
      
      // Normalize all newlines to \n
      privateKey = privateKey.replace(/\r\n/g, '\n');
      
      // Ensure it has the correct PEM headers
      if (!privateKey.includes('-----BEGIN')) {
        // If it's just the base64 part, remove all whitespace and wrap it
        const cleaned = privateKey.replace(/\s/g, '');
        privateKey = `-----BEGIN PRIVATE KEY-----\n${cleaned}\n-----END PRIVATE KEY-----`;
      } else {
        // If it has headers, ensure they are on their own lines and the body is clean
        const lines = privateKey.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        privateKey = lines.join('\n');
      }
    }

    if (!clientEmail || !privateKey) {
      throw new Error("Google Service Account credentials missing. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      // Use a more focused set of scopes by default
      scopes: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly"
      ],
      subject: subject
    });

    return google.drive({ version: "v3", auth });
  };

  /**
   * Helper to get or create a folder by name
   */
  async function getOrCreateFolder(drive: any, folderName: string, parentId?: string) {
    let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    // Create folder
    const fileMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [],
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id",
    });

    // Make the folder public so files inside can be viewed easily
    await drive.permissions.create({
      fileId: folder.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    return folder.data.id;
  }

  // Automatic Drive Setup if impersonation is configured
  if (process.env.GOOGLE_DRIVE_IMPERSONATED_USER) {
    try {
      const drive = getDriveClient();
      const folderId = await getOrCreateFolder(drive, "Examfriendly_Storage_Backend");
      console.log(`[Drive Setup] Successfully initialized folder in ${process.env.GOOGLE_DRIVE_IMPERSONATED_USER}'s drive: ${folderId}`);
    } catch (error: any) {
      console.warn(`[Drive Setup] Automatic initialization failed: ${error.message}`);
      console.warn("Note: This requires Domain-Wide Delegation to be enabled for the service account in the Google Workspace Admin Console.");
    }
  }

  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve uploads directory statically
  app.use("/uploads", express.static(uploadsDir));

  // Health check and diagnostics
  app.get("/api/health", async (req, res) => {
    const diagnostics: any = {
      status: "ok",
      timestamp: new Date().toISOString(),
      env: {
        hasServiceAccountEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        hasServiceAccountKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
        hasFolderId: !!process.env.GOOGLE_DRIVE_FOLDER_ID,
        impersonatedUser: process.env.GOOGLE_DRIVE_IMPERSONATED_USER || "none"
      }
    };

    try {
      // Test Direct Access
      const driveDirect = getDriveClient(""); // Empty string to skip impersonation
      await driveDirect.files.list({ pageSize: 1 });
      diagnostics.driveDirect = { connection: "success" };
    } catch (err: any) {
      diagnostics.driveDirect = { connection: "failed", error: err.message };
    }

    if (process.env.GOOGLE_DRIVE_IMPERSONATED_USER) {
      try {
        // Test Impersonation
        const driveImpersonated = getDriveClient();
        await driveImpersonated.files.list({ pageSize: 1 });
        diagnostics.driveImpersonated = { connection: "success" };
      } catch (err: any) {
        diagnostics.driveImpersonated = { 
          connection: "failed", 
          error: err.message,
          hint: err.message.includes("unauthorized_client") 
            ? "Action Required: Enable Domain-Wide Delegation for this Service Account in Google Workspace Admin Console and authorize the required scopes."
            : undefined
        };
      }
    }

    res.json(diagnostics);
  });

  // API Routes
  app.post("/api/drive/setup-folder", async (req, res) => {
    try {
      const { userEmail } = req.body;
      const targetEmail = userEmail || process.env.GOOGLE_DRIVE_IMPERSONATED_USER || "developer@examfriendly.in";
      
      console.log(`Setting up folder for ${targetEmail} using Domain-Wide Delegation...`);
      
      let drive;
      try {
        drive = getDriveClient(targetEmail);
        // Test connection immediately
        await drive.files.list({ pageSize: 1 });
      } catch (authError: any) {
        console.error("Impersonation failed during setup:", authError.message);
        throw new Error(`Impersonation failed for ${targetEmail}: ${authError.message}. Ensure Domain-Wide Delegation is enabled.`);
      }
      
      // Create the root folder in the user's drive
      const folderId = await getOrCreateFolder(drive, "Examfriendly_Storage_Backend");
      
      // Share it with the service account email (optional, but requested)
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      if (serviceAccountEmail) {
        await drive.permissions.create({
          fileId: folderId,
          requestBody: {
            role: "writer",
            type: "user",
            emailAddress: serviceAccountEmail,
          },
        });
      }

      res.json({ 
        success: true, 
        folderId, 
        message: `Folder 'Examfriendly_Storage_Backend' created in ${targetEmail}'s drive and shared with service account.` 
      });
    } catch (error: any) {
      console.error("Setup folder error:", error);
      res.status(500).json({ 
        error: error.message,
        details: "Ensure Domain-Wide Delegation is enabled for the service account in the Google Workspace Admin Console for the 'https://www.googleapis.com/auth/drive' scope."
      });
    }
  });

  app.post("/api/drive/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { fileName, teacherEmail, folderName } = req.body;

    try {
      let drive = getDriveClient();
      let rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

      // Helper to perform drive operations with fallback
      const performDriveOp = async (op: (d: any) => Promise<any>): Promise<any> => {
        try {
          return await op(drive);
        } catch (err: any) {
          if (err.message.includes("unauthorized_client") && process.env.GOOGLE_DRIVE_IMPERSONATED_USER) {
            console.warn("Impersonation failed at runtime, falling back to direct service account access...");
            drive = getDriveClient(""); // Switch to direct
            return await op(drive);
          }
          throw err;
        }
      };

      // 1. Get or Create Root Folder
      if (!rootFolderId) {
        console.log("GOOGLE_DRIVE_FOLDER_ID not set, using/creating 'Examfriendly_Storage' root folder");
        rootFolderId = await performDriveOp((d) => getOrCreateFolder(d, "Examfriendly_Storage"));
      }

      // 2. Get or Create Subfolder if requested
      let targetFolderId = rootFolderId;
      if (folderName) {
        targetFolderId = await performDriveOp((d) => getOrCreateFolder(d, folderName, rootFolderId));
      } else if (teacherEmail) {
        // Use teacher email as subfolder name to organize
        targetFolderId = await performDriveOp((d) => getOrCreateFolder(d, teacherEmail, rootFolderId));
      }

      const fileMetadata: any = {
        name: fileName || file.originalname,
        parents: [targetFolderId],
      };

      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path),
      };

      const driveFile = await performDriveOp((d) => d.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id",
      }));

      const fileId = driveFile.data.id;

      // Share the file so it can be viewed without login
      await performDriveOp((d) => d.permissions.create({
        fileId: fileId!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      }));

      // If teacher email is provided, also give them writer access
      if (teacherEmail) {
        try {
          await performDriveOp((d) => d.permissions.create({
            fileId: fileId!,
            requestBody: {
              role: "writer",
              type: "user",
              emailAddress: teacherEmail,
            },
          }));
        } catch (e) {
          console.warn(`Could not share file with ${teacherEmail}:`, e);
        }
      }

      // Clean up local file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      res.json({ fileId });
    } catch (error: any) {
      console.error("Drive upload error, falling back to local storage:", error.message);
      
      // Fallback to local storage
      // Multer already saved it to uploads/ with a random name.
      // We'll rename it to something more descriptive if possible, or just use it.
      const localFileId = `local_${file.filename}`;
      
      res.json({ 
        fileId: localFileId,
        isLocal: true,
        error: error.message 
      });
    }
  });

  app.get("/api/drive/file/:fileId", async (req, res) => {
    try {
      let { fileId } = req.params;
      console.log(`[File Proxy] Requesting file: ${fileId}`);

      // Strip .pdf extension if it was added as a hint for the browser
      const hasPdfHint = fileId.toLowerCase().endsWith('.pdf');
      const cleanFileId = hasPdfHint ? fileId.slice(0, -4) : fileId;

      // Handle local fallback files
      if (cleanFileId.startsWith('local_')) {
        const filename = cleanFileId.replace('local_', '');
        const filePath = path.join(uploadsDir, filename);
        
        if (fs.existsSync(filePath)) {
          // Detect PDF by magic bytes
          const buffer = Buffer.alloc(4);
          try {
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, 4, 0);
            fs.closeSync(fd);
          } catch (e) {
            console.error("[File Proxy] Error reading magic bytes:", e);
          }
          
          const isPdf = buffer.toString() === '%PDF';
          
          if (isPdf || hasPdfHint || req.query.type === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
            res.setHeader('Content-Security-Policy', "frame-ancestors *");
            res.setHeader('X-Frame-Options', 'ALLOWALL');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('X-XSS-Protection', '0');
            // Use stream for local files when forcing content-type to avoid res.sendFile overriding it
            return fs.createReadStream(filePath).pipe(res);
          }
          
          return res.sendFile(filePath);
        } else {
          console.error(`[File Proxy] Local file not found: ${filePath}`);
          return res.status(404).json({ error: "Local file not found" });
        }
      }

      const drive = getDriveClient();
      const response = await drive.files.get(
        { fileId: cleanFileId, alt: "media" },
        { responseType: "stream" }
      );

      // Forward headers if possible
      let contentType = response.headers["content-type"];
      
      // If it's a PDF from drive, ensure correct header
      if (hasPdfHint || req.query.type === 'pdf') {
        contentType = 'application/pdf';
      }

      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-XSS-Protection', '0');

      if (response.headers["content-length"]) {
        res.setHeader("Content-Length", response.headers["content-length"]);
      }

      response.data
        .on("error", (err) => {
          console.error("[File Proxy] Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
    } catch (error: any) {
      console.error("[File Proxy] Error:", error.message);
      if (!res.headersSent) {
        res.status(error.code || 500).json({ error: error.message });
      }
    }
  });

  // 404 handler for API routes - MUST be before Vite middleware
  app.all("/api/*", (req, res) => {
    console.warn(`API 404: ${req.method} ${req.url}`);
    res.status(404).json({ 
      error: "API endpoint not found", 
      method: req.method,
      path: req.url 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error handler:", err);
    res.status(err.status || 500).json({ 
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
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

  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve uploads directory statically
  app.use("/uploads", express.static(uploadsDir));

  // Health check and diagnostics
  app.get("/api/health", async (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      storage: "local"
    });
  });

  // API Routes
  app.post("/api/storage/upload", (req, res, next) => {
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

    try {
      // Local ID for the file stored in uploads/
      const localFileId = `local_${file.filename}`;
      
      // Construct the relative URL
      const url = `/api/storage/file/${localFileId}`;

      console.log(`[Upload] File saved locally: ${localFileId}, URL: ${url}`);

      res.json({ 
        fileId: localFileId,
        url: url,
        isLocal: true
      });
    } catch (error: any) {
      console.error("Local save error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/storage/file/:fileId", async (req, res) => {
    try {
      let { fileId } = req.params;
      console.log(`[File Proxy] Requesting file: ${fileId}`);

      // Strip .pdf extension if it was added as a hint for the browser
      const hasPdfHint = fileId.toLowerCase().endsWith('.pdf');
      let cleanFileId = hasPdfHint ? fileId.slice(0, -4) : fileId;

      // Ensure we only look for local files
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
          res.setHeader('Content-Security-Policy', "frame-ancestors *; default-src 'self' blob: data: *; style-src 'self' 'unsafe-inline' *; script-src 'self' 'unsafe-inline' 'unsafe-eval' *;");
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-XSS-Protection', '0');
          // Use stream for local files when forcing content-type to avoid res.sendFile overriding it
          return fs.createReadStream(filePath).pipe(res);
        }
        
        // For images, detect content type
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
        if (ext === '.png') res.setHeader('Content-Type', 'image/png');
        if (ext === '.gif') res.setHeader('Content-Type', 'image/gif');

        res.setHeader('Content-Security-Policy', "frame-ancestors *");
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        return res.sendFile(filePath);
      } else {
        console.error(`[File Proxy] Local file not found: ${filePath}`);
        return res.status(404).json({ error: "File not found" });
      }
    } catch (error: any) {
      console.error("[File Proxy] Error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  /**
   * Supabase Profile Proxy
   * Used to bypass client-side CORS/Network issues in restricted environments
   */
  app.get("/api/profiles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: "Supabase credentials missing on server" });
      }

      // We use fetch since supabase-js is not installed on the server (actually it is in package.json, but using fetch is simpler here)
      const targetUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${id}&select=*`;
      const response = await fetch(targetUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Accept': 'application/json',
          'Prefer': 'plurality=singular'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        return res.status(response.status).json(errorData);
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Supabase Proxy] Error:", error.message);
      res.status(500).json({ error: error.message });
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

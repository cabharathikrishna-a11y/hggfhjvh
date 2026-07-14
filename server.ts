import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { genkit } from "genkit";
import { googleAI, gemini15Flash } from "@genkit-ai/googleai";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Lazy-initialized Genkit Client
let genkitInstance: any = null;
function getGenkit(): any {
  if (!genkitInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please add it in the Secrets panel.");
    }
    genkitInstance = genkit({
      plugins: [googleAI({ apiKey })],
    });
  }
  return genkitInstance;
}

// Lazy-initialized Gemini Client
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please add it in the Secrets panel.");
    }
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Gemini Chat & Image Generation endpoint
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { prompt, systemInstruction } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const client = getGeminiClient();
    const lowercasePrompt = prompt.toLowerCase();

    // Check if user is requesting image generation
    const isImageRequest = 
      lowercasePrompt.includes("generate image") || 
      lowercasePrompt.includes("draw") || 
      lowercasePrompt.includes("create image") || 
      lowercasePrompt.includes("paint") || 
      lowercasePrompt.includes("sketch") || 
      lowercasePrompt.includes("generate art") || 
      lowercasePrompt.includes("picture");

    if (isImageRequest) {
      console.log(`Generating image for prompt: "${prompt}"`);
      // Use gemini-3.1-flash-lite-image as per the skill guidelines
      const response = await client.models.generateContent({
        model: "gemini-3.1-flash-lite-image",
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      // Extract image part
      let base64Image: string | null = null;
      let textResponse: string | null = null;

      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            base64Image = part.inlineData.data || null;
          } else if (part.text) {
            textResponse = part.text;
          }
        }
      }

      if (base64Image) {
        return res.json({
          text: textResponse || "Here is your generated image:",
          base64Image: base64Image,
          modelUsed: "gemini-3.1-flash-lite-image"
        });
      } else {
        return res.json({
          text: response.text || "I was unable to generate an image part, but here is my textual response.",
          modelUsed: "gemini-3.1-flash-lite-image"
        });
      }
    } else {
      // Standard chat response using Firebase Genkit
      console.log(`Generating text using Genkit for prompt: "${prompt}"`);
      const aiInstance = getGenkit();
      const response = await aiInstance.generate({
        model: gemini15Flash,
        prompt: prompt,
        config: systemInstruction ? { systemInstruction } : undefined,
      });

      return res.json({
        text: response.text || "No response received.",
        modelUsed: "gemini-1.5-flash (Firebase Genkit)"
      });
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || "Failed to communicate with Gemini API" });
  }
});

// JSON Local Backup
app.post("/api/backup", (req, res) => {
  try {
    const data = req.body;
    const backupPath = path.join(process.cwd(), "life_os_backup.json");
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), "utf8");
    res.json({ success: true, message: "Backup saved successfully." });
  } catch (error: any) {
    console.error("Backup Error:", error);
    res.status(500).json({ error: error.message || "Failed to save backup on server." });
  }
});

// JSON Local Restore
app.get("/api/restore", (req, res) => {
  try {
    const backupPath = path.join(process.cwd(), "life_os_backup.json");
    if (fs.existsSync(backupPath)) {
      const content = fs.readFileSync(backupPath, "utf8");
      res.json({ success: true, data: JSON.parse(content) });
    } else {
      res.json({ success: false, message: "No backup file found." });
    }
  } catch (error: any) {
    console.error("Restore Error:", error);
    res.status(500).json({ error: error.message || "Failed to restore backup from server." });
  }
});

// -----------------------------------------------------------------------------
// Vite Middleware / Static Asset Serving
// -----------------------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

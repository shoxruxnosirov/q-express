import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// When CLIENT_DIST_DIR is set the API also serves the built web app, so a
// single deployment covers both and the browser's relative /api calls need no
// proxy. Unset in development, where Vite serves the app and proxies /api.
const clientDirSetting = process.env.CLIENT_DIST_DIR;
if (clientDirSetting) {
  // res.sendFile needs an absolute path, and a relative setting resolves
  // against the working directory the server was started from.
  const clientDir = path.resolve(clientDirSetting);
  const indexFile = path.join(clientDir, "index.html");
  app.use(express.static(clientDir));
  // Client-side routes (/catalog, /admin, ...) have no file of their own, so
  // anything that is not an API call falls back to the app shell.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    return res.sendFile(indexFile);
  });
}

// Keep malformed request errors client-visible without leaking database or
// provider details. Route-specific validation adds the more useful Uzbek
// messages for quantity and stock rules.
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof Error && error.name === "ZodError") {
    return res.status(400).json({ error: "Kiritilgan ma'lumotlar noto‘g‘ri" });
  }
  req.log.error({ error }, "Unhandled API error");
  return res.status(500).json({ error: "Serverda xatolik yuz berdi" });
});

export default app;

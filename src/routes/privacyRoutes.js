import express from "express";
import { fileURLToPath } from "node:url";
const router = express.Router();
router.get("/", (req, res) =>
  res.sendFile(
    fileURLToPath(new URL("../privacy/policy.html", import.meta.url))
  )
);
export default router;

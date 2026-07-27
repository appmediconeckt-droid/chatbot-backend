// import express from "express";
// import { optionalAuth } from "../middleware/authMiddleware.js";
// import {
//   detectLanguage,
//   getSupportedLanguages,
//   translateText,
// } from "../controllers/translateController.js";

// const router = express.Router();

// router.get("/languages", optionalAuth, getSupportedLanguages);
// router.post("/detect", optionalAuth, detectLanguage);
// router.post("/", optionalAuth, translateText);

// export default router;



import express from "express";
import {
  translateBatchText,
  translateText,
} from "../controllers/translateController.js";

const router = express.Router();

router.post("/text", translateText);
router.post("/batch", translateBatchText);

export default router;

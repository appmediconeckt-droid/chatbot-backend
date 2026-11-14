import { expect } from "chai";
import express from "express";
import { readFileSync } from "node:fs";
import request from "supertest";
import privacyRoutes from "../src/routes/privacyRoutes.js";
it("serves the matching iOS policy with the removed permission features and 90-day retention", async () => {
  const app = express(); app.use("/privacy", privacyRoutes);
  const response = await request(app).get("/privacy/ios");
  expect(response.status).to.equal(200);
  expect(response.text).to.include("90 days");
  expect(response.text).to.include("does not request camera");
  expect(response.text).not.to.include("Humaeli requests microphone access");
  expect(response.text).not.to.match(/<script|<iframe|AI Assistant/i);
});

it("public deletion instructions match the 90-day policy and include the in-app path", () => {
  const html = readFileSync(new URL("../src/public/delete-account.html", import.meta.url), "utf8");
  expect(html).to.include("90 days");
  expect(html).to.include("Settings and select Delete Account");
  expect(html).to.include('href="/privacy/ios"');
  expect(html).not.to.include("retention requirements await approval");
});

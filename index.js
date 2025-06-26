const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const app = express();
require("dotenv").config();

app.get("/token", async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: process.env.CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  try {
    const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, "\n");
    const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: "Token generation failed", details: e.message });
  }
});

app.listen(3000, () => {
  console.log("JWT service running on port 3000");
});

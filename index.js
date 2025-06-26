const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

const jwt = require("jsonwebtoken");

app.get("/", (req, res) => {
  res.send("JWT Firebase service running");
});

app.get("/token", (req, res) => {
  const payload = {
    iss: process.env.FIREBASE_CLIENT_EMAIL,
    sub: process.env.FIREBASE_CLIENT_EMAIL,
    aud: "https://storage.googleapis.com/",
    scope: "https://www.googleapis.com/auth/devstorage.full_control",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  try {
    const token = jwt.sign(payload, process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), {
      algorithm: "RS256",
    });

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: "Token generation failed", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`JWT Firebase Service listening on port ${port}`);
});

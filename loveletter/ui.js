"use strict";

/* Serves the browser client, which runs the very same engine files the API uses. */

const path = require("path");
const express = require("express");

const router = express.Router();

router.use(express.static(path.join(__dirname, "public")));

for (const file of ["cards.js", "engine.js"]) {
  router.get(`/lib/${file}`, (req, res) => {
    res.type("application/javascript").sendFile(path.join(__dirname, file));
  });
}

module.exports = router;

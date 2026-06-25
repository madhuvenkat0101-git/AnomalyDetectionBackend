require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const rateLimit = require(
  "express-rate-limit"
);

const alertsRoute = require(
  "./routes/alerts.route"
);

require("./services/socket.service");

const app = express();

app.use(helmet());

app.use(cors());

app.use(express.json());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

app.use(
  "/api/alerts",
  require("./middleware/apiKey"),
  alertsRoute
);

app.listen(process.env.PORT);
const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const authHandler = require('./api/auth');
const bookingsHandler = require('./api/bookings');
const branchesHandler = require('./api/branches');
const inventoryHandler = require('./api/inventory');
const servicesHandler = require('./api/services');
const usersHandler = require('./api/users');

app.all(/^\/api\/auth/, (req, res) => authHandler(req, res));
app.all(/^\/api\/bookings/, (req, res) => bookingsHandler(req, res));
app.all(/^\/api\/branches/, (req, res) => branchesHandler(req, res));
app.all(/^\/api\/inventory/, (req, res) => inventoryHandler(req, res));
app.all(/^\/api\/services/, (req, res) => servicesHandler(req, res));
app.all(/^\/api\/users/, (req, res) => usersHandler(req, res));

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
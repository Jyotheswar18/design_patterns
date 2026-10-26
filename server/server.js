const express = require('express');
const path = require('path');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from 'public'
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// SPA fallback: Return index.html for unrecognized non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Hospital Queue & Triage Management System`);
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Serving static frontend from 'public/'`);
    console.log(` API endpoints mounted under '/api'`);
    console.log(`=======================================================`);
  });
}

module.exports = app;

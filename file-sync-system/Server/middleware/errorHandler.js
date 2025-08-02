// middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.details.map(d => d.message)
    });
  }
  
  if (err.code) {
    switch (err.code) {
      case '23505':
        return res.status(409).json({ error: 'Resource already exists' });
      case '23503':
        return res.status(400).json({ error: 'Invalid reference' });
      default:
        return res.status(500).json({ error: 'Database error' });
    }
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

module.exports = { errorHandler };
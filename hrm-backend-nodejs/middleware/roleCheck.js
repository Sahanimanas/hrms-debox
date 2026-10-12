const { UserRole } = require('../models/schemas');

/**
 * Middleware to check if user has required role(s)
 * @param {string[]} allowedRoles - Array of allowed roles
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        detail: 'Not authenticated'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        detail: 'Not enough permissions'
      });
    }

    next();
  };
};

/**
 * Check if user is admin
 */
const requireAdmin = requireRole([UserRole.ADMIN]);

/**
 * Check if user is admin or manager
 */
const requireAdminOrManager = requireRole([UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Middleware to validate request body against Joi schema
 * @param {object} schema - Joi validation schema
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
      abortEarly: false,
      stripUnknown: true 
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(422).json({
        detail: 'Validation failed',
        errors
      });
    }
    
    req.validatedBody = value;
    next();
  };
};

/**
 * Fine-grained permissions (PL-5). requirePermission('payroll.view', 'payroll.run')
 * passes when the user holds ANY of the listed permissions; admins always pass.
 * hasPermission(user, 'audit.view') -> Promise<boolean>.
 * Loaded lazily so this file keeps no hard dependency on the platform module.
 */
const requirePermission = (...perms) => {
  let middleware = null;
  return (req, res, next) => {
    if (!middleware) middleware = require('../services/platform/permissions').requirePermission(...perms);
    return middleware(req, res, next);
  };
};

const hasPermission = (user, permission) =>
  require('../services/platform/permissions').hasPermission(user, permission);

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrManager,
  validate,
  requirePermission,
  hasPermission
};

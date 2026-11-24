import { apiResponse } from '../utils/apiResponse.js'

/**
 * Normalizes role names (e.g. CUSTOMER -> CREATOR)
 */
function normalizeRole(role) {
  if (!role) return ''
  const upper = role.toUpperCase()
  if (upper === 'CUSTOMER') return 'CREATOR'
  return upper
}

/**
 * Role-Based Access Control (RBAC) middleware
 * @param  {...string} allowedRoles Roles permitted to access the endpoint
 */
export function authorize(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map(normalizeRole)

  return (req, res, next) => {
    if (!req.user) {
      return apiResponse.error(
        res,
        'Authentication required prior to authorization check',
        401,
        'UNAUTHORIZED'
      )
    }

    const userRole = normalizeRole(req.user.role)

    // SUPER_ADMIN has full permissions across all admin & system routes
    if (userRole === 'SUPER_ADMIN') {
      return next()
    }

    // Check if user's role is in the allowed list
    if (normalizedAllowed.includes(userRole)) {
      return next()
    }

    return apiResponse.error(
      res,
      'Access denied: insufficient permissions for this resource',
      403,
      'FORBIDDEN'
    )
  }
}

export default authorize

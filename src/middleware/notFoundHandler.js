import { apiResponse } from '../utils/apiResponse.js'

export function notFoundHandler(req, res) {
  return apiResponse.error(
    res,
    `Route ${req.method} ${req.originalUrl} not found`,
    404,
    'NOT_FOUND'
  )
}

export default notFoundHandler

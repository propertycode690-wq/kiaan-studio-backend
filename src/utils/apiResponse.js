/**
 * Standard API response envelope helpers.
 */
export const apiResponse = {
  /**
   * Formats a successful API response envelope.
   */
  success: (res, data = {}, statusCodeOrMessage = 200, meta = {}) => {
    let statusCode = 200
    let customMeta = { ...meta }

    if (typeof statusCodeOrMessage === 'string') {
      customMeta.message = statusCodeOrMessage
      statusCode = 200
    } else if (typeof statusCodeOrMessage === 'number') {
      statusCode = statusCodeOrMessage
    }

    return res.status(statusCode).json({
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...customMeta
      }
    })
  },

  /**
   * Formats a 201 Created API response envelope.
   */
  created: (res, data = {}, message = 'Resource created successfully', meta = {}) => {
    return res.status(201).json({
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        message,
        ...meta
      }
    })
  },

  /**
   * Formats an error API response envelope.
   */
  error: (res, message = 'Internal Server Error', statusCode = 500, code = 'INTERNAL_ERROR', details = []) => {
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        details
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    })
  }
}

export default apiResponse

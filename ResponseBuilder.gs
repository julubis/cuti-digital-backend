// Response Builder - Consistent API responses
const Response = {
  success: function(data, message = null) {
    return {
      status: true,
      data: data,
      message: message
    };
  },

  error: function(message, data = null) {
    return {
      status: false,
      data: data,
      message: message
    };
  },

  unauthorized: function(message = 'Token tidak valid atau sudah kadaluarsa') {
    return this.error(message);
  },

  notFound: function(message = 'Data tidak ditemukan') {
    return this.error(message);
  },

  validation: function(message) {
    return this.error(message);
  }
};

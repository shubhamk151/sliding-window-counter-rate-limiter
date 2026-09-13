function createRequest() {
  return {
    ip: "127.0.0.1",
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},

    setHeader(name, value) {
      this.headers[name] = value;
    },

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },
  };
}

function runMiddleware(limiter) {
  return new Promise(async (resolve, reject) => {
    const req = createRequest();
    const res = createResponse();

    try {
      await limiter(req, res, () => {
        resolve({
          statusCode: 200,
          headers: res.headers,
          body: res.body,
        });
      });

      if (res.statusCode !== 200) {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: res.body,
        });
      }
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  createRequest,
  createResponse,
  runMiddleware,
};
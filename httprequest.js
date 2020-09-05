const request = require('request');
const { Readable } = require('stream');
const { isArray } = require('lodash');

function createStream(body) {
  return new Readable({
    read: function () {
      if (body && isArray(body)) {
        const buffers = body;
        for (const buf of buffers) {
          this.push(buf);
        }
      } else {
        this.push(body);
      }
      this.push(null);
    }
  });
}


function isJsonString(str) {
  try {
    if (typeof JSON.parse(str) === "object") {
      return true;
    }
  } catch (e) {
  }
  return false;
}

module.exports.sendRequest = function sendRequest(req) {
  return new Promise((resolve, reject) => {
    // console.log(req.headers);
    createStream(req.body).pipe(request.put({
      uri: req.uri,
      headers: {
        ...req.headers,
      },
      family: 4,
      forever: true,
    }, function (error, response, body) {
      if (error) {
        reject(error);
      }

      if (isJsonString(body) && JSON.parse(body).code === 200) {
        resolve(JSON.parse(body));
      } else {
        reject(`uri: ${req.uri}; body: ${body}`);
      }

    }))
  });
}

module.exports.sendPost = function checkRequest(req) {
  return new Promise((resolve, reject) => {
    request.post({
      uri: req.uri,
      headers: {
        ...req.headers,
      },
      body: req.body,
      family: 4,
      json: true
    }, function (error, response, body) {
      if (error) {
        reject(error);
      }

      if(!body || typeof body === 'string' || !('code' in body) || body.code !== 200) {
        reject(`uri: ${req.uri}; body: ${JSON.stringify(body)}`);
      } else {
        resolve(body);
      }

    })
  });
}

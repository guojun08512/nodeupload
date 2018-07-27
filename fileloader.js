const fs = require('fs');

module.exports.loadFile = function loadFile(fullpath) {
  return new Promise((resolve, reject) => {
    fs.readFile(fullpath, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

module.exports.loadPart = function loadPart(fullpath, start, end) {
  if (start < 0 || end < 0 || start >= end) {
    return Promise.reject(new Error(`range error [${start}, ${end})`));
  }
  return new Promise((resolve, reject) => {
    fs.stat(fullpath, (err, stats) => {
      if (err) {
        return reject(err);
      }
      if (end > stats.size) {
        return reject(new Error(`read file '${fullpath}' exceed file size`));
      }
      fs.open(fullpath, 'r', (err, fd) => {
        if (err) {
          return reject(err);
        }
        const buffer = Buffer.allocUnsafe(end - start);
        fs.read(fd, buffer, 0, buffer.length, start, (err, bytesRead, buffer) => {
          fs.closeSync(fd);
          if (err) {
            reject(err);
          } else {
            resolve(buffer);
          }
        });
      });
    });
  });
}

const webpush = require("web-push");

const keys = webpush.generateVAPIDKeys();

console.log(JSON.stringify({
  publicKey: keys.publicKey,
  privateKey: keys.privateKey
}, null, 2));

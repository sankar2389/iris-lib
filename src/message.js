/*jshint unused: false */
`use strict`;
import util from './util';
import Attribute from './attribute';
import Key from './key';

const errorMsg = `Invalid  message:`;

class ValidationError extends Error {}

/**
* Messages are objects containing fields signedData, signer (public key) and signature. Message identifier is the base64 sha256 hash derived from its canonical utf8 string representation.
*
* signedData has an author, recipient, signer, type, time and optionally other fields.
*
* signature covers the utf8 string representation of signedData. Since messages are digitally signed, users only need to care about the message signer and not who relayed it or whose index it was found from.
*
* signer is the entity that verified its origin. In other words: message author and signer can be different entities, and only the signer needs to use Iris.
*
* For example, a crawler can import and sign other people's messages from Twitter. Only the users who trust the crawler will see the messages.
*
* "Rating" type messages, when added to an Index, can add or remove Identities from the web of trust. Verification/unverification messages can add or remove Attributes from an Identity. Other types of messages such as social media "post" are just indexed by their author, recipient and time.
*
* Constructor: creates a message from the param obj.signedData that must contain at least the mandatory fields: author, recipient, type and time. You can use createRating() and createVerification() to automatically populate some of these fields and optionally sign the message.
* @param obj
*
* @example
* Rating message:
* {
*   signedData: {
*     author: {name:'Alice', key:'ABCD1234'},
*     recipient: {name:'Bob', email:'bob@example.com'},
*     type: 'rating',
*     rating: 1,
*     maxRating: 10,
*     minRating: -10,
*     text: 'Traded 1 BTC'
*   },
*   signer: 'ABCD1234',
*   signature: '1234ABCD'
* }
*
* Verification message:
* {
*   signedData: {
*     author: {name:'Alice', key:'ABCD1234'},
*     recipient: {
*       name: 'Bob',
*       email: ['bob@example.com', 'bob.saget@example.com'],
*       bitcoin: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
*     },
*     type: 'verification'
*   },
*   signer: 'ABCD1234',
*   signature: '1234ABCD'
* }
*/
class Message {
  constructor(obj: Object) {
    if (obj.signedData) {
      this.signedData = obj.signedData;
    }
    if (obj.pubKey) {
      this.pubKey = obj.pubKey;
    }
    if (obj.ipfsUri) {
      this.ipfsUri = obj.ipfsUri;
    }
    if (obj.sig) {
      if (typeof obj.sig !== `string`) {
        throw new ValidationError(`Message signature must be a string`);
      }
      this.sig = obj.sig;
      this.getHash();
    }
    this._validate();
  }

  static _getArray(authorOrRecipient) {
    const arr = [];
    const keys = Object.keys(authorOrRecipient);
    for (let i = 0;i < keys.length;i ++) {
      const type = keys[i];
      const value = authorOrRecipient[keys[i]];
      if (typeof value === `string`) {
        arr.push(new Attribute(type, value));
      } else { // array
        for (let j = 0;j < value.length;j ++) {
          const elementValue = value[j];
          arr.push(new Attribute(type, elementValue));
        }
      }
    }
    return arr;
  }

  static _getIterable(authorOrRecipient) {
    return {
      *[Symbol.iterator]() {
        const keys = Object.keys(authorOrRecipient);
        for (let i = 0;i < keys.length;i ++) {
          const type = keys[i];
          const value = authorOrRecipient[keys[i]];
          if (typeof value === `string`) {
            yield new Attribute(type, value);
          } else { // array
            for (let j = 0;j < value.length;j ++) {
              const elementValue = value[j];
              yield new Attribute(type, elementValue);
            }
          }
        }
      }
    };
  }

  /**
  * @returns {object} Javascript iterator over author attributes
  */
  getAuthorIterable() {
    return Message._getIterable(this.signedData.author);
  }

  /**
  * @returns {object} Javascript iterator over recipient attributes
  */
  getRecipientIterable() {
    return Message._getIterable(this.signedData.recipient);
  }

  /**
  * @returns {array} Array containing author attributes
  */
  getAuthorArray() {
    return Message._getArray(this.signedData.author);
  }

  /**
  * @returns {array} Array containing recipient attributes
  */
  getRecipientArray() {
    return this.signedData.recipient ? Message._getArray(this.signedData.recipient) : [];
  }


  /**
  * @returns {string} Message signer keyID, i.e. base64 hash of public key
  */
  getSignerKeyID() {
    return this.pubKey; // hack until gun supports keyID lookups
    //return util.getHash(this.pubKey);
  }

  _validate() {
    if (!this.signedData) {throw new ValidationError(`${errorMsg} Missing signedData`);}
    if (typeof this.signedData !== `object`) {throw new ValidationError(`${errorMsg} signedData must be an object`);}
    const d = this.signedData;

    if (!d.type) {throw new ValidationError(`${errorMsg} Missing type definition`);}
    if (!d.author) {throw new ValidationError(`${errorMsg} Missing author`);}
    if (typeof d.author !== `object`) {throw new ValidationError(`${errorMsg} Author must be object`);}
    if (Array.isArray(d.author)) {throw new ValidationError(`${errorMsg} Author must not be an array`);}
    if (Object.keys(d.author).length === 0) {throw new ValidationError(`${errorMsg} Author empty`);}
    if (this.pubKey) {
      this.signerKeyHash = this.getSignerKeyID();
    }
    for (const attr in d.author) {
      const t = typeof d.author[attr];
      if (t !== `string`) {
        if (Array.isArray(d.author[attr])) {
          for (let i = 0;i < d.author[attr].length;i ++) {
            if (typeof d.author[attr][i] !== `string`) {throw new ValidationError(`${errorMsg} Author attribute must be string, got ${attr}: [${d.author[attr][i]}]`);}
            if (d.author[attr][i].length === 0) {
              throw new ValidationError(`${errorMsg} author ${attr} in array[${i}] is empty`);
            }
          }
        } else {
          throw new ValidationError(`${errorMsg} Author attribute must be string or array, got ${attr}: ${d.author[attr]}`);
        }
      }
      if (attr === `keyID`) {
        if (t !== `string`) {throw new ValidationError(`${errorMsg} Author keyID must be string, got ${t}`);}
        if (this.signerKeyHash && d.author[attr] !== this.signerKeyHash) {throw new ValidationError(`${errorMsg} If message has a keyID author, it must be signed by the same key`);}
      }
    }
    if (d.recipient) {
      if (typeof d.recipient !== `object`) {throw new ValidationError(`${errorMsg} Recipient must be object`);}
      if (Array.isArray(d.recipient)) {throw new ValidationError(`${errorMsg} Recipient must not be an array`);}
      if (Object.keys(d.recipient).length === 0) {throw new ValidationError(`${errorMsg} Recipient empty`);}
      for (const attr in d.recipient) {
        const t = typeof d.recipient[attr];
        if (t !== `string`) {
          if (Array.isArray(d.recipient[attr])) {
            for (let i = 0;i < d.recipient[attr].length;i ++) {
              if (typeof d.recipient[attr][i] !== `string`) {throw new ValidationError(`${errorMsg} Recipient attribute must be string, got ${attr}: [${d.recipient[attr][i]}]`);}
              if (d.recipient[attr][i].length === 0) {
                throw new ValidationError(`${errorMsg} recipient ${attr} in array[${i}] is empty`);
              }
            }
          } else {
            throw new ValidationError(`${errorMsg} Recipient attribute must be string or array, got ${attr}: ${d.recipient[attr]}`);
          }
        }
      }
    }
    if (!(d.time || d.timestamp)) {throw new ValidationError(`${errorMsg} Missing time field`);}

    if (!Date.parse(d.time || d.timestamp)) {throw new ValidationError(`${errorMsg} Invalid time field`);}

    if (d.type === `rating`) {
      if (isNaN(d.rating)) {throw new ValidationError(`${errorMsg} Invalid rating`);}
      if (isNaN(d.maxRating)) {throw new ValidationError(`${errorMsg} Invalid maxRating`);}
      if (isNaN(d.minRating)) {throw new ValidationError(`${errorMsg} Invalid minRating`);}
      if (d.rating > d.maxRating) {throw new ValidationError(`${errorMsg} Rating is above maxRating`);}
      if (d.rating < d.minRating) {throw new ValidationError(`${errorMsg} Rating is below minRating`);}
      if (typeof d.context !== `string` || !d.context.length) {throw new ValidationError(`${errorMsg} Rating messages must have a context field`);}
    }

    if (d.type === `verification` || d.type === `unverification`) {
      if (d.recipient.length < 2) {throw new ValidationError(`${errorMsg} At least 2 recipient attributes are needed for a connection / disconnection. Got: ${d.recipient}`);}
    }

    return true;
  }

  /**
  * @returns {boolean} true if message has a positive rating
  */
  isPositive() {
    return this.signedData.type === `rating` && this.signedData.rating > (this.signedData.maxRating + this.signedData.minRating) / 2;
  }

  /**
  * @returns {boolean} true if message has a negative rating
  */
  isNegative() {
    return this.signedData.type === `rating` && this.signedData.rating < (this.signedData.maxRating + this.signedData.minRating) / 2;
  }

  /**
  * @returns {boolean} true if message has a neutral rating
  */
  isNeutral() {
    return this.signedData.type === `rating` && this.signedData.rating === (this.signedData.maxRating + this.signedData.minRating) / 2;
  }

  /**
  * @param {Object} key Gun.SEA keypair to sign the message with
  */
  async sign(key: Object) {
    this.sig = await Key.sign(this.signedData, key);
    this.pubKey = key.pub;
    this.getHash();
    return true;
  }

  /**
  * Create an iris message. Message time is automatically set. If signingKey is specified and author omitted, signingKey will be used as author.
  * @param {Object} signedData message data object including author, recipient and other possible attributes
  * @param {Object} signingKey optionally, you can set the key to sign the message with
  * @returns {Promise<Message>}  message
  */
  static async create(signedData: Object, signingKey: Object) {
    if (!signedData.author && signingKey) {
      signedData.author = {keyID: Key.getId(signingKey)};
    }
    signedData.time = signedData.time || (new Date()).toISOString();
    const m = new Message({signedData});
    if (signingKey) {
      await m.sign(signingKey);
    }
    return m;
  }

  /**
  * Create an  verification message. Message signedData's type and time are automatically set. Recipient must be set. If signingKey is specified and author omitted, signingKey will be used as author.
  * @returns {Promise<Object>} message object promise
  */
  static createVerification(signedData: Object, signingKey: Object) {
    signedData.type = `verification`;
    return Message.create(signedData, signingKey);
  }

  /**
  * Create an  rating message. Message signedData's type, maxRating, minRating, time and context are set automatically. Recipient and rating must be set. If signingKey is specified and author omitted, signingKey will be used as author.
  * @returns {Promise<Object>} message object promise
  */
  static createRating(signedData: Object, signingKey: Object) {
    signedData.type = `rating`;
    signedData.context = signedData.context || `iris`;
    signedData.maxRating = signedData.maxRating || 10;
    signedData.minRating = signedData.minRating || - 10;
    return Message.create(signedData, signingKey);
  }

  /**
  * @param {Index} index index to look up the message author from
  * @returns {Identity} message author identity
  */
  getAuthor(index) {
    for (const a of this.getAuthorIterable()) {
      if (a.isUniqueType()) {
        return index.get(a);
      }
    }
  }

  /**
  * @param {Index} index index to look up the message recipient from
  * @returns {Identity} message recipient identity or undefined
  */
  getRecipient(index) {
    if (!this.signedData.recipient) {
      return undefined;
    }
    for (const a of this.getRecipientIterable()) {
      if (a.isUniqueType()) {
        return index.get(a);
      }
    }
  }

  /**
  * @returns {string} base64 hash of message
  */
  getHash() {
    if (this.sig && !this.hash) {
      this.hash = util.getHash(this.sig);
    }
    return this.hash;
  }

  static async fromSig(obj) {
    const signedData = await Key.verify(obj.sig, obj.pubKey);
    const o = {signedData, sig: obj.sig, pubKey: obj.pubKey};
    return new Message(o);
  }

  /**
  * @return {boolean} true if message signature is valid. Otherwise throws ValidationError.
  */
  async verify() {
    if (!this.pubKey) {
      throw new ValidationError(`${errorMsg} Message has no .pubKey`);
    }
    if (!this.sig) {
      throw new ValidationError(`${errorMsg} Message has no .sig`);
    }
    this.signedData = await Key.verify(this.sig, this.pubKey);
    if (!this.signedData) {
      throw new ValidationError(`${errorMsg} Invalid signature`);
    }
    if (this.hash) {
      if (this.hash !== util.getHash(this.sig)) {
        throw new ValidationError(`${errorMsg} Invalid message hash`);
      }
    } else {
      this.getHash();
    }
    return true;
  }

  /**
  *
  */
  async saveToIpfs(ipfs) {
    const s = this.toString();
    const r = await ipfs.add(ipfs.types.Buffer.from(s));
    if (r.length) {
      this.ipfsUri = r[0].hash;
    }
    return this.ipfsUri;
  }

  /**
  *
  */
  static async loadFromIpfs(ipfs, uri) {
    const f = await ipfs.cat(uri);
    const s = ipfs.types.Buffer.from(f).toString(`utf8`);
    return Message.fromString(s);
  }

  /**
  * @returns {string} JSON string of signature and public key
  */
  toString() {
    return JSON.stringify({sig: this.sig, pubKey: this.pubKey});
  }

  /**
  * @returns {Promise<Message>} message from JSON string produced by toString
  */
  static async fromString(s) {
    return Message.fromSig(JSON.parse(s));
  }
}

export default Message;

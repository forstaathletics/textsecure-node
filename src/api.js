/*
 * vim: ts=4:sw=4:expandtab
 */

'use strict';

const request = require('request-promise-native');

var TextSecureServer = (function() {

    function validateResponse(response, schema) {
        try {
            for (var i in schema) {
                switch (schema[i]) {
                    case 'object':
                    case 'string':
                    case 'number':
                        if (typeof response[i] !== schema[i]) {
                            return false;
                        }
                        break;
                }
            }
        } catch(ex) {
            return false;
        }
        return true;
    }

    function HTTPError(code, response, stack) {
        if (code > 999 || code < 100) {
            code = -1;
        }
        var e = new Error();
        e.name     = 'HTTPError';
        e.code     = code;
        e.stack    = stack;
        if (response) {
            e.response = response;
        }
        return e;
    }

    var URL_CALLS = {
        accounts   : "v1/accounts",
        devices    : "v1/devices",
        keys       : "v2/keys",
        messages   : "v1/messages",
        attachment : "v1/attachments"
    };

    function TextSecureServer(url, username, password, attachment_server_url) {
        if (typeof url !== 'string') {
            throw new Error('Invalid server url');
        }
        console.log(`Initialized TextSecureServer: ${url} ${username}`);
        this.url = url;
        this.username = username;
        this.password = password;

        this.attachment_id_regex = RegExp("^https:\/\/.*\/(\\d+)\?");
        if (attachment_server_url) {
            // strip trailing /
            attachment_server_url = attachment_server_url.replace(/\/$/,'');
            // and escape
            attachment_server_url = attachment_server_url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            this.attachment_id_regex = RegExp( "^" + attachment_server_url + "\/(\\d+)\?");
        }
    }

    TextSecureServer.prototype = {
        constructor: TextSecureServer,
        ajax: async function(param) {
            if (!param.urlParameters) {
                param.urlParameters = '';
            }
            let auth;
            if (this.username && this.password) {
                const auth = {
                    username: this.username,
                    password: this.password
                };
            }
            const uri = this.url + '/' + URL_CALLS[param.call] + param.urlParameters;
            console.info(`Request ${param.httpType} ${uri} [${param.jsonData}]`);
            const resp = request({
                uri,
                auth,
                method: param.httpType,
                json: true,
                body: param.jsonData
            });
            console.log(resp._rp_promise);
            const reply = await resp;
            console.log(resp._rp_promise);
            if (param.validateResponse) {
                throw "looka at it";
                //validateResponse: param.validateResponse
            }
            //}).catch(function(e) {
        },

        requestVerificationSMS: function(number) {
            return this.ajax({
                call                : 'accounts',
                httpType            : 'GET',
                urlParameters       : '/sms/code/' + number,
            });
        },
        requestVerificationVoice: function(number) {
            return this.ajax({
                call                : 'accounts',
                httpType            : 'GET',
                urlParameters       : '/voice/code/' + number,
            });
        },
        confirmCode: function(number, code, password, signaling_key, registrationId, deviceName) {
            var jsonData = {
                signalingKey    : btoa(getString(signaling_key)),
                supportsSms     : false,
                fetchesMessages : true,
                registrationId  : registrationId,
            };

            var call, urlPrefix, schema;
            if (deviceName) {
                jsonData.name = deviceName;
                call = 'devices';
                urlPrefix = '/';
                schema = { deviceId: 'number' };
            } else {
                call = 'accounts';
                urlPrefix = '/code/';
            }

            this.username = number;
            this.password = password;
            return this.ajax({
                call                : call,
                httpType            : 'PUT',
                urlParameters       : urlPrefix + code,
                jsonData            : jsonData,
                validateResponse    : schema
            });
        },
        getDevices: function(number) {
            return this.ajax({
                call     : 'devices',
                httpType : 'GET',
            });
        },
        registerKeys: function(genKeys) {
            var keys = {};
            keys.identityKey = btoa(getString(genKeys.identityKey));
            keys.signedPreKey = {
                keyId: genKeys.signedPreKey.keyId,
                publicKey: btoa(getString(genKeys.signedPreKey.publicKey)),
                signature: btoa(getString(genKeys.signedPreKey.signature))
            };

            keys.preKeys = [];
            var j = 0;
            for (var i in genKeys.preKeys) {
                keys.preKeys[j++] = {
                    keyId: genKeys.preKeys[i].keyId,
                    publicKey: btoa(getString(genKeys.preKeys[i].publicKey))
                };
            }

            // This is just to make the server happy
            // (v2 clients should choke on publicKey)
            keys.lastResortKey = {keyId: 0x7fffFFFF, publicKey: btoa("42")};

            return this.ajax({
                call                : 'keys',
                httpType            : 'PUT',
                jsonData            : keys,
            });
        },
        getMyKeys: function(number, deviceId) {
            return this.ajax({
                call                : 'keys',
                httpType            : 'GET',
                validateResponse    : {count: 'number'}
            }).then(function(res) {
                return res.count;
            });
        },
        getKeysForNumber: function(number, deviceId) {
            if (deviceId === undefined)
                deviceId = "*";

            return this.ajax({
                call                : 'keys',
                httpType            : 'GET',
                urlParameters       : "/" + number + "/" + deviceId,
                validateResponse    : {identityKey: 'string', devices: 'object'}
            }).then(function(res) {
                if (res.devices.constructor !== Array) {
                    throw new Error("Invalid response");
                }
                res.identityKey = StringView.base64ToBytes(res.identityKey);
                res.devices.forEach(function(device) {
                    if ( !validateResponse(device, {signedPreKey: 'object', preKey: 'object'}) ||
                         !validateResponse(device.signedPreKey, {publicKey: 'string', signature: 'string'}) ||
                         !validateResponse(device.preKey, {publicKey: 'string'})) {
                        throw new Error("Invalid response");
                    }
                    device.signedPreKey.publicKey = StringView.base64ToBytes(device.signedPreKey.publicKey);
                    device.signedPreKey.signature = StringView.base64ToBytes(device.signedPreKey.signature);
                    device.preKey.publicKey       = StringView.base64ToBytes(device.preKey.publicKey);
                });
                return res;
            });
        },
        sendMessages: function(destination, messageArray, timestamp) {
            var jsonData = { messages: messageArray, timestamp: timestamp};

            return this.ajax({
                call                : 'messages',
                httpType            : 'PUT',
                urlParameters       : '/' + destination,
                jsonData            : jsonData,
            });
        },
        getAttachment: function(id) {
            return this.ajax({
                call                : 'attachment',
                httpType            : 'GET',
                urlParameters       : '/' + id,
                validateResponse    : {location: 'string'}
            }).then(function(response) {
                var match = response.location.match(this.attachment_id_regex);
                if (!match) {
                    console.log('Invalid attachment url for incoming message', response.location);
                    throw new Error('Received invalid attachment url');
                }
                return ajax(response.location, {
                    type        : "GET",
                    responseType: "arraybuffer",
                    contentType : "application/octet-stream"
                });
            }.bind(this));
        },
        putAttachment: function(encryptedBin) {
            return this.ajax({
                call     : 'attachment',
                httpType : 'GET',
            }).then(function(response) {
                // Extract the id as a string from the location url
                // (workaround for ids too large for Javascript numbers)
                var match = response.location.match(this.attachment_id_regex);
                if (!match) {
                    console.log('Invalid attachment url for outgoing message', response.location);
                    throw new Error('Received invalid attachment url');
                }
                return ajax(response.location, {
                    type        : "PUT",
                    contentType : "application/octet-stream",
                    data        : encryptedBin,
                    processData : false,
                }).then(function() {
                    return match[1];
                }.bind(this));
            }.bind(this));
        },
        getMessageSocket: function() {
            console.log('opening message socket', this.url);
            return new WebSocket(
                this.url.replace('https://', 'wss://').replace('http://', 'ws://')
                    + '/v1/websocket/?login=' + encodeURIComponent(this.username)
                    + '&password=' + encodeURIComponent(this.password)
                    + '&agent=OWD'
            );
        },
        getProvisioningSocket: function () {
            console.log('opening provisioning socket', this.url);
            return new WebSocket(
                this.url.replace('https://', 'wss://').replace('http://', 'ws://')
                    + '/v1/websocket/provisioning/?agent=OWD'
            );
        }
    };

    return TextSecureServer;
})();


exports.TextSecureServer = TextSecureServer;

/************************************************************************
 * Copyright (c) Crater Dog Technologies(TM).  All Rights Reserved.     *
 ************************************************************************
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.        *
 *                                                                      *
 * This code is free software; you can redistribute it and/or modify it *
 * under the terms of The MIT License (MIT), as published by the Open   *
 * Source Initiative. (See http://opensource.org/licenses/MIT)          *
 ************************************************************************/
'use strict';

///////////////////////////////////////////////////////////////////////////////////////
// This module should be used for LOCAL TESTING ONLY.  It is NOT SECURE and provides //
// no guarantees on protecting access to the private key.  YOU HAVE BEEN WARNED!!!   //
///////////////////////////////////////////////////////////////////////////////////////


/*
 * This module uses the singleton pattern to provide an object that simulates a hardware
 * security module (HSM) for all cryptographic operations involving the private key. It
 * implements these operations as a software security module to allow testing without an
 * actual HSM.
 */
const pfs = require('fs').promises;
const os = require('os');
const crypto = require('crypto');
const ec_pem = require('ec-pem');
const bali = require('bali-component-framework');


// PUBLIC APIs

/**
 * This function returns an object that implements the public certificate API for the 
 * software security module (SSM).
 *
 * @returns {Object} A proxy to the public software security module.
 */
exports.publicAPI = function() {

    return {

        /**
         * This function returns a string providing attributes about this software security module.
         *
         * @returns {String} A string providing attributes about this software security module.
         */
        toString: function() {
            const catalog = bali.catalog({
                $module: '/bali/notary/PublicSSM',
                $protocol: bali.parse(PROTOCOL),
                $curve: bali.text(CURVE),
                $digest: bali.text(DIGEST),
                $signature: bali.text(SIGNATURE),
                $cipher: bali.text(CIPHER)
            });
            return catalog.toString();
        },

        /**
         * This function generates a document citation for the specified notarized document.
         *
         * @param {Catalog} document The notarized document to be cited.
         * @returns {Catalog} A document citation for the notarized document.
         */
        citeDocument: function(document) {
            const parameters = document.getValue('$component').getParameters();
            const tag = parameters.getParameter('$tag');
            const version = parameters.getParameter('$version');
            const digest = digestMessage(document.toString());
            const citation = bali.catalog({
                $protocol: bali.parse(PROTOCOL),  // parses the version number of the protocol
                $timestamp: bali.moment(),  // now
                $tag: tag,
                $version: version,
                $digest: digest
            }, bali.parameters({
                $type: '/bali/notary/Citation/v1'
            }));
            return citation;
        },

        /**
         * This function determines whether or not the specified document citation matches
         * the specified notarized document. The citation only matches if its digest matches
         * the digest of the notarized document exactly.
         *
         * @param {Catalog} citation A document citation allegedly referring to the
         * specified notarized document.
         * @param {Catalog} document The notarized document to be tested.
         * @returns {Boolean} Whether or not the citation matches the specified notarized document.
         */
        citationMatches: function(citation, document) {
            var digest = digestMessage(document.toString());
            return digest.isEqualTo(citation.getValue('$digest'));
        },

        /**
         * This function determines whether or not the notary seal on the specified notarized
         * document is valid.
         *
         * @param {Catalog} document The notarized document to be tested.
         * @param {Catalog} certificate A notarized document containing the public certificate
         * for the private notary key that allegedly notarized the specified document.
         * @returns {Boolean} Whether or not the notary seal on the notarized document is valid.
         */
        documentIsValid: function(document, certificate) {
            certificate = certificate.getValue('$component');
            const catalog = bali.catalog.extraction(document, bali.list([
                '$component',
                '$protocol',
                '$timestamp',
                '$certificate'
            ]));  // everything but the signature
            const publicKey = certificate.getValue('$publicKey');
            const signature = document.getValue('$signature');
            return signatureIsValid(catalog.toString(), publicKey, signature);
        },

        /**
         * This function uses the specified public notary certificate to encrypt the specified
         * component in such a way that only the intended recipient of the encrypted component can
         * decrypt it using their private notary key. The result is an authenticated encrypted
         * message (AEM) containing the ciphertext and other required attributes needed to
         * decrypt the message.
         *
         * @param {Component} component The component to be encrypted using the specified
         * public notary certificate.
         * @param {Catalog} certificate A notarized document containing the public certificate
         * for the intended recipient of the encrypted component.
         * @returns {Catalog} An authenticated encrypted message (AEM) containing the ciphertext
         * and other required attributes for the encrypted component.
         */
        encryptComponent: function(component, certificate) {
            certificate = certificate.getValue('$component');
            const publicKey = certificate.getValue('$publicKey');
            const aem = encryptMessage(component.toString(), publicKey);
            return aem;
        }
    };
};

/**
 * This function returns an object that implements the private key API for the software
 * security module (SSM). The internal attributes for the notary key are hidden from
 * the code that is using the notary key, but it is NOT fool-proof. It should only be
 * used for testing purposes.
 *
 * @param {Tag} accountId The unique tag for the account that owns the notary key.
 * @param {String} directory An optional directory to use for local testing.
 * @returns {Object} A proxy to the test software security module managing the private key.
 */
exports.privateAPI = function(accountId, directory) {
    var notaryTag;            // the unique tag for the notary key
    var version;              // the current version of the notary key
    var timestamp;            // the timestamp of when the key was generated
    var publicKey;            // the public key residing in the certificate in the cloud
    var privateKey;           // the local private key that is used for signing and decryption
    var notaryCertificate;    // the public notary certificate containing the public key
    var certificateCitation;  // a document citation for the public notary certificate
    var configDirectory;      // the path to the configuration directory
    var keyFilename;          // the name of the configuration file containing the keys
    var certificateFilename;  // the name of the configuration file containing the certificate

    return {

        /**
         * This function returns a string providing attributes about this software security module.
         *
         * @returns {String} A string providing attributes about this software security module.
         */
        toString: function() {
            const catalog = bali.catalog({
                $module: '/bali/notary/PrivateSSM',
                $protocol: bali.parse(PROTOCOL),
                $curve: bali.text(CURVE),
                $digest: bali.text(DIGEST),
                $signature: bali.text(SIGNATURE),
                $cipher: bali.text(CIPHER),
                $accountId: accountId,
                $certificate: certificateCitation
            }, bali.parameters({
                $tag: notaryTag,
                $version: version
            }));
            return catalog.toString();
        },

        /**
         * This function initializes the API.
         */
        initializeAPI: async function() {
            try {
                // create the configuration directory structure if necessary
                configDirectory = await createDirectory(directory, accountId);
                keyFilename = configDirectory + 'NotaryKey.bali';
                certificateFilename = configDirectory + 'NotaryCertificate.bali';

                // read in the notary key attributes (if possible)
                try {
                    var source;
                    if (await doesExist(keyFilename)) {
                        // read in the notary key information
                        source = await loadKey(keyFilename);
                        const key = bali.parse(source);
                        timestamp = key.getValue('$timestamp');
                        publicKey = key.getValue('$publicKey');
                        privateKey = key.getValue('$privateKey');
                        certificateCitation = key.getValue('$certificate');
                        notaryTag = certificateCitation.getValue('$tag');
                        version = certificateCitation.getValue('$version');
                    }
                    if (await doesExist(certificateFilename)) {
                        // read in the notary certificate information
                        source = await loadCertificate(certificateFilename);
                        notaryCertificate = bali.parse(source);
                    }
                } catch (cause) {
                    const exception = bali.exception({
                        $module: '/bali/notary/PrivateSSM',
                        $procedure: '$initializeAPI',
                        $exception: '$directoryAccess',
                        $accountId: accountId || bali.NONE,
                        $directory: configDirectory ? bali.text(configDirectory) : bali.NONE,
                        $text: bali.text('The configuration directory could not be accessed.')
                    }, cause);
                    throw exception;
                }
                this.initializeAPI = undefined;  // can only be called once
            } catch (cause) {
                const exception = bali.exception({
                    $module: '/bali/notary/PrivateSSM',
                    $procedure: '$initializeAPI',
                    $exception: '$unexpected',
                    $accountId: accountId || bali.NONE,
                    $directory: configDirectory ? bali.text(configDirectory) : bali.NONE,
                    $text: bali.text('An unexpected error occurred while attempting to initialize the API.')
                }, cause);
                throw exception;
            }
        },

        /**
         * This function returns the notary certificate associated with this notary key.
         *
         * @returns {Catalog} The notary certificate associated with this notary key.
         */
        getCertificate: async function() {
            if (this.initializeAPI) await this.initializeAPI();
            return notaryCertificate;
        },

        /**
         * This function returns a citation referencing the notary certificate associated
         * with this notary key.
         *
         * @returns {Catalog} A citation referencing the notary certificate associated
         * with this notary key.
         */
        getCitation: async function() {
            if (this.initializeAPI) await this.initializeAPI();
            return certificateCitation;
        },

        /**
         * This function generates a new public-private key pair and uses the private key as the
         * new notary key. It returns the new public notary certificate. Note, during regeneration
         * the old private key is used to sign the new certificate before it is destroyed.
         *
         * @returns {Catalog} The new notary certificate.
         */
        generateKey: async function() {
            if (this.initializeAPI) await this.initializeAPI();
            const isRegeneration = !!privateKey;

            // generate a new public-private key pair
            const keys = generateKeys();
            notaryTag = notaryTag || bali.tag();  // generate a new tag if necessary
            version = version ? bali.version.nextVersion(version) : bali.version();
            timestamp = bali.moment();
            publicKey = keys.publicKey;  // done with existing public key
            privateKey = privateKey || keys.privateKey;  // but need existing private key

            // create the new notary certificate document
            const component = bali.catalog({
                $protocol: bali.parse(PROTOCOL),
                $timestamp: timestamp,
                $accountId: accountId,
                $publicKey: publicKey
            }, bali.parameters({
                $type: bali.parse('/bali/notary/Certificate/v1'),
                $tag: notaryTag,
                $version: version,
                $permissions: '/bali/permissions/public/v1',
                $previous: isRegeneration ? certificateCitation : bali.NONE
            }));

            // notarize the notary certificate document
            notaryCertificate = bali.catalog({
                $component: component,
                $protocol: bali.parse(PROTOCOL),
                $timestamp: bali.moment(),  // now
                $certificate: isRegeneration ? certificateCitation : bali.NONE
            }, bali.parameters({
                $type: bali.parse('/bali/notary/Document/v1')
            }));
            const signature = signMessage(notaryCertificate.toString(), privateKey);
            notaryCertificate.setValue('$signature', signature);

            // now we can save the new key
            privateKey = keys.privateKey;

            // cache the new certificate citation
            const digest = digestMessage(notaryCertificate.toString());
            certificateCitation = bali.catalog({
                $protocol: bali.parse(PROTOCOL),
                $timestamp: bali.moment(),  // now
                $tag: notaryTag,
                $version: version,
                $digest: digest
            }, bali.parameters({
                $type: bali.parse('/bali/notary/Citation/v1')
            }));

            // save the state of this notary key and certificate in the local configuration
            try {
                const notaryKey = bali.catalog({
                    $protocol: bali.parse(PROTOCOL),
                    $timestamp: timestamp,
                    $accountId: accountId,
                    $publicKey: publicKey,
                    $privateKey: privateKey,
                    $certificate: certificateCitation
                }, bali.parameters({
                    $type: bali.parse('/bali/notary/NotaryKey/v1')
                }));
                await storeKey(keyFilename, notaryKey.toString());
                await storeCertificate(certificateFilename, notaryCertificate.toString());
            } catch (cause) {
                const exception = bali.exception({
                    $module: '/bali/notary/PrivateSSM',
                    $procedure: '$generateKey',
                    $exception: '$directoryAccess',
                    $accountId: accountId || bali.NONE,
                    $text: bali.text('The configuration directory could not be accessed.')
                }, cause);
                throw exception;
            }

            return notaryCertificate;
        },

        /**
         * This function causes the digital notary to forget all information
         * it knows about the current public-private key pair.
         */
        forgetKey: async function() {
            if (this.initializeAPI) await this.initializeAPI();
            version = undefined;
            publicKey = undefined;
            privateKey = undefined;
            certificateCitation = undefined;
            notaryCertificate = undefined;
            await deleteKey(keyFilename);
            await deleteCertificate(certificateFilename);
        },

        /**
         * This function digitally notarizes the specified component using the private notary
         * key maintained inside the software security module. The component must be parameterized
         * with the following parameters:
         * <pre>
         *  * $tag - a unique identifier for the component
         *  * $version - the version of the component
         *  * $permissions - a citation to a notarized document containing the permissions defining
         *                   who can access the component
         *  * $previous - a citation to the previous version of the component (or bali.NONE)
         * </pre>
         * 
         * The newly notarized component is returned.
         *
         * @param {Component} component The component to be notarized.
         * @returns {Catalog} The newly notarized component.
         */
        signComponent: async function(component) {
            if (this.initializeAPI) await this.initializeAPI();
            if (!privateKey) {
                const exception = bali.exception({
                    $module: '/bali/notary/PrivateSSM',
                    $procedure: '$signComponent',
                    $exception: '$missingKey',
                    $accountId: accountId,
                    $text: bali.text('A notary key has not been generated.')
                });
                throw exception;
            }
            const notarizedComponent = bali.catalog({
                $component: component,
                $protocol: PROTOCOL,
                $timestamp: bali.moment(),  // now
                $certificate: certificateCitation
            }, bali.parameters({
                $type: bali.parse('/bali/notary/Document/v1')
            }));
            const signature = signMessage(notarizedComponent.toString(), privateKey);
            notarizedComponent.setValue('$signature', signature);
            return notarizedComponent;
        },

        /**
         * This function uses the notary key to decrypt the specified authenticated
         * encrypted message (AEM). The result is the decrypted component.
         *
         * @param {Catalog} aem The authenticated encrypted message to be decrypted.
         * @returns {Component} The decrypted component.
         */
        decryptComponent: async function(aem) {
            if (this.initializeAPI) await this.initializeAPI();
            if (!privateKey) {
                const exception = bali.exception({
                    $module: '/bali/notary/PrivateSSM',
                    $procedure: '$decryptComponent',
                    $exception: '$missingKey',
                    $accountId: accountId,
                    $text: bali.text('A notary key has not been generated.')
                });
                throw exception;
            }
            const protocol = aem.getValue('$protocol');
            if (!protocol || protocol.toString() !== PROTOCOL) {
                const exception = bali.exception({
                    $module: '/bali/notary/PrivateSSM',
                    $procedure: '$decryptComponent',
                    $exception: '$unsupportedProtocol',
                    $expected:  bali.parse(PROTOCOL),
                    $actual: protocol,
                    $text: bali.text('The component was encrypted using an unsupported version of the notary protocol.')
                });
                throw exception;
            }
            const message = decryptMessage(aem, privateKey);
            const component = bali.parse(message);
            return component;
        }
    };
};


// PRIVATE CONSTANTS

// The algorithms for this version of the protocol
const PROTOCOL = 'v1';
const CURVE = 'prime256v1';  // AKA 'secp256r1'
const DIGEST = 'sha512';
const SIGNATURE = 'sha512';
const CIPHER = 'aes-256-gcm';

// This private constant sets the POSIX end of line character
const EOL = '\n';


// PRIVATE FUNCTIONS

/**
 * This function determines whether or not the specified file exists.
 * 
 * @param {String} file The file to be checked.
 * @returns {Boolean} Whether or not the specified file exists.
 */
const doesExist = async function(file) {
    try {
        await pfs.stat(file);
        return true;
    } catch (exception) {
        if (exception.code === 'ENOENT') {
            return false;
        } else {
            throw exception;
        }
    }
};


/**
 * This function creates the configuration directories for the specified account.
 * 
 * @param {String} directory An optional directory path to be used as the
 * base configuration directory.
 * @param {Tag} accountId The unique tag for the account associated with the
 * notary key.
 * @returns {String} The full configuration directory path for this account.
 */
const createDirectory = async function(directory, accountId) {
    var configDirectory = directory || os.homedir() + '/.bali/';
    try { await pfs.mkdir(configDirectory, 0o700); } catch (ignore) {};
    configDirectory += accountId.getValue() + '/';
    try { await pfs.mkdir(configDirectory, 0o700); } catch (ignore) {};
    return configDirectory;
};


/**
 * This function loads the public and private key attributes from the specified file.
 * 
 * @param {String} filename The name of the file containing the key definitions.
 * @returns {String} A string containing the public and private key attributes.
 */
const loadKey = async function(filename) {
    const key = await pfs.readFile(filename, 'utf8');
    return key;
};


/**
 * This function stores the public and private key attributes in the specified file.
 * 
 * @param {String} filename The name of the file containing the key definitions.
 * @param {String} key A string containing the public and private key attributes.
 */
const storeKey = async function(filename, key) {
    key += EOL;  // add POSIX compliant <EOL>
    await pfs.writeFile(filename, key, {encoding: 'utf8', mode: 0o600});
};


/**
 * This function deletes the public and private key attributes stored in the specified
 * file.
 * 
 * @param {String} filename The name of the file containing the key definitions.
 */
const deleteKey = async function(filename) {
    await pfs.unlink(filename).catch(function() {});
};


/**
 * This function loads the public certificate attributes from the specified file.
 * 
 * @param {String} filename The name of the file containing the certificate attributes.
 * @returns {String} A string containing the public certificate attributes.
 */
const loadCertificate = async function(filename) {
    const certificate = await pfs.readFile(filename, 'utf8');
    return certificate;
};


/**
 * This function stores the public certificate attributes in the specified file.
 * 
 * @param {String} filename The name of the file containing the certificate attributes.
 * @param {String} certificate A string containing the public certificate attributes.
 */
const storeCertificate = async function(filename, certificate) {
    certificate += EOL;  // add POSIX compliant <EOL>
    await pfs.writeFile(filename, certificate, {encoding: 'utf8', mode: 0o600});
};


/**
 * This function deletes the public certificate attributes stored in the specified file.
 * 
 * @param {String} filename The name of the file containing the certificate attributes.
 */
const deleteCertificate = async function(filename) {
    await pfs.unlink(filename).catch(function() {});
};


/**
 * This function generates a new public-private key pair.
 * 
 * @returns {Catalog} A catalog containing the new public and private keys.
 */
const generateKeys = function() {
    const curve = crypto.createECDH(CURVE);
    curve.generateKeys();
    return {
        publicKey: bali.binary(curve.getPublicKey()),
        privateKey: bali.binary(curve.getPrivateKey())
    };
};


/**
 * This function returns a cryptographically secure digital digest of the
 * specified message. The generated digital digest will always be the same
 * for the same message.
 *
 * @param {String} message The message to be digested.
 * @returns {Binary} A base 32 encoded binary string for the digital digest
 * of the message.
 */
const digestMessage = function(message) {
    const hasher = crypto.createHash(DIGEST);
    hasher.update(message);
    const digest = bali.binary(hasher.digest());
    return digest;
};


/**
 * This function generates a digital signature of the specified message using
 * the specified private key. The resulting digital signature can then be
 * verified using the corresponding public key.
 * 
 * @param {String} message The message to be digitally signed.
 * @param {Binary} privateKey A base 32 encoded binary string for the private key.
 * @returns {Binary} A base 32 encoded binary string for the digital signature.
 */
const signMessage = function(message, privateKey) {
    const curve = crypto.createECDH(CURVE);
    curve.setPrivateKey(privateKey.getValue());
    const pem = ec_pem(curve, CURVE);
    const signer = crypto.createSign(SIGNATURE);
    signer.update(message);
    const signature = bali.binary(signer.sign(pem.encodePrivateKey()));
    return signature;
};


/**
 * This function uses the specified public key to determine whether or not
 * the specified digital signature was generated using the corresponding
 * private key on the specified message.
 *
 * @param {String} message The digitally signed message.
 * @param {Binary} publicKey A base 32 encoded binary string for the public key.
 * @param {Binary} signature A base 32 encoded binary string for the digital
 * signature generated using the corresponding private key.
 * @returns {Boolean} Whether or not the digital signature is valid.
 */
const signatureIsValid = function(message, publicKey, signature) {
    const curve = crypto.createECDH(CURVE);
    curve.setPublicKey(publicKey.getValue());
    const pem = ec_pem(curve, CURVE);
    const verifier = crypto.createVerify(SIGNATURE);
    verifier.update(message);
    return verifier.verify(pem.encodePublicKey(), signature.getValue());
};


/**
 * This function uses the specified public key to generate a symmetric key that
 * is then used to encrypt the specified message. The resulting authenticated
 * encrypted message (AEM) can be decrypted using the corresponding private key.
 * 
 * @param {String} message The message to be encrypted. 
 * @param {Binary} publicKey A base 32 encoded binary string for the public key
 * to be used to generate the symmetric key.
 * @returns {Catalog} The resulting authenticated encrypted message (AEM).
 */
const encryptMessage = function(message, publicKey) {
    // generate and encrypt a 32-byte symmetric key
    const curve = crypto.createECDH(CURVE);
    curve.generateKeys();
    const seed = curve.getPublicKey();  // use the new public key as the decryption seed
    const symmetricKey = curve.computeSecret(publicKey.getValue()).slice(0, 32);  // use only first 32 bytes

    // encrypt the message using the symmetric key
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(CIPHER, symmetricKey, iv);
    var ciphertext = cipher.update(message, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    const auth = cipher.getAuthTag();

    // construct the authenticated encrypted message (AEM)
    const aem = bali.catalog({
        $protocol: bali.parse(PROTOCOL),
        $timestamp: bali.moment(),  // now
        $seed: bali.binary(seed),
        $iv: bali.binary(iv),
        $auth: bali.binary(auth),
        $ciphertext: bali.binary(ciphertext)
    }, bali.parameters({
        $type: bali.parse('/bali/notary/AEM/v1')
    }));

    return aem;
};


/**
 * This function uses the specified private key and the attributes from the specified
 * authenticated encrypted message (AEM) object to generate a symmetric key that
 * is then used to decrypt the encrypted message.
 * 
 * @param {Catalog} aem The authenticated encrypted message to be decrypted. 
 * @param {Binary} privateKey A base 32 encoded binary string for the private key
 * used to regenerate the symmetric key that was used to encrypt the message.
 * @returns {String} The decrypted message.
 */
const decryptMessage = function(aem, privateKey) {
    // extract the AEM attributes
    const seed = aem.getValue('$seed').getValue();
    const iv = aem.getValue('$iv').getValue();
    const auth = aem.getValue('$auth').getValue();
    const ciphertext = aem.getValue('$ciphertext').getValue();

    // decrypt the 32-byte symmetric key
    const curve = crypto.createECDH(CURVE);
    curve.setPrivateKey(privateKey.getValue());
    const symmetricKey = curve.computeSecret(seed).slice(0, 32);  // use only first 32 bytes

    // decrypt the ciphertext using the symmetric key
    const decipher = crypto.createDecipheriv(CIPHER, symmetricKey, iv);
    decipher.setAuthTag(auth);
    var message = decipher.update(ciphertext, undefined, 'utf8');
    message += decipher.final('utf8');

    return message;
};

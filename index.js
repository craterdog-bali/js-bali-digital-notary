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

/**
 * This function returns an object that implements the API for a software security module.
 * 
 * @param {String} keyfile An optional filename for a file containing the current key information.
 * If not specified, this API can only be used to perform public key based functions.
 * @param {Number} debug A number in the range [0..3].
 * @returns {Object} An object that implements the API for a software security module.
 */
exports.ssm = function(keyfile, debug) {
    const securityModule = require('./src/v1/SSM').api(keyfile, debug);
    return securityModule;
};


/**
 * This function returns an object that implements the API for a digital notary including
 * the functions that require access to the private key.
 *
 * @param {Object} securityModule An object that implements the security module interface.
 * @param {Tag} accountTag An optional unique account tag for the owner of the digital notary.
 * @param {String} directory An optional directory to be used for local configuration storage.
 * @param {Number} debug A number in the range [0..3].
 * @returns {Object} An object that implements the API for a digital notary.
 */
exports.api = function(securityModule, accountTag, directory, debug) {
    const api = require('./src/DigitalNotary').api(securityModule, accountTag, directory, debug);
    return api;
};

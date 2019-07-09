/************************************************************************
 * Copyright (c) Crater Dog Technologies(TM).  All Rights Reserved.     *
 ************************************************************************
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.        *
 *                                                                      *
 * This code is free software; you can redistribute it and/or modify it *
 * under the terms of The MIT License (MIT), as published by the Open   *
 * Source Initiative. (See http://opensource.org/licenses/MIT)          *
 ************************************************************************/

const debug = true;  // set to true for exception logging
const crypto = require('crypto');
const mocha = require('mocha');
const assert = require('chai').assert;
const expect = require('chai').expect;
const bali = require('bali-component-framework');
const accountId = bali.tag();
const directory = 'test/config/';
const secret = crypto.randomBytes(32);
const ssm = require('../').ssm();
//const hsm = require('../').hsm(accountId, secret);  uncomment when testing real HSM
const hsm = require('../').ssm(directory + accountId.getValue() + '.keys');
const publicAPI = require('../').api(ssm, undefined, undefined, debug);
const notaryAPI = require('../').api(hsm, accountId, directory, debug);


describe('Bali Digital Notary™', function() {

    var notaryCertificate;
    var certificateCitation;
    var component = bali.parse('[$foo: "bar"]($tag: #MFPCRNKS2SG20CD7VQ6KD329X7382KJY, $version: v1, $permissions: /bali/permissions/public/v1, $previous: none)');

    describe('Test Key Generation', function() {

        it('should return the correct accountId', function() {
            expect(notaryAPI.getAccountId().isEqualTo(accountId)).to.equal(true);
        });

        it('should support correct versions', async function() {
            const expected = await publicAPI.getProtocols();
            const protocols = await notaryAPI.getProtocols();
            expect(protocols.isEqualTo(expected)).to.equal(true);
        });

        it('should generate the keys', async function() {
            notaryCertificate = await notaryAPI.generateKey();
            expect(notaryCertificate).to.exist;  // jshint ignore:line
        });

        it('should read in the new keys', async function() {
            const ignore = require('../').ssm(directory + accountId.getValue() + '.keys');
            await ignore.initializeAPI();
        });

        it('should retrieve the certificate citation', async function() {
            certificateCitation = await notaryAPI.getCitation();
            expect(certificateCitation).to.exist;  // jshint ignore:line
        });

    });

    describe('Test Certificate Validation', function() {

        it('should validate the certificate', async function() {
            expect(notaryCertificate.getValue('$protocol').toString()).to.equal('v1');
            const certificate = notaryCertificate.getValue('$component');
            var isValid = await publicAPI.documentIsValid(notaryCertificate, certificate);
            expect(isValid).to.equal(true);
        });

        it('should validate the citation for the certificate', async function() {
            var isValid = await publicAPI.citationMatches(certificateCitation, notaryCertificate);
            expect(isValid).to.equal(true);
        });

    });

    describe('Test Signing and Verification', function() {

        it('should digitally sign a document properly', async function() {
            const tag = bali.tag();
            const previous = bali.catalog({
                $protocol: bali.version(),
                $timestamp: bali.parse('<2019-02-24T22:41:18.843>'),
                $tag: tag,
                $version: bali.version([2, 3]),
                $digest: bali.parse("'JB2NG73VTB957T9TZWT44KRZVQ467KWJ2MSJYT6YW2RQAYQMSR861XGM5ZCDCPNJYR612SJT9RFKHA9YZ5DJMLYC7N3127AY4QDVJ38'")
            }, bali.parameters({
                $type: bali.parse('/bali/notary/Citation/v1')
            }));
            const transaction = bali.catalog({
                $transactionId: bali.tag(),
                $timestamp: bali.moment(),
                $consumer: bali.text('Derk Norton'),
                $merchant: bali.reference('https://www.starbucks.com/'),
                $amount: 4.95
            }, bali.parameters({
                $type: bali.parse('/acme/types/Transaction/v2.3'),
                $tag: tag,
                $version: bali.version([2, 4]),
                $permissions: bali.parse('/bali/permissions/public/v1'),
                $previous: previous
            }));
            var document = await notaryAPI.signComponent(transaction);

            const certificate = notaryCertificate.getValue('$component');

            var citation = await publicAPI.citeDocument(document);
            var isValid = await publicAPI.documentIsValid(document, certificate);
            expect(isValid).to.equal(true);
            var matches = await publicAPI.citationMatches(citation, document);
            expect(matches).to.equal(true);
        });

    });

    describe('Test Key Regeneration', function() {

        it('should regenerate a notary key properly', async function() {
            var newNotaryCertificate = await notaryAPI.generateKey();
            expect(newNotaryCertificate).to.exist;  // jshint ignore:line

            const certificate = notaryCertificate.getValue('$component');
            const newCertificate = newNotaryCertificate.getValue('$component');

            var isValid = await publicAPI.documentIsValid(newNotaryCertificate, certificate);
            expect(isValid).to.equal(true);

            var document = await notaryAPI.signComponent(component);

            var citation = await publicAPI.citeDocument(document);
            isValid = await publicAPI.documentIsValid(document, certificate);
            expect(isValid).to.equal(false);

            isValid = await publicAPI.documentIsValid(document, newCertificate);
            expect(isValid).to.equal(true);

            var matches = await publicAPI.citationMatches(citation, document);
            expect(matches).to.equal(true);

            notaryCertificate = newNotaryCertificate;
        });

    });

    describe('Test Multiple Notarizations', function() {

        it('should notarized a component twice properly', async function() {
            var document = await notaryAPI.signComponent(component);

            const certificate = notaryCertificate.getValue('$component');

            var citation = await publicAPI.citeDocument(document);
            var isValid = await publicAPI.documentIsValid(document, certificate);
            expect(isValid).to.equal(true);
            var matches = await publicAPI.citationMatches(citation, document);
            expect(matches).to.equal(true);

            document = bali.duplicate(document);
            const parameters = document.getParameters();
            parameters.setParameter('$tag', document.getValue('$component').getParameters().getParameter('$tag'));
            parameters.setParameter('$version', 'v2');
            parameters.setParameter('$permissions', bali.parse('/bali/permissions/public/v1'));
            parameters.setParameter('$previous', bali.NONE);
            document = await notaryAPI.signComponent(document);

            citation = await publicAPI.citeDocument(document);
            isValid = await publicAPI.documentIsValid(document, certificate);
            expect(isValid).to.equal(true);
            matches = await publicAPI.citationMatches(citation, document);
            expect(matches).to.equal(true);
        });

    });

});

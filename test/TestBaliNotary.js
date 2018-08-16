/************************************************************************
 * Copyright (c) Crater Dog Technologies(TM).  All Rights Reserved.     *
 ************************************************************************
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.        *
 *                                                                      *
 * This code is free software; you can redistribute it and/or modify it *
 * under the terms of The MIT License (MIT), as published by the Open   *
 * Source Initiative. (See http://opensource.org/licenses/MIT)          *
 ************************************************************************/

var notary = require('../BaliNotary');
var bali = require('bali-document-notation/BaliDocuments');
var mocha = require('mocha');
var expect = require('chai').expect;

describe('Bali Digital Notary™', function() {

    var keys = notary.generateKeys('v1');
    var notaryKey = keys.notaryKey;
    var certificate = keys.certificate;
    var citation = notaryKey.citation;
    var source =
            '[\n' +
            '    $foo: "bar"\n' +
            ']\n';

    describe('Test Keys', function() {

        it('should validate the notary key and certificate', function() {
            expect(notaryKey.protocol).to.equal('v1');
            expect(notaryKey.version).to.equal('v1');
            expect(notaryKey.citation).contains(notaryKey.tag);
            expect(notaryKey.citation).contains(notaryKey.version);

            expect(notaryKey.protocol).to.equal(bali.getStringForKey(certificate, '$protocol'));
            expect(notaryKey.tag).to.equal(bali.getStringForKey(certificate, '$tag'));
            expect(notaryKey.version).to.equal(bali.getStringForKey(certificate, '$version'));
            expect(notaryKey.toString()).contains(bali.getStringForKey(certificate, '$publicKey'));
        });

    });

    describe('Test Citations', function() {

        it('should validate the citation for the certificate', function() {
            var source = citation.toString().slice(6, -1);  // remove '<bali:' and '>' wrapper
            var catalog = bali.parseComponent(source);
            var protocol = bali.getStringForKey(catalog, '$protocol');
            expect(protocol).to.equal('v1');
            var tag = bali.getStringForKey(catalog, '$tag');
            var version = bali.getStringForKey(catalog, '$version');
            var hash = bali.getStringForKey(catalog, '$hash');
            var copy = notary.citation(tag, version, hash);
            expect(citation).to.equal(copy);
            var isValid = notary.documentMatches(citation, certificate);
            expect(isValid).to.equal(true);
        });

    });

    describe('Test Signing and Verification', function() {

        it('should digitally sign a document properly', function() {
            var tag = bali.tag();
            var version = 'v2.3.4';
            var document = bali.parseDocument(source);
            var documentCitation = notary.notarizeDocument(notaryKey, tag, version, document);
            var isValid = notary.documentIsValid(certificate, document);
            expect(isValid).to.equal(true);
            var matches = notary.documentMatches(documentCitation, document);
            expect(matches).to.equal(true);
        });

    });

    describe('Test Encryption and Decryption', function() {

        it('should encrypt and decrypt a message properly', function() {
            var message = 'This is a test...';
            var encrypted = notary.encryptMessage(certificate, message);
            var decrypted = notary.decryptMessage(notaryKey, encrypted);
            expect(decrypted).to.equal(message);
        });

    });

    describe('Test Key Regeneration', function() {

        it('should regenerate a notary key properly', function() {
            var tag = bali.tag();
            var version = 'v2.3.4';
            var document = bali.parseDocument(source);
            notary.notarizeDocument(notaryKey, tag, version, document);

            var newKeys = notary.regenerateKeys(notaryKey);
            expect(newKeys).to.exist;  // jshint ignore:line
            var newNotaryKey = newKeys.notaryKey;
            var newCertificate = newKeys.certificate;

            document = bali.parseDocument(source);
            var newDocumentCitation = notary.notarizeDocument(newNotaryKey, tag, version, document);
            isValid = notary.documentIsValid(certificate, document);
            expect(isValid).to.equal(false);

            isValid = notary.documentIsValid(newCertificate, document);
            expect(isValid).to.equal(true);

            var matches = notary.documentMatches(newDocumentCitation, document);
            expect(matches).to.equal(true);
        });

    });

    describe('Test Exporting and Importing', function() {

        it('should export and re-import a notary key properly', function() {
            var source1 = notaryKey.toString();
            var document1 = bali.parseDocument(source1);
            var copy = notary.notaryKey(document1);
            var source2 = copy.toString();
            expect(source1).to.equal(source2);
        });

    });

});
